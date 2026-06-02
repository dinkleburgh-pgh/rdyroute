#!/usr/bin/env python3
"""
Query the Docker socket to find the IP of a named container.
Prints the first non-empty IPAddress found across all networks, or nothing.
Used by docker-entrypoint.sh to resolve cross-network postgres hostnames.
"""
import sys
import http.client
import socket
import json


class _UnixConn(http.client.HTTPConnection):
    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect("/var/run/docker.sock")


def main() -> None:
    container = sys.argv[1]
    conn = _UnixConn("localhost")
    conn.request("GET", f"/containers/{container}/json")
    resp = conn.getresponse()
    if resp.status != 200:
        sys.exit(1)
    body = json.loads(resp.read())
    networks = body.get("NetworkSettings", {}).get("Networks", {})
    for info in networks.values():
        ip = info.get("IPAddress", "")
        if ip:
            print(ip)
            return


if __name__ == "__main__":
    main()
