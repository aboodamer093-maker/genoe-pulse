"""GENOE — one-shot curl_cffi TLS client for the wire-parity probe.
Connects to the local capture server using the requested Safari
impersonation profile (BoringSSL). Verification is disabled: only the
ClientHello matters; the server aborts the handshake after capture.
"""
import argparse
import sys

from curl_cffi import requests


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--url", required=True)
    args = ap.parse_args()

    try:
        with requests.Session(impersonate=args.profile, verify=False, timeout=8) as s:
            s.get(args.url)
    except Exception:
        # handshake abort after ClientHello is EXPECTED — not a failure
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())