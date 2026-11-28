"""Collect calibrated MQTT logger messages on site and export closed evidence windows."""
import argparse
import base64
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import ssl
import sys
import tempfile
from uuid import UUID, NAMESPACE_URL, uuid5

import paho.mqtt.client as mqtt

REFERENCE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}")
INSTANT = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)")
MAX_PAYLOAD = 4096


def stamp(at):
    return at.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def instant(value):
    if not isinstance(value, str) or not INSTANT.fullmatch(value):
        raise ValueError("Supply an ISO timestamp with timezone and at most milliseconds.")
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value)


def config(path):
    cfg = json.loads(path.read_bytes())
    for name in ("siteRef", "expectedSerial", "calibrationRef", "decisionOwnerRef"):
        if not REFERENCE.fullmatch(cfg[name]):
            raise ValueError("Invalid site, instrument or calibration reference.")
    host, topic, port = cfg["host"], cfg["topic"], cfg["port"]
    if (not re.fullmatch(r"[A-Za-z0-9.:-]{1,253}", host) or not 1 <= len(topic.encode()) <= 256
            or any(c in topic for c in ("#", "+", "\0")) or topic.startswith("$") or type(port) is not int or not 1 <= port <= 65535):
        raise ValueError("Configure one broker and an exact device topic.")
    for field, limit in (("maxGapSeconds", 86400), ("maxDeliveryDelaySeconds", 3600)):
        if type(cfg[field]) is not int or not 1 <= cfg[field] <= limit:
            raise ValueError("Invalid logger time limit.")
    if not all(numeric(cfg[k]) for k in ("minimumC", "maximumC")) or cfg["minimumC"] >= cfg["maximumC"]:
        raise ValueError("Configure ordered Celsius operating limits.")
    cfg["controlId"] = str(UUID(cfg["controlId"]))
    cfg["calibratedAt"], cfg["calibrationDue"] = (stamp(instant(cfg[k])) for k in ("calibratedAt", "calibrationDue"))
    if cfg["calibratedAt"] >= cfg["calibrationDue"]:
        raise ValueError("Configure an ordered calibration period.")
    if sha((path.parent / cfg["calibrationFile"]).read_bytes()) != cfg["calibrationSha256"]:
        raise ValueError("Calibration document differs from its approved digest.")
    identity = {k: cfg[k] for k in ("host", "port", "topic", "controlId", "siteRef", "expectedSerial",
                "calibrationRef", "calibrationSha256", "calibratedAt", "calibrationDue", "decisionOwnerRef",
                "minimumC", "maximumC", "maxGapSeconds", "maxDeliveryDelaySeconds")}
    cfg["scope"] = sha(encoded(identity))[:24]
    return cfg


def open_spool(path, scope):
    db = sqlite3.connect(path, timeout=20)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS binding(id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS samples(at TEXT PRIMARY KEY, value REAL NOT NULL, arrived TEXT NOT NULL, payload BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS issues(at TEXT, reason TEXT, digest TEXT, source BLOB, PRIMARY KEY(at,reason,digest));
      CREATE UNIQUE INDEX IF NOT EXISTS replayed_exception ON issues(reason,digest)
        WHERE reason IN ('late-reading','late-excursion','conflicting-reading');
    """)
    with db:
        db.execute("INSERT OR IGNORE INTO binding VALUES(1,?)", (scope,))
    if db.execute("SELECT scope FROM binding WHERE id=1").fetchone()[0] != scope:
        db.close()
        raise ValueError("Use the spool for this instrument and approved configuration.")
    return db


def store(db, cfg, message, arrival):
    if message.topic != cfg["topic"]:
        raise ValueError("Broker returned an unexpected topic.")
    if message.retain:
        return  # A retained snapshot delivered on subscription cannot establish a fresh sample.
    received = stamp(arrival)
    evidence_time, issue, source_payload = received, None, None
    if message.qos != 1:
        issue = "unconfirmed-delivery"
    elif len(message.payload) > MAX_PAYLOAD:
        issue = "oversize-payload"
    else:
        try:
            source = json.loads(message.payload)
            if source["serial"] != cfg["expectedSerial"] or source["unit"] != "Cel" or not numeric(source["value"]):
                raise ValueError()
            at = instant(source["at"])
            delay = arrival - at
            if delay < timedelta(0):
                issue = "future-timestamp"
            elif delay > timedelta(seconds=cfg["maxDeliveryDelaySeconds"]):
                previous = db.execute("SELECT value FROM samples WHERE at=?", (stamp(at),)).fetchone()
                if previous and previous[0] == source["value"]:
                    return
                issue = "late-reading" if cfg["minimumC"] <= source["value"] <= cfg["maximumC"] else "late-excursion"
                source_payload = message.payload
            else:
                evidence_time = stamp(at)
        except (ValueError, KeyError, TypeError, OverflowError, RecursionError):
            issue = "unrecognised-reading"
    with db:
        if not issue:
            inserted = db.execute("INSERT OR IGNORE INTO samples VALUES(?,?,?,?)",
                                  (evidence_time, float(source["value"]), received, message.payload))
            if inserted.rowcount:
                return
            previous = db.execute("SELECT value FROM samples WHERE at=?", (evidence_time,)).fetchone()[0]
            if previous == source["value"]:
                return
            issue = "conflicting-reading"
            source_payload = message.payload
        db.execute("INSERT OR IGNORE INTO issues VALUES(?,?,?,?)", (evidence_time, issue, sha(message.payload), source_payload))


def listen(cfg, directory, db):
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="rp-" + cfg["scope"][:20],
                         clean_session=False, protocol=mqtt.MQTTv311, manual_ack=True)
    tls = ssl.create_default_context(cafile=str(directory / cfg["brokerCA"]))
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(directory / cfg["clientCertificate"], directory / cfg["clientPrivateKey"])
    client.tls_set_context(tls)

    def connected(connection, userdata, flags, result, properties):
        if result.is_failure:
            raise ValueError("The broker refused this instrument connection.")
        if connection.subscribe(cfg["topic"], qos=1)[0] != mqtt.MQTT_ERR_SUCCESS:
            raise ValueError("The broker could not start the logger subscription.")

    def subscribed(connection, userdata, mid, grants, properties):
        if len(grants) != 1 or grants[0].value != 1:
            raise ValueError("The logger requires an authorised QoS 1 subscription.")
        print("Subscribed to the configured logger.", flush=True)

    def reading(connection, userdata, message):
        store(db, cfg, message, datetime.now(timezone.utc))
        if message.qos == 1 and connection.ack(message.mid, message.qos) != mqtt.MQTT_ERR_SUCCESS:
            raise OSError("The reading was stored but its broker acknowledgement failed.")

    client.on_connect, client.on_subscribe, client.on_message = connected, subscribed, reading
    client.connect(cfg["host"], cfg["port"], keepalive=30)
    try:
        client.loop_forever()
    finally:
        client.disconnect()


def export(cfg, db, start, end, destination):
    now = datetime.now(timezone.utc)
    if start >= end or end-start > timedelta(days=7) or end > now-timedelta(seconds=cfg["maxDeliveryDelaySeconds"]):
        raise ValueError("Choose a closed window after its permitted delivery delay.")
    lower, upper, scope = stamp(start), stamp(end), cfg["scope"]
    db.execute("BEGIN")
    try:
        rows = db.execute("SELECT at,value,arrived,payload FROM samples WHERE at>? AND at<=? ORDER BY at LIMIT 289", (lower, upper)).fetchall()
        issues = db.execute("SELECT at,reason,digest,source FROM issues WHERE at>? AND at<=? ORDER BY at,reason,digest LIMIT 1025", (lower, upper)).fetchall()
    finally:
        db.rollback()
    if len(rows) > 288 or len(issues) > 1024:
        raise ValueError("Select a shorter window to preserve all source records.")
    samples = [{"at": at, "value": value} for at, value, _, _ in rows]
    key = str(uuid5(NAMESPACE_URL, "regpilot:mqtt:" + scope + ":" + lower + ":" + upper))
    lines = [encoded({"at": at, "arrived": arrived, "payloadBase64": base64.b64encode(raw).decode()}) + b"\n"
             for at, _, arrived, raw in rows]
    for at, reason, digest, raw in issues:
        line = {"at": at, "issue": reason, "payloadSha256": digest}
        if raw is not None:
            line["exceptionPayloadBase64"] = base64.b64encode(raw).decode()
        lines.append(encoded(line) + b"\n")
    source = b"".join(lines)
    record = {"kind": "LOGGER_WINDOW", "siteRef": cfg["siteRef"], "sensorRef": cfg["expectedSerial"],
              "calibrationRef": cfg["calibrationRef"], "calibratedAt": cfg["calibratedAt"], "calibrationDue": cfg["calibrationDue"],
              "minimum": cfg["minimumC"], "maximum": cfg["maximumC"], "unit": "CELSIUS", "maxGapSeconds": cfg["maxGapSeconds"],
              "windowStart": lower, "windowEnd": upper, "samples": samples, "rawFileSha256": sha(source)}
    reasons = [row[1] for row in issues]
    integrity = "FAIL" if "conflicting-reading" in reasons else "UNKNOWN" if issues else "PASS"
    checks = [{"key": "source-integrity", "label": "MQTT source messages", "status": integrity,
               "observed": f"{len(rows)} distinct samples and {len(issues)} source exceptions."},
              {"key": "delayed-excursions", "label": "Late out-of-range source readings",
               "status": "FAIL" if "late-excursion" in reasons else "PASS",
               "observed": f"{reasons.count('late-excursion')} delayed out-of-range messages received during this window."},
              {"key": "calibration-file", "label": "Configured calibration file fingerprint", "status": "PASS",
               "observed": "SHA256 " + cfg["calibrationSha256"]}]
    envelope = {"idempotencyKey": key, "body": {"externalId": f"mqtt/{scope}/{key}", "controlId": cfg["controlId"],
                "observedAt": upper, "validUntil": stamp(end+timedelta(hours=2)),
                "summary": "Site MQTT temperature window with source timestamps and calibration evidence.", "checks": checks,
                "partnerRecord": {"schemaVersion": 1, "recordId": "mqtt/" + key, "revision": 1, "state": "CURRENT",
                                  "sourceSystem": "Site MQTT temperature logger", "sourceVersion": "mqtt-3.1.1-v1",
                                  "decisionOwnerRef": cfg["decisionOwnerRef"], "record": record}}}
    destination = destination.absolute()
    files = {"source.jsonl": source, "receipt.json": encoded(envelope) + b"\n"}
    if destination.exists():
        if all((destination / name).read_bytes() == data for name, data in files.items()):
            return
        raise ValueError("The existing evidence directory contains a different capture.")
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        staged = Path(temporary) / "window"
        staged.mkdir(mode=0o700)
        for name, data in files.items():
            with (staged / name).open("wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        staged.rename(destination)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    for name in ("listen", "export"):
        command = commands.add_parser(name)
        command.add_argument("--config", type=Path, required=True)
        command.add_argument("--spool", type=Path, required=True)
        if name == "export":
            command.add_argument("--start", type=instant, required=True)
            command.add_argument("--end", type=instant, required=True)
            command.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    cfg = config(args.config)
    if args.action == "export" and not args.spool.is_file():
        raise ValueError("Use the existing instrument spool.")
    with closing(open_spool(args.spool, cfg["scope"])) as db:
        if args.action == "listen":
            listen(cfg, args.config.parent, db)
        else:
            export(cfg, db, args.start, args.end, args.out)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error) as exc:
        sys.exit("MQTT collection failed: " + str(exc))
