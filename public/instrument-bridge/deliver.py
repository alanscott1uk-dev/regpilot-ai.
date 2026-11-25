"""Submit a saved source observation to the RegPilot workspace chosen by the operator."""
import argparse
import getpass
import http.client
import json
import os
import re
import ssl
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID


def preview_headers(origin, environ):
    token = environ.get("REGPILOT_PREVIEW_TOKEN", "")
    if not token:
        return {}
    trusted = environ.get("REGPILOT_PREVIEW_ORIGIN", "").rstrip("/")
    if (origin.rstrip("/") != trusted or not token.isascii() or len(token) > 512
            or any(ord(char) <= 32 or ord(char) >= 127 for char in token)):
        raise ValueError("The protected preview origin or credential does not match the authorised destination")
    return {"x-vercel-protection-bypass": token}


def deliver(origin, envelope, credential):
    url = urlsplit(origin)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
        raise ValueError("Configure the HTTPS origin of your authorised RegPilot workspace")
    key = str(UUID(envelope["idempotencyKey"]))
    body = envelope["body"]
    reference = body["externalId"].split("/")
    database_source = (len(reference) == 3 and reference[0] == "dbsync" and reference[2] == key
                       and str(UUID(reference[1])) == reference[1])
    scoped = (len(reference) == 3 and reference[0] in ("cadence", "iac") and
               re.fullmatch("[0-9a-f]{24}", reference[1]) and reference[2] == key)
    if body["externalId"] != "opcua/" + key and not database_source and not scoped:
        raise ValueError("The source reference differs from the saved delivery key")
    if not credential or not credential.isascii() or any(ord(c) < 33 or ord(c) > 126 for c in credential):
        raise ValueError("A workspace observation credential is required")
    payload = json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if len(payload) > 32768:
        raise ValueError("Observation exceeds the intake limit")
    extra_headers = preview_headers(origin, os.environ)
    client = http.client.HTTPSConnection(url.hostname, url.port or 443, timeout=20, context=ssl.create_default_context())
    try:
        client.request("POST", "/api/v1/observations", body=payload, headers={
            "Authorization": "Bearer " + credential, "Content-Type": "application/json", "Idempotency-Key": key, **extra_headers})
        response = client.getresponse()
        if response.status != 201:
            raise ValueError(f"RegPilot returned HTTP {response.status}. Retain this envelope for retry.")
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError("The acknowledgement exceeded the supported size")
        row = json.loads(raw)
        receipt_id = str(UUID(row["id"]))
        if row.get("controlId") != body["controlId"] or row.get("externalId") != body["externalId"] or type(row.get("reused")) is not bool:
            raise ValueError("The acknowledgement could not be matched to this observation")
        return {"id": receipt_id, "idempotencyKey": key, "reused": row["reused"]}
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("receipt", type=Path)
    parser.add_argument("--workspace", required=True, help="RegPilot HTTPS origin")
    args = parser.parse_args()
    try:
        if args.receipt.stat().st_size > 36000:
            raise ValueError("The saved envelope exceeds the supported size")
        envelope = json.loads(args.receipt.read_text())
        token = os.environ.get("REGPILOT_OBSERVATION_TOKEN") or getpass.getpass("Workspace observation credential: ")
        print(json.dumps(deliver(args.workspace, envelope, token)))
    except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException) as error:
        reason = str(error) if type(error) is ValueError else "Delivery or acknowledgement unavailable. Retry the saved envelope."
        sys.exit(reason)
