"""Run the shipping reader against a real encrypted server with synthetic measurements."""
import asyncio
import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from asyncua import Server, ua

bridge = Path("public/instrument-bridge")
spec = importlib.util.spec_from_file_location("instrument_reader", bridge / "collect.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


async def run(folder):
    for name, uri in [("server", "urn:regpilot:instrument-server"), ("reader", "urn:regpilot:instrument-reader")]:
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=" + name, "-addext", "subjectAltName=URI:" + uri + ",DNS:localhost,IP:127.0.0.1",
                        "-keyout", str(folder / (name + ".pem")), "-outform", "DER", "-out", str(folder / (name + ".der"))],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    config = json.loads((bridge / "example.json").read_text())
    certificate = b"Synthetic calibration reference for software acceptance only."
    (folder / config["calibrationFile"]).write_bytes(certificate)
    now = datetime.now(timezone.utc)
    config.update(endpoint="opc.tcp://127.0.0.1:4843/", serverCertificate="server.der",
                  validFrom=(now-timedelta(days=1)).isoformat(), validUntil=(now+timedelta(days=1)).isoformat(),
                  calibrationSha256=hashlib.sha256(certificate).hexdigest())
    server = Server()
    await server.init()
    server.set_endpoint(config["endpoint"])
    await server.set_application_uri("urn:regpilot:instrument-server")
    await server.load_certificate(str(folder / "server.der"))
    await server.load_private_key(str(folder / "server.pem"))
    server.set_security_policy([ua.SecurityPolicyType.Basic256Sha256_SignAndEncrypt])
    ns = await server.register_namespace(config["namespaceUri"])
    device = await server.nodes.objects.add_object(ua.NodeId(config["objectIdentifier"], ns), ua.QualifiedName("Instrument", ns))
    serial = await device.add_variable(ns, config["serialField"], config["expectedSerial"])
    unit = await device.add_variable(ns, config["unitField"], "Cel")
    node = await device.add_variable(ns, config["valueField"], 4.5)
    def states(sample):
        return {r["key"]: r["status"] for r in sample["body"]["checks"]}
    async with server:
        baseline = await reader.capture(config, folder)
        assert set(states(baseline).values()) == {"PASS"}
        await node.write_value(9.25)
        excursion = await reader.capture(config, folder)
        assert states(excursion)["temperature-limits"] == "FAIL"
        await unit.write_value("degF")
        wrong_unit = await reader.capture(config, folder)
        assert states(wrong_unit)["temperature-limits"] == "UNKNOWN"
        await serial.write_value("DIFFERENT")
        try:
            await reader.capture(config, folder)
        except ValueError as exc:
            assert "serial" in str(exc)
        else:
            raise AssertionError("Unexpected instrument was accepted")
    Path("live-instrument-evidence.json").write_text(json.dumps({"provenance": "Software OPC UA server. Synthetic serial, calibration and readings.",
         "baseline": baseline, "excursion": excursion, "unknownUnit": wrong_unit, "serialMismatchRejected": True}, indent=2))
    print("Verified an encrypted OPC UA read, excursion, unit change and instrument replacement.")


with tempfile.TemporaryDirectory() as temp:
    asyncio.run(run(Path(temp)))
