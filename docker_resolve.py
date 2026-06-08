#!/usr/bin/env python3
"""
Docker socket helpers used by docker-entrypoint.sh.

Subcommands (stdlib-only, no extra deps):
  network NAME   Print the first non-default Docker network the named container
                 is attached to (e.g. "ix-postgres_default").
  ip NAME        Print the first IPv4 of the named container.
  connect NET    Attach the current container ($HOSTNAME) to network NET.
"""
import json
import os
import socket
import sys
import http.client


class _UnixConn(http.client.HTTPConnection):
    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect("/var/run/docker.sock")


def _request(method, path, body=None):
    conn = _UnixConn("localhost")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    payload = json.dumps(body).encode() if body is not None else None
    conn.request(method, path, body=payload, headers=headers)
    resp = conn.getresponse()
    return resp.status, resp.read()


def _inspect(container):
    status, body = _request("GET", f"/containers/{container}/json")
    if status != 200:
        sys.exit(1)
    return json.loads(body)


def cmd_network(container):
    nets = _inspect(container).get("NetworkSettings", {}).get("Networks", {}) or {}
    for name in nets:
        if name not in ("bridge", "host", "none"):
            print(name)
            return
    for name in nets:
        print(name)
        return
    sys.exit(1)


def cmd_ip(container):
    nets = _inspect(container).get("NetworkSettings", {}).get("Networks", {}) or {}
    for data in nets.values():
        ip = data.get("IPAddress", "")
        if ip:
            print(ip)
            return
    sys.exit(1)


def cmd_connect(network):
    self_id = os.environ.get("HOSTNAME", "")
    if not self_id:
        sys.exit(1)
    status, body = _request(
        "POST", f"/networks/{network}/connect", body={"Container": self_id}
    )
    if status not in (200, 204, 403):
        sys.stderr.write(f"connect failed status={status} body={body!r}\n")
        sys.exit(1)


def cmd_portainer_redeploy():
    """Trigger a Portainer stack redeploy via the Portainer HTTP API.

    Works for both git-backed stacks (type 1) and compose-file stacks (type 2).
    Resolves the stack by NAME so the numeric ID never needs to be updated,
    even when the stack is deleted and recreated in Portainer.

    Required env vars:
      PORTAINER_URL         e.g. https://192.168.1.132:31015
      PORTAINER_API_KEY     Portainer access token
      PORTAINER_ENDPOINT_ID numeric endpoint/environment id (e.g. 3)

    Stack identification (one of):
      PORTAINER_STACK_NAME  stack name e.g. "rdyroute2"  ← preferred, stable
      PORTAINER_STACK_ID    numeric stack id              ← fallback / override
    """
    import urllib.request
    import ssl

    url        = os.environ.get("PORTAINER_URL", "").rstrip("/")
    api_key    = os.environ.get("PORTAINER_API_KEY", "")
    ep         = os.environ.get("PORTAINER_ENDPOINT_ID", "")
    stack_name = os.environ.get("PORTAINER_STACK_NAME", "").strip()
    stack_id   = os.environ.get("PORTAINER_STACK_ID", "").strip()

    # Validate required vars
    missing = [k for k, v in {
        "PORTAINER_URL": url,
        "PORTAINER_API_KEY": api_key,
        "PORTAINER_ENDPOINT_ID": ep,
    }.items() if not v]
    if missing:
        sys.stderr.write(f"portainer_redeploy: missing env vars: {', '.join(missing)}\n")
        sys.exit(1)
    if not stack_name and not stack_id:
        sys.stderr.write(
            "portainer_redeploy: set PORTAINER_STACK_NAME (e.g. rdyroute2) "
            "or PORTAINER_STACK_ID\n"
        )
        sys.exit(1)

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # self-signed cert on Portainer

    def _get(path: str):
        r = urllib.request.Request(f"{url}{path}", headers={"X-API-Key": api_key})
        with urllib.request.urlopen(r, context=ctx, timeout=15) as resp:  # noqa: S310
            return json.loads(resp.read().decode(errors="replace"))

    # ── Resolve stack ID from name if needed ─────────────────────────────────
    if stack_name and not stack_id:
        try:
            all_stacks = _get("/api/stacks")
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"portainer_redeploy: could not list stacks: {exc}\n")
            sys.exit(1)

        match = next((s for s in all_stacks if s.get("Name") == stack_name), None)
        if match is None:
            available = [s.get("Name", "?") for s in all_stacks]
            sys.stderr.write(
                f"portainer_redeploy: stack '{stack_name}' not found. "
                f"Available: {available}\n"
            )
            sys.exit(1)

        stack_id = str(match["Id"])
        sys.stdout.write(
            f"portainer_redeploy: resolved '{stack_name}' → stack ID {stack_id}\n"
        )

    # ── Fetch stack metadata (type + env) ────────────────────────────────────
    current_env: list = []
    stack_type: int = 2  # default: compose file stack
    try:
        stack_info = _get(f"/api/stacks/{stack_id}")
        current_env = stack_info.get("Env") or []
        stack_type  = stack_info.get("Type", 2)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"portainer_redeploy: could not fetch stack info: {exc}\n")
        sys.exit(1)

    # ── Build redeploy request based on stack type ───────────────────────────
    if stack_type == 1:
        # Git-backed stack — use the git/redeploy shortcut
        endpoint = f"{url}/api/stacks/{stack_id}/git/redeploy?endpointId={ep}"
        payload = json.dumps({
            "prune": False,
            "pullImage": True,
            "repositoryAuthentication": False,
            "repositoryReferenceName": "refs/heads/main",
            "env": current_env,
        }).encode()
    else:
        # Compose-file stack (type 2) — must supply the current stack file
        try:
            file_info = _get(f"/api/stacks/{stack_id}/file")
            stack_file_content = file_info.get("StackFileContent", "")
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"portainer_redeploy: could not fetch stack file: {exc}\n")
            sys.exit(1)

        endpoint = f"{url}/api/stacks/{stack_id}?endpointId={ep}"
        payload = json.dumps({
            "env": current_env,
            "prune": False,
            "pullImage": True,
            "stackFileContent": stack_file_content,
        }).encode()

    # ── Fire the redeploy ────────────────────────────────────────────────────
    redeploy_req = urllib.request.Request(
        endpoint,
        data=payload,
        method="PUT",
        headers={"Content-Type": "application/json", "X-API-Key": api_key},
    )
    try:
        with urllib.request.urlopen(redeploy_req, context=ctx, timeout=120) as resp:  # noqa: S310
            body = resp.read().decode(errors="replace")
            sys.stdout.write(f"portainer_redeploy: status={resp.status}\n{body[:500]}\n")
            if resp.status not in (200, 204):
                sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"portainer_redeploy: {exc}\n")
        sys.exit(1)


def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    cmd = sys.argv[1]
    args = sys.argv[2:]
    if cmd == "network" and args:
        cmd_network(args[0])
    elif cmd == "ip" and args:
        cmd_ip(args[0])
    elif cmd == "connect" and args:
        cmd_connect(args[0])
    elif cmd == "portainer_redeploy":
        cmd_portainer_redeploy()
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
