"""Exercise the shipped logger against a local Mosquitto broker with separate mutual TLS identities."""
import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import socket
import sqlite3
import ssl
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
import time
from uuid import uuid4

import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parents[1]
COLLECTOR = ROOT / "public/instrument-bridge/mqtt_logger.py"


def stamp(at):
    return at.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def now():
    return datetime.now(timezone.utc)


def certificates(work):
    def openssl(*args):
        subprocess.run(["openssl", *args], cwd=work, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    openssl("req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "2", "-subj", "/CN=QA-site-CA",
            "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", "ca.key", "-out", "ca.crt")
    for name, cn, usage in (("server", "localhost", "serverAuth"), ("reader", "reader", "clientAuth"),
                            ("renewed", "reader", "clientAuth"), ("publisher", "publisher", "clientAuth")):
        (work/"ext").write_text("extendedKeyUsage="+usage+"\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n")
        openssl("req", "-nodes", "-newkey", "rsa:2048", "-subj", "/CN="+cn, "-out", name+".csr", "-keyout", name+".key")
        openssl("x509", "-req", "-in", name+".csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial",
                "-days", "1", "-extfile", "ext", "-out", name+".crt")


def verify(work, output, control, retained_site):
    binary = os.environ.get("REGPILOT_MOSQUITTO") or shutil.which("mosquitto")
    if not binary:
        raise RuntimeError("Mosquitto is required for the real broker check.")
    certificates(work)
    with socket.socket() as port_picker:
        port_picker.bind(("127.0.0.1", 0))
        port = port_picker.getsockname()[1]
    topic = "facility/temperature/T7"
    (work/"acl").write_text(f"user reader\ntopic read {topic}\nuser publisher\ntopic write {topic}\n")
    (work/"mosquitto.conf").write_text(f"listener {port} 127.0.0.1\ncafile {work}/ca.crt\ncertfile {work}/server.crt\n"
        f"keyfile {work}/server.key\nrequire_certificate true\nuse_identity_as_username true\nallow_anonymous false\nacl_file {work}/acl\n")
    certificate = b"Synthetic QA calibration for T7 only."
    (work/"cal.txt").write_bytes(certificate)
    cfg = dict(host="127.0.0.1", port=port, topic=topic, siteRef="QA-site", expectedSerial="T7", decisionOwnerRef="quality",
               minimumC=2, maximumC=8, maxGapSeconds=10, maxDeliveryDelaySeconds=3, controlId=control, calibrationRef="QA-calibration",
               calibrationFile="cal.txt", calibrationSha256=hashlib.sha256(certificate).hexdigest(), calibratedAt=stamp(now()-timedelta(days=1)),
               calibrationDue=stamp(now()+timedelta(days=1)), brokerCA="ca.crt", clientCertificate="reader.crt", clientPrivateKey="reader.key")
    path, spool = work/"config.json", work/"spool.sqlite"
    path.write_text(json.dumps(cfg))
    endpoint = ["--config", str(path), "--spool", str(spool)]
    broker = subprocess.Popen([binary, "-c", str(work/"mosquitto.conf")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    reader = None
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    ready = threading.Event()
    tls = ssl.create_default_context(cafile=str(work/"ca.crt"))
    tls.load_cert_chain(work/"publisher.crt", work/"publisher.key")
    client.tls_set_context(tls)
    client.on_connect = lambda cl, obj, flags, rc, props: ready.set() if not rc.is_failure else None

    def subscribe():
        process = subprocess.Popen([sys.executable, str(COLLECTOR), "listen", *endpoint], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        with selectors.DefaultSelector() as wait:
            wait.register(process.stdout, selectors.EVENT_READ)
            if wait.select(12) and "Subscribed" in process.stdout.readline():
                return process
        process.kill()
        raise RuntimeError("Site subscription failed. " + process.communicate()[1])

    def publish(at, value, retained=False, serial="T7"):
        data = json.dumps({"at": at, "serial": serial, "value": value, "unit": "Cel"})
        sent = client.publish(topic, data.encode(), qos=1, retain=retained)
        sent.wait_for_publish(4)
        assert sent.is_published()

    def counts(want_samples, want_issues):
        for _ in range(120):
            with sqlite3.connect(spool) as db:
                if db.execute("SELECT (SELECT count(*) FROM samples),(SELECT count(*) FROM issues)").fetchone() == (want_samples,want_issues):
                    return
            time.sleep(.025)
        raise AssertionError("The durable broker readings differ from the expected sample and exception counts.")

    def capture(start, end, target, check=True):
        return subprocess.run([sys.executable, str(COLLECTOR), "export", *endpoint, "--start", stamp(start), "--end", stamp(end), "--out", str(target)],
                              capture_output=True, text=True, check=check)

    try:
        for attempt in range(120):
            try:
                client.connect("127.0.0.1", port)
                break
            except ConnectionRefusedError:
                if broker.poll() is not None:
                    raise RuntimeError("The temporary TLS broker exited.")
                time.sleep(.04)
        client.loop_start()
        assert ready.wait(5)
        clean_start = now() - timedelta(milliseconds=5)
        publish(stamp(now()-timedelta(hours=1)), 15, retained=True)
        reader = subscribe()
        first = stamp(now())
        publish(first, 4)
        publish(first, 4)
        time.sleep(.025)
        publish(stamp(now()), 5)
        counts(2, 0)
        clean_end = now()
        reader.terminate()
        reader.wait(timeout=5)
        # The persistent subscription must collect the reading queued during credential replacement.
        time.sleep(.025)
        excursion_time = stamp(now())
        publish(excursion_time, 10)
        cfg.update(clientCertificate="renewed.crt", clientPrivateKey="renewed.key")
        path.write_text(json.dumps(cfg))
        reader = subscribe()
        counts(3, 0)
        publish(excursion_time, 10)
        publish(stamp(now()-timedelta(hours=2)), 6)
        publish(stamp(now()), 7, serial="different-device")
        publish(excursion_time, 11)
        counts(3, 3)
        end = now()
        time.sleep(.025)
        late_time = stamp(now()-timedelta(hours=2))
        publish(late_time, 17)
        counts(3, 4)
        late_end = now()
        assert capture(clean_start, end, work/"too-early", check=False).returncode
        time.sleep(cfg["maxDeliveryDelaySeconds"]+.05)
        output_window = work/"combined"
        capture(clean_start, clean_end, work/"clean")
        capture(end, late_end, work/"late")
        capture(clean_start, end, output_window)
        capture(clean_start, end, output_window)
        capture(clean_start-timedelta(minutes=5), clean_start-timedelta(minutes=4), work/"missing")
        envelope = json.loads((output_window/"receipt.json").read_bytes())
        record = envelope["body"]["partnerRecord"]["record"]
        archive = (output_window/"source.jsonl").read_bytes()
        assert hashlib.sha256(archive).hexdigest() == record["rawFileSha256"]
        archived = [json.loads(line) for line in archive.splitlines()]
        assert [json.loads(base64.b64decode(item["payloadBase64"]))["value"] for item in archived if "payloadBase64" in item] == [4, 5, 10]
        assert {item["issue"] for item in archived if "issue" in item} == {"late-reading","unrecognised-reading","conflicting-reading"}
        assert record["samples"][-1] == {"at":excursion_time, "value":10}
        late = json.loads((work/"late/receipt.json").read_bytes())
        assert not late["body"]["partnerRecord"]["record"]["samples"]
        assert next(c for c in late["body"]["checks"] if c["key"] == "delayed-excursions")["status"] == "FAIL"
        late_raw = json.loads((work/"late/source.jsonl").read_bytes())
        assert json.loads(base64.b64decode(late_raw["exceptionPayloadBase64"]))["value"] == 17
        publish(first, 4)  # An acknowledged reading redelivered after its time limit stays a duplicate.
        publish(late_time, 17)
        publish(stamp(now()), 5)  # The later packet confirms receipt of both preceding replays.
        counts(4, 4)
        cfg["calibrationSha256"] = "0"*64
        path.write_text(json.dumps(cfg))
        assert "Calibration document differs" in capture(clean_start, end, work/"bad", check=False).stderr
        cfg["calibrationSha256"] = hashlib.sha256(certificate).hexdigest()
        path.write_text(json.dumps(cfg))
        if retained_site:
            retained_site.mkdir(mode=0o700)
            shutil.copyfile(path,retained_site/"config.json")
            shutil.copyfile(work/"cal.txt",retained_site/"cal.txt")
            with sqlite3.connect(spool) as source, sqlite3.connect(retained_site/"spool.sqlite") as copy:
                source.backup(copy)
        # Exercise the durable interval cursor across a multi-hour destination outage.
        sys.path.insert(0,str(COLLECTOR.parent))
        import mqtt_forward as forward
        from deliver import DeliveryRejected
        from mqtt_logger import config as load_config, open_spool
        settings = load_config(path)
        def unavailable(origin, envelope, token):
            raise ConnectionError("Controlled loss of transport")
        def restore(origin, envelope, token):
            if envelope["body"]["validUntil"] < stamp(now()):
                raise DeliveryRejected(400,"invalid_observation_window")
            return {"idempotencyKey":envelope["idempotencyKey"],"id":str(uuid4())}
        from contextlib import closing
        archive, origin = work/"archive", "https://fixture.example.invalid"
        with closing(open_spool(spool,settings["scope"])) as samples:
            try:
                forward.tick(settings,samples,archive,origin,3600,"fixture",unavailable,now()-timedelta(hours=5))
            except ConnectionError:
                pass
            else:
                raise AssertionError("Expected an unconfirmed delivery")
            recovered = forward.tick(settings,samples,archive,origin,3600,"fixture",restore)
            assert recovered["acknowledged"] and recovered["expiredUndelivered"] and not recovered["pending"]
            with sqlite3.connect(archive/"delivery.sqlite") as index:
                for end, status, ack in index.execute("SELECT end,status,ack FROM windows"):
                    assert (archive/str(end)/"source.jsonl").is_file()
                    assert bool(ack) == (status=="ACKNOWLEDGED")
            try:
                forward.tick(settings,samples,archive,"https://different.example.invalid",3600,"fixture",restore)
            except ValueError:
                pass
            else:
                raise AssertionError("A different workspace cannot reuse the archive")
        report = {"provenance":"Local Eclipse Mosquitto with mutual TLS and synthetic logger readings and calibration.",
                  "controlledOutageRecovery":recovered,"distinctSamplesInCombinedWindow":3,"sourceExceptions":4,"lateExcursionDeniedFreshness":True,"late":late,"retainedExcluded":True,"duplicateExcluded":True,
                  "queuedReadingRecoveredAfterCertificateRotation":True,"archiveHashVerified":True,"excursion":envelope,
                  "baseline":json.loads((work/"clean/receipt.json").read_bytes()),"missing":json.loads((work/"missing/receipt.json").read_bytes())}
        output.write_text(json.dumps(report, indent=2)+"\n")
        print("Verified authenticated logger capture, certificate rotation, offline QoS delivery, deduplication and exact source archive.")
    finally:
        if reader and reader.poll() is None:
            reader.terminate()
            reader.wait(timeout=5)
        client.disconnect()
        client.loop_stop()
        broker.terminate()
        broker.wait(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--control", default=str(uuid4()))
    parser.add_argument("--site",type=Path,help="Keep the synthetic spool for the HTTPS acceptance test")
    args = parser.parse_args()
    with TemporaryDirectory() as tmp:
        verify(Path(tmp), args.output, args.control, args.site)
