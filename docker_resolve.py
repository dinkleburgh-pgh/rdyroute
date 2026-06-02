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
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
