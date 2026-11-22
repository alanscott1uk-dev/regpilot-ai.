"""Read a configured OPC UA instrument and write one RegPilot observation envelope."""
import argparse
import asyncio
import hashlib
import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from asyncua import Client, ua
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256


def timestamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def check(key, label, result, observed):
    state = "UNKNOWN" if result is None else "PASS" if result else "FAIL"
    return dict(key=key, label=label, status=state, observed=observed)


async def capture(config, directory):
    endpoint = urlsplit(config["endpoint"])
    if endpoint.scheme != "opc.tcp" or not endpoint.hostname or endpoint.username or endpoint.password:
        raise ValueError("Choose an OPC UA endpoint with a hostname")
    low, high, max_age = (config[k] for k in ("minimumC", "maximumC", "maxAgeMinutes"))
    if not finite(low) or not finite(high) or low >= high or not finite(max_age) or not 0 < max_age <= 1440:
        raise ValueError("Invalid operating limits or maximum reading age")
    control = str(UUID(config["controlId"]))
    expected = config["expectedSerial"]
    if not isinstance(expected, str) or not 1 <= len(expected) <= 90:
        raise ValueError("Invalid expected serial")
    cert = directory / config["calibrationFile"]
    digest = hashlib.sha256(cert.read_bytes()).hexdigest()
    if digest != config["calibrationSha256"]:
        raise ValueError("Calibration document differs from its approved digest")
    start = datetime.fromisoformat(config["validFrom"])
    end = datetime.fromisoformat(config["validUntil"])
    if start.tzinfo is None or end.tzinfo is None or start >= end:
        raise ValueError("Calibration dates require an ordered range with timezones")
    client = Client(config["endpoint"], timeout=10)
    client.application_uri = config["applicationUri"]
    await client.set_security(SecurityPolicyBasic256Sha256, str(directory / config["clientCertificate"]),
                              str(directory / config["clientPrivateKey"]), server_certificate=str(directory / config["serverCertificate"]),
                              mode=ua.MessageSecurityMode.SignAndEncrypt)
    async with client:
        ns = await client.get_namespace_index(config["namespaceUri"])
        device = client.get_node(ua.NodeId(config["objectIdentifier"], ns))
        fields = [config["serialField"], config["unitField"], config["valueField"]]
        if len(set(fields)) != 3:
            raise ValueError("The serial, unit and reading require distinct source fields")
        serial_node, unit_node, value_node = [await device.get_child([ua.QualifiedName(name, ns)]) for name in fields]
        serial = await serial_node.read_value()
        if serial != expected:
            raise ValueError("Instrument serial differs from the approved instrument")
        unit = await unit_node.read_value()
        reading = await value_node.read_data_value(raise_on_bad_status=False)
        if await serial_node.read_value() != expected or await unit_node.read_value() != unit:
            raise ValueError("Instrument identity or unit changed during collection")
    now = datetime.now(timezone.utc)
    stamp = reading.SourceTimestamp
    known_time = stamp is not None and stamp.tzinfo is not None and stamp <= now
    value = reading.Value.Value if reading.Value is not None else None
    celsius = unit in ("Cel", "°C", "degC")
    good = reading.StatusCode.is_good()
    checks = [
        check("instrument-identity", "Pinned endpoint and exact instrument serial", True, expected),
        check("reading-quality", "Source reports good data quality", good, reading.StatusCode.name),
        check("celsius-unit", "Instrument reports Celsius", celsius, "Celsius" if celsius else "Different or unrecognised unit"),
        check("sample-age", "Sample within configured maximum age", now-stamp <= timedelta(minutes=max_age) if known_time else None,
              timestamp(stamp) if stamp and stamp.tzinfo else "Source timestamp unavailable"),
        check("temperature-limits", "Reported reading within configured limits", low <= value <= high if good and celsius and finite(value) else None,
              f"{value} °C, limits {low} to {high} °C" if good and celsius and finite(value) else "Reading or unit unavailable"),
        check("calibration-period", "Configured certificate period covers the sample", start <= stamp < end if known_time else None,
              "SHA256 " + digest + ", valid to " + timestamp(end))
    ]
    key = str(uuid4())
    return {"idempotencyKey": key, "body": {"externalId": "opcua/" + key, "controlId": control, "observedAt": timestamp(now),
            "validUntil": timestamp(now+timedelta(hours=24)), "summary": "Point observation from the configured OPC UA instrument. Compare the certificate, limits and reading against the quality record.", "checks": checks}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("receipt", type=Path)
    args = parser.parse_args()
    if args.receipt.exists():
        parser.error("Use the saved receipt for retry, or choose a new file for a new reading")
    receipt = asyncio.run(capture(json.loads(args.config.read_text()), args.config.resolve().parent))
    # Publish only a complete envelope. An existing delivery key is never replaced.
    temp = args.receipt.with_name("." + str(uuid4()) + ".tmp")
    try:
        with os.fdopen(os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w") as out:
            json.dump(receipt, out, indent=2)
            out.flush()
            os.fsync(out.fileno())
        os.link(temp, args.receipt)
    finally:
        temp.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
