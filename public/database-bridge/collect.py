"""Collect an aggregate control observation from an operator-run Airbyte source."""
import argparse
import hashlib
import json
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


def resource_reference(value):
    # Only an explicitly selected, printable source identifier may leave the host.
    if type(value) is int and len(str(value)) <= 32:
        return str(value)
    if type(value) is str and 0 < len(value) <= 96 and value.strip() == value and value.isprintable():
        encoded = json.dumps(value, ensure_ascii=False)
        return encoded if len(encoded.encode("utf-16-le")) <= 280 else None
    return None


class ResourceFindings:
    limit = 16

    def __init__(self, pointer, instance, tracked, definition, control, rule, remediation_days=None):
        self.path = rule_path(None, pointer)
        if not instance or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", instance):
            raise CollectionError("Supply a stable source instance name with --instance.")
        self.tracked = [resource_reference(json.loads(value)) for value in tracked]
        if (None in self.tracked or len(self.tracked) > self.limit or
                len(set(self.tracked)) != len(self.tracked)):
            raise CollectionError("Select up to 16 distinct string or integer resource IDs.")
        if remediation_days is not None and (type(remediation_days) is not int or not 1 <= remediation_days <= 365):
            raise CollectionError("Set a remediation target between 1 and 365 whole days.")
        self.remediation_days = remediation_days
        scope_fields = [definition, control, instance, self.path, rule]
        if remediation_days is not None:
            scope_fields.append({"remediationDays": remediation_days})
        scope = json.dumps(scope_fields, ensure_ascii=False,
                           separators=(",", ":"), allow_nan=False).encode()
        self.scope = hashlib.sha256(scope).hexdigest()[:32]
        self.results = {}
        self.unidentified = 0
        self.duplicates = set()

    def observe(self, record, outcome):
        reference = resource_reference(lookup(record, self.path))
        if reference is None:
            self.unidentified += 1
        elif reference in self.results:
            self.duplicates.add(reference)
            self.results[reference] = "UNKNOWN"
        elif len(self.results) >= 20000:
            raise CollectionError("Resource findings support 20,000 identities per scan. Narrow the source view.")
        else:
            self.results[reference] = outcome

    def checks(self):
        rank = {"FAIL": 0, "UNKNOWN": 1, "PASS": 2}
        selected = dict.fromkeys(self.tracked)
        for reference in sorted(self.results, key=lambda ref: (rank[self.results[ref]], ref)):
            if len(selected) == self.limit:
                break
            selected[reference] = None
        shown = sum(ref in self.results for ref in selected)
        omitted = len(self.results) - shown
        summary = {"identified": len(self.results), "shown": shown, "omitted": omitted,
                   "unidentifiedRows": self.unidentified, "duplicateIds": len(self.duplicates)}
        if self.remediation_days is not None:
            summary["remediationDays"] = self.remediation_days
        checks = [{"key": "resource-coverage", "label": "Resource identification and display coverage",
                   "status": "UNKNOWN" if self.unidentified or self.duplicates or not self.results else "PASS",
                   "observed": json.dumps(summary),
                   "detail": "All rows contribute to the aggregate rule. Track a specific ID to keep it visible on later reads."}]
        for reference in selected:
            status = self.results.get(reference, "UNKNOWN")
            reason = ("Resource absent from this read." if reference not in self.results else
                      "Multiple records have this identifier." if reference in self.duplicates else
                      {"PASS": "Resource met the rule.", "FAIL": "Resource failed the rule.",
                       "UNKNOWN": "The control field was missing or invalid."}[status])
            key = hashlib.sha256((self.scope + "/" + reference).encode()).hexdigest()
            # Long or heavily escaped references still fit the observation API's label limit.
            checks.append({"key": "item-" + key, "label": ("Resource " + reference)[:155],
                           "status": status, "observed": reason, "detail": "Resource ID (JSON): " + reference})
        return checks


def apply_test_definition(args, plan):
    path = getattr(args, "test_definition", None)
    if not path:
        return
    if path.stat().st_size > 8192:
        raise CollectionError("The test definition exceeds 8 KiB.")
    test = json.loads(path.read_text())
    if not isinstance(test, dict) or test.get("format") != "regpilot-source-test-v1":
        raise CollectionError("Unsupported test definition.")
    if test.get("definitionId") != plan["definitionId"] or test.get("version") != plan["version"]:
        raise CollectionError("Select the source and version named in the test definition.")
    mapping = {"stream":"stream", "namespace":"namespace", "control":"control", "pointer":"pointer",
               "expected":"expected", "minimum":"minimum", "maximum":"maximum",
               "instance":"instance", "resourcePointer":"resource_pointer"}
    if set(test) - (set(mapping) | {"definitionId", "format", "version", "name", "remediationDays"}):
        raise CollectionError("Unknown test definition option.")
    name = test.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 100 or not name.isprintable():
        raise CollectionError("Enter a printable test name of up to 100 characters.")
    if getattr(args, "remediation_days", None) is not None or args.check_access or args.list_streams or args.field is not None or any(getattr(args, key, None) is not None for key in mapping.values()):
        raise CollectionError("Use a test definition or individual rule settings.")
    for field, attribute in mapping.items():
        value = test.get(field)
        if value is not None and (not isinstance(value, str) or len(value) > 600):
            raise CollectionError("Invalid value in test definition.")
        setattr(args, attribute, value)
    args.remediation_days = test.get("remediationDays")
    args.test_name = name.strip()


def run(args):
    args.failure_stage = 'PLAN'
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
    apply_test_definition(args, plan)
    args.failure_stage = 'IMAGE'
    native = plan.get("format") == "regpilot-native-sql-v1"
    if native:
        import native_sql
        try:
            pinned = native_sql.verify(plan, args.digest)
        except (ImportError, ValueError, KeyError) as error:
            raise CollectionError("Check the native collector digest and install the driver specified in the plan.") from error
    else:
        pinned = pin_image(plan, args.digest)
    args.failure_stage = 'CONFIG'
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}", args.network) or args.network in ("host", "none"):
        raise CollectionError("Select a bridge network with authorised source access.")
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp).resolve()
        if ":" in str(folder):
            raise CollectionError("Select a temporary directory without a colon in its path.")
        configuration = json.loads(args.config.read_text())
        config = None if native else local_json(folder, "config.json", configuration)
        def source(command, handler, catalog=None, fields=()):
            if not native:
                return protocol(pinned, args.network, config, command, handler, catalog, decimal_records=command == "read")
            try:
                return native_sql.run(plan["engine"], configuration, command, handler, catalog, fields)
            except Exception as error:
                raise CollectionError("Native SQL collection stopped at " + args.failure_stage + ". Check the account, source and selected columns.") from error
        if args.check_access or getattr(args, 'scheduled_diagnostics', False):
            args.failure_stage = 'ACCESS'
            statuses = []
            def connection(msg):
                if msg.get("type") == "CONNECTION_STATUS":
                    statuses.append(msg["connectionStatus"]["status"])
            source("check", connection)
            if statuses != ["SUCCEEDED"]:
                raise CollectionError("The source did not confirm access.")
            if args.check_access:
                return {"access": "confirmed"}
        args.failure_stage = 'DISCOVERY'
        streams = []
        def discovered(msg):
            if msg.get("type") == "CATALOG":
                streams.extend(msg["catalog"]["streams"])
        source("discover", discovered)
        if args.list_streams:
            if not streams:
                raise CollectionError("Discovery returned no streams.")
            return [{"stream": s["name"], "namespace": s.get("namespace"),
                     "fields": sorted(s.get("json_schema", {}).get("properties", {}))}
                    for s in streams if "full_refresh" in s.get("supported_sync_modes", [])]
        args.failure_stage = 'SELECTION'
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
            expected = json.loads(args.expected, parse_float=Decimal) if args.expected is not None else None
            if type(expected) not in (str, bool, int, Decimal) or isinstance(expected, Decimal) and not expected.is_finite():
                raise CollectionError("Supply an expected JSON string, finite number or boolean.")
            if isinstance(expected, Decimal):
                policy = ["number-equals", parts, str(expected)]
            else:
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
        policy_scope = [args.namespace, args.stream, *policy]
        pointer = getattr(args, "resource_pointer", None)
        instance = getattr(args, "instance", None)
        tracked = getattr(args, "track", None) or []
        remediation_days = getattr(args, "remediation_days", None)
        if not pointer and (instance or tracked or remediation_days is not None):
            raise CollectionError("Resource tracking and remediation targets require --resource-pointer.")
        findings = ResourceFindings(pointer, instance, tracked, plan["definitionId"], control, policy_scope, remediation_days) if pointer else None
        def checked(msg):
            if msg.get("type") != "RECORD":
                return
            row = msg["record"]
            if row["stream"] != args.stream or row.get("namespace") != args.namespace or not isinstance(row["data"], dict):
                raise CollectionError("A record differed from the selected stream.")
            actual = lookup(row["data"],parts)
            if actual is None:
                category = "missing"
            elif bounds:
                if type(actual) not in (int, Decimal) or not Decimal(actual).is_finite():
                    category = "invalid"
                else:
                    category = "matched" if bounds[0] <= actual <= bounds[1] else "different"
            elif type(expected) in (int, Decimal) and type(actual) in (int, Decimal):
                category = "matched" if actual == expected else "different"
            else:
                category = "matched" if type(actual) is type(expected) and actual == expected else "different"
            counts[category] += 1
            if findings:
                findings.observe(row["data"], {"matched": "PASS", "different": "FAIL"}.get(category, "UNKNOWN"))
        args.failure_stage = 'READ'
        source("read", checked, selected, list(dict.fromkeys([parts[0]] + ([findings.path[0]] if findings else []))))
    args.failure_stage = 'RECEIPT'
    total = sum(counts.values())
    status = "FAIL" if counts["different"] else "UNKNOWN" if not total or counts["missing"] or counts.get("invalid") else "PASS"
    rule = json.dumps([args.namespace, args.stream, *policy], ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    fingerprint = hashlib.sha256(rule).hexdigest()
    key, now = str(uuid4()), datetime.now(timezone.utc)
    stamp = lambda dt: dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    envelope = {"idempotencyKey": key, "body": {"controlId": control, "externalId": "dbsync/" + str(UUID(plan["definitionId"])) + "/" + key,
                "observedAt": stamp(now), "validUntil": stamp(now + timedelta(days=1)),
                "summary": "Operator-run source collection evaluated a selected stream against its configured control.",
                "checks": [{"key": "source-runtime", "label": "Verified native SQL collector" if native else "Installed source image", "status": "PASS", "observed": pinned,
                            "detail": "Collection plan version " + plan["version"]},
                           {"key": "stream-population", "label": "Selected stream population", "status": "PASS" if total else "UNKNOWN",
                            "observed": str(total), "detail": "Records returned by a completed full refresh."},
                           {"key": "row-rule", "label": "Configured field comparison", "status": status, "observed": json.dumps(counts),
                            "detail": description + ". Rule and stream SHA-256 " + fingerprint + "."}]}}
    if getattr(args, "test_name", None):
        envelope["body"]["summary"] = "Operator-run source monitoring test: " + args.test_name
    if findings:
        body = envelope["body"]
        body["externalId"] = "/".join(["dbsync", plan["definitionId"], findings.scope, key])
        body["checks"].extend(findings.checks())
        statuses = {check["status"] for check in body["checks"]}
        status = "FAIL" if "FAIL" in statuses else "UNKNOWN" if "UNKNOWN" in statuses else "PASS"
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
    parser.add_argument("--remediation-days", type=int, help="Target in days from first observed resource failure.")
    parser.add_argument("--test-definition", type=Path, help="Run a monitoring test downloaded from the source catalogue.")
    parser.add_argument("--resource-pointer", help="Opt in to reporting resource IDs from this JSON Pointer.")
    parser.add_argument("--instance", help="Stable name for this source account or installation.")
    parser.add_argument("--track", action="append", help="Keep this JSON string or integer ID visible on every scan.")
    parser.add_argument("--output", type=Path)
    parser.add_argument('--scheduled-diagnostics', action='store_true', help='Check source access before discovery and report a fixed failure stage.')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), allow_nan=False))
    except CollectionError as error:
        sys.exit(args.failure_stage if args.scheduled_diagnostics else str(error))
    except (ValueError, OSError, TypeError, KeyError, subprocess.SubprocessError):
        sys.exit(args.failure_stage if args.scheduled_diagnostics else "Collection failed. Check the local inputs, output path and Docker service.")
