"""GENOE — external wire verification client.
Connects to an INDEPENDENT third-party TLS-fingerprint service using the
requested curl_cffi Safari profile and prints the service's own JSON
(ja4/ja3 as observed by the outside world). The parity claim must then
match what a neutral external server measured — not our own server.
"""
import argparse
import sys

from curl_cffi import requests


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--service", default="https://tls.peet.ws/api/all")
    args = ap.parse_args()
    try:
        with requests.Session(impersonate=args.profile, timeout=25) as s:
            r = s.get(args.service)
        sys.stdout.write(r.text)
        return 0
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("WIRE-VERIFY PY ERROR " + repr(e) + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())