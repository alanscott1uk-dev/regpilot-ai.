"""Collect an aggregate control observation from an operator-run Airbyte source."""
import argparse
import hashlib
import json
import math
from decimal import Decimal, InvalidOperation
import os
import re
import selectors
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4


class CollectionError(Exception):
    pass


def pin_image(plan, digest):
    if plan.get("format") != "regpilot-airbyte-source-v1":
        raise CollectionError("Unsupported collection plan.")
    UUID(plan["definitionId"])
    image, version = plan["image"], plan["version"]
    if not re.fullmatch(r"airbyte/source-[a-z0-9][a-z0-9.-]*", image) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?", version):
        raise CollectionError("Invalid source image or version.")
    if digest != plan.get("artifactDigest") or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise CollectionError("Supply the approved image digest matching the checked collection plan.")
    pinned = image + "@" + digest
    check = subprocess.run(["docker", "image", "inspect", "--format", "{{json .RepoDigests}}", image + ":" + version],
                           capture_output=True, timeout=30)
    if check.returncode or pinned not in (json.loads(check.stdout) or []):
        raise CollectionError("The installed source version does not match the approved digest.")
    return pinned


def read_frames(proc, consume):
    deadline = time.monotonic() + 300
    total, pending = 0, b""
    with selectors.DefaultSelector() as selector:
        selector.register(proc.stdout, selectors.EVENT_READ)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise CollectionError("Source command timed out.")
            chunk = os.read(proc.stdout.fileno(), 65536)
            if not chunk:
                break
            total += len(chunk)
            if total > 128 * 1024 * 1024:
                raise CollectionError("Source exceeded the supported collection size.")
            lines = (pending + chunk).split(b"\n")
            pending = lines.pop()
            if len(pending) > 2 * 1024 * 1024:
                raise CollectionError("Source message exceeded the supported size.")
            for line in lines:
                if line.strip():
                    consume(line)
        if pending.strip():
            consume(pending)
    if proc.wait(timeout=max(0.1, deadline - time.monotonic())):
        raise CollectionError("Source command failed. Check the connector version, access and stream selection.")


def protocol(pinned, network, config, command, handler, catalog=None, decimal_records=False):
    name = "regpilot-source-" + uuid4().hex
    argv = ["docker", "run", "--rm", "--pull=never", "--name", name, "--log-driver=none",
            "--network", network, "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--volume", str(config) + ":/tmp/regpilot-config.json:ro"]
    if catalog:
        argv += ["--volume", str(catalog) + ":/tmp/regpilot-catalog.json:ro"]
    argv += [pinned, command, "--config", "/tmp/regpilot-config.json"]
    if catalog:
        argv += ["--catalog", "/tmp/regpilot-catalog.json"]

    def frame(raw):
        # Connector libraries can emit diagnostics outside the Airbyte JSON protocol.
        if not raw.lstrip().startswith(b"{"):
            return
        try:
            obj = json.loads(raw, parse_float=Decimal if decimal_records else float)
            if not isinstance(obj, dict):
                raise ValueError()
        except (UnicodeError, ValueError):
            raise CollectionError("Malformed connector protocol message.") from None
        trace = obj.get("trace") or {}
        if obj.get("type") == "TRACE" and (trace.get("type") == "ERROR" or
                (trace.get("stream_status") or {}).get("status") == "INCOMPLETE"):
            raise CollectionError("The connector reported an incomplete or failed read.")
        handler(obj)

    with subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as proc:
        try:
            read_frames(proc, frame)
        finally:
            if proc.poll() is None:
                proc.kill()
                subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=30)
                proc.wait(timeout=10)


def local_json(folder, name, value):
    path = folder / name
    path.write_text(json.dumps(value, allow_nan=False), encoding="utf-8")
    # Only this file is mounted. The enclosing temporary directory is owner-only.
    path.chmod(0o444)
    return path


def rule_path(field, pointer):
    if field is not None and pointer is None and re.fullmatch(r"[\w.-]{1,100}", field):
        return [field]
    if field is not None or not pointer or len(pointer)>180 or not pointer.startswith("/") or re.search(r"~(?![01])|[\x00-\x1f\x7f]",pointer):
        raise CollectionError("Select one field name or a valid JSON Pointer.")
    return [part.replace("~1","/").replace("~0","~") for part in pointer[1:].split("/")]


def lookup(record, parts):
    value = record
    for key in parts:
        if isinstance(value,dict):
            value = value.get(key)
        elif isinstance(value,list) and re.fullmatch(r"0|[1-9][0-9]{0,8}",key) and int(key)<len(value):
            value = value[int(key)]
        else:
            return None
    return value


def numeric_bounds(minimum, maximum):
    if minimum is None or maximum is None:
        raise CollectionError("Supply both inclusive numeric limits.")
    try:
        bounds = (Decimal(minimum),Decimal(maximum))
        if not all(v.is_finite() for v in bounds) or bounds[0]>bounds[1]:
            raise ValueError()
        return bounds
    except (InvalidOperation,ValueError):
        raise CollectionError("Supply finite numeric limits in ascending order.") from None


def run(args):
    plan = json.loads(args.plan.read_text())
    if plan.get("format") == "regpilot-airbyte-manifest-v1":
        if not args.source:
            raise CollectionError("Select a definition UUID with --source when using a bulk manifest.")
        candidates = [p for p in plan["plans"] if p.get("definitionId") == str(UUID(args.source))]
        if len(candidates) != 1:
            raise CollectionError("The selected source is missing or ambiguous in this manifest.")
        plan = candidates[0]
    elif args.source and str(UUID(args.source)) != plan.get("definitionId"):
        raise CollectionError("The selected source differs from the downloaded plan.")
    pinned = pin_image(plan, args.digest)
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}", args.network) or args.network in ("host", "none"):
        raise CollectionError("Select a bridge network with authorised source access.")
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp).resolve()
        if ":" in str(folder):
            raise CollectionError("Select a temporary directory without a colon in its path.")
        config = local_json(folder, "config.json", json.loads(args.config.read_text()))
        if args.check_access:
            statuses = []
            def connection(msg):
                if msg.get("type") == "CONNECTION_STATUS":
                    statuses.append(msg["connectionStatus"]["status"])
            protocol(pinned, args.network, config, "check", connection)
            if statuses != ["SUCCEEDED"]:
                raise CollectionError("The source did not confirm access.")
            return {"access": "confirmed"}
        streams = []
        def discovered(msg):
            if msg.get("type") == "CATALOG":
                streams.extend(msg["catalog"]["streams"])
        protocol(pinned, args.network, config, "discover", discovered)
        if args.list_streams:
            if not streams:
                raise CollectionError("Discovery returned no streams.")
            return [{"stream": s["name"], "namespace": s.get("namespace"),
                     "fields": sorted(s.get("json_schema", {}).get("properties", {}))}
                    for s in streams if "full_refresh" in s.get("supported_sync_modes", [])]
        if not args.stream or not args.control or not args.output:
            raise CollectionError("Collection requires a stream, control UUID and output file.")
        control = str(UUID(args.control))
        parts = rule_path(args.field,args.pointer)
        selector = args.field if args.field is not None else args.pointer
        bounds = None
        if args.minimum is not None or args.maximum is not None:
            if args.expected is not None:
                raise CollectionError("Select equality or a numeric range.")
            bounds = numeric_bounds(args.minimum,args.maximum)
            policy = ["range",parts,str(bounds[0]),str(bounds[1])]
            description = "Inclusive numeric limits on "+selector
        else:
            expected = json.loads(args.expected) if args.expected is not None else None
            if type(expected) not in (str,bool,int,float) or (type(expected) is float and not math.isfinite(expected)):
                raise CollectionError("Supply an expected JSON string, finite number or boolean.")
            policy = [args.field,expected] if args.field else ["pointer",parts,expected]
            description = "Typed equality on "+selector
        chosen = [s for s in streams if s["name"] == args.stream and s.get("namespace") == args.namespace
                  and "full_refresh" in s.get("supported_sync_modes", [])]
        if len(chosen) != 1:
            raise CollectionError("The requested full-refresh stream and namespace could not be resolved.")
        selected = local_json(folder, "catalog.json", {"streams": [{"stream": chosen[0], "sync_mode": "full_refresh",
                              "destination_sync_mode": "append"}]})
        counts = {"matched": 0, "different": 0, "missing": 0}
        if bounds:
            counts["invalid"] = 0
        def checked(msg):
            if msg.get("type") != "RECORD":
                return
            row = msg["record"]
            if row["stream"] != args.stream or row.get("namespace") != args.namespace or not isinstance(row["data"], dict):
                raise CollectionError("A record differed from the selected stream.")
            actual = lookup(row["data"],parts)
            if actual is None:
                counts["missing"] += 1
            elif bounds:
                if type(actual) not in (int,Decimal) or not Decimal(actual).is_finite():
                    counts["invalid"] += 1
                else:
                    counts["matched" if bounds[0] <= actual <= bounds[1] else "different"] += 1
            elif type(actual) is type(expected) and actual == expected:
                counts["matched"] += 1
            else:
                counts["different"] += 1
        protocol(pinned, args.network, config, "read", checked, selected, decimal_records=bounds is not None)
    total = sum(counts.values())
    status = "FAIL" if counts["different"] else "UNKNOWN" if not total or counts["missing"] or counts.get("invalid") else "PASS"
    rule = json.dumps([args.namespace, args.stream, *policy], ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    fingerprint = hashlib.sha256(rule).hexdigest()
    key, now = str(uuid4()), datetime.now(timezone.utc)
    stamp = lambda dt: dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    envelope = {"idempotencyKey": key, "body": {"controlId": control, "externalId": "dbsync/" + str(UUID(plan["definitionId"])) + "/" + key,
                "observedAt": stamp(now), "validUntil": stamp(now + timedelta(days=1)),
                "summary": "Operator-run source collection evaluated a selected stream against its configured control.",
                "checks": [{"key": "source-runtime", "label": "Installed source image", "status": "PASS", "observed": pinned,
                            "detail": "Collection plan version " + plan["version"]},
                           {"key": "stream-population", "label": "Selected stream population", "status": "PASS" if total else "UNKNOWN",
                            "observed": str(total), "detail": "Records returned by a completed full refresh."},
                           {"key": "row-rule", "label": "Configured field comparison", "status": status, "observed": json.dumps(counts),
                            "detail": description + ". Rule and stream SHA-256 " + fingerprint + "."}]}}
    payload = json.dumps(envelope, allow_nan=False, indent=2).encode()
    # Publish a complete new envelope without overwriting a previous retry key.
    with tempfile.NamedTemporaryFile(dir=args.output.parent, delete=False) as stage:
        staged = Path(stage.name)
        try:
            stage.write(payload)
            stage.flush()
            os.fsync(stage.fileno())
            os.link(staged, args.output)
        finally:
            staged.unlink(missing_ok=True)
    return {"rows": total, "status": status, "counts": counts}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("plan", "config"):
        parser.add_argument("--" + flag, type=Path, required=True)
    parser.add_argument("--source", help="Definition UUID in a downloaded bulk manifest")
    parser.add_argument("--digest", required=True)
    parser.add_argument("--network", default="bridge")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--list-streams", action="store_true")
    mode.add_argument("--check-access", action="store_true")
    for flag in ("stream", "namespace", "field", "pointer", "expected", "minimum", "maximum", "control"):
        parser.add_argument("--" + flag)
    parser.add_argument("--output", type=Path)
    try:
        print(json.dumps(run(parser.parse_args()), allow_nan=False))
    except CollectionError as error:
        sys.exit(str(error))
    except (ValueError, OSError, TypeError, KeyError, subprocess.SubprocessError):
        sys.exit("Collection failed. Check the local inputs, output path and Docker service.")
