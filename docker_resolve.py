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
    """Trigger a Portainer git-stack redeploy via the Portainer HTTP API.

    Required env vars (set in docker-compose.prod.yml or .env.production):
      PORTAINER_URL         e.g. https://192.168.1.132:31015
      PORTAINER_API_KEY     Portainer access token (Settings → Users → Access tokens)
      PORTAINER_STACK_ID    numeric stack id (42 for readyroute)
      PORTAINER_ENDPOINT_ID numeric endpoint/environment id (3 for local)
    """
    import urllib.request
    import ssl

    url     = os.environ.get("PORTAINER_URL", "").rstrip("/")
    api_key = os.environ.get("PORTAINER_API_KEY", "")
    stack   = os.environ.get("PORTAINER_STACK_ID", "")
    ep      = os.environ.get("PORTAINER_ENDPOINT_ID", "")

    missing = [k for k, v in {
        "PORTAINER_URL": url,
        "PORTAINER_API_KEY": api_key,
        "PORTAINER_STACK_ID": stack,
        "PORTAINER_ENDPOINT_ID": ep,
    }.items() if not v]
    if missing:
        sys.stderr.write(f"portainer_redeploy: missing env vars: {', '.join(missing)}\n")
        sys.exit(1)

    # Fetch current stack env so we don't wipe it on every redeploy.
    # Portainer's git/redeploy endpoint replaces env with whatever is passed;
    # sending [] would clear all stack vars (including the PORTAINER_* ones).
    current_env: list = []
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # self-signed cert on Portainer

    try:
        get_req = urllib.request.Request(
            f"{url}/api/stacks/{stack}",
            headers={"X-API-Key": api_key},
        )
        with urllib.request.urlopen(get_req, context=ctx, timeout=15) as r:  # noqa: S310
            stack_info = json.loads(r.read().decode(errors="replace"))
            current_env = stack_info.get("Env") or []
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"portainer_redeploy: could not fetch stack env (continuing): {exc}\n")

    endpoint = f"{url}/api/stacks/{stack}/git/redeploy?endpointId={ep}"

    payload = json.dumps({
        "prune": False,
        "pullImage": True,
        "repositoryAuthentication": False,
        "repositoryReferenceName": "refs/heads/main",
        "env": current_env,
    }).encode()

    req = urllib.request.Request(
        endpoint,
        data=payload,
        method="PUT",
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
        },
    )
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:  # noqa: S310
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
