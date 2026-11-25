"""Check committed infrastructure definitions and prepare scoped RegPilot observations."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import getpass
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import os
import http.client
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
from uuid import UUID, uuid4, uuid5

ENGINE = "3.4.11"
FRAMEWORKS = ("terraform", "cloudformation", "kubernetes", "arm", "bicep", "dockerfile",
              "github_actions", "gitlab_ci", "ansible", "openapi", "serverless")
POLICY_ID = re.compile(r"CKV2?_[A-Z0-9_]+_[0-9]+")
CATALOGUE = Path(__file__).with_name("catalogue.json")
MAX_FILES, MAX_SOURCE, MAX_REPORT = 1500, 64 * 1024**2, 128 * 1024**2
SKIP_DIRS = {".git", ".terraform", "node_modules", ".venv"}


def write_new(path, value):
    encoded = (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode()
    path = Path(path)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        tmp = Path(temporary.name)
        try:
            temporary.write(encoded)
            temporary.flush()
            os.fsync(temporary.fileno())
            os.link(tmp, path)  # Publish a complete file, preserving an existing scan and its retry keys.
        finally:
            tmp.unlink(missing_ok=True)


def run_engine(arguments, temporary, output):
    try:
        installed = version("checkov")
    except PackageNotFoundError:
        installed = None
    if installed != ENGINE:
        raise ValueError("Install Checkov " + ENGINE + " in the active Python environment.")
    executable = Path(sys.executable).with_name("checkov")
    configuration = temporary / "settings.yml"
    configuration.write_text("{}\n")
    env = {"PATH": os.environ.get("PATH", os.defpath), "HOME": str(temporary),
           "LC_ALL": "C.UTF-8", "LOG_LEVEL": "ERROR"}
    with output.open("wb") as stream:
        result = subprocess.run([str(executable), "--config-file", str(configuration), "--skip-download",
                                 *arguments], cwd=temporary, env=env, stdin=subprocess.DEVNULL,
                                stdout=stream, stderr=subprocess.DEVNULL, timeout=300)
    # A completed Checkov scan exits with 1 when a policy fails. Validate the full report below.
    if result.returncode not in (0, 1) or output.stat().st_size > MAX_REPORT:
        raise ValueError("The policy engine did not produce a bounded report.")
    return result.returncode


def policy_catalogue():
    policies = {framework: set() for framework in FRAMEWORKS}
    with tempfile.TemporaryDirectory() as name:
        root = Path(name)
        output = root / "policies.txt"
        if run_engine(["--list", "--framework", *FRAMEWORKS], root, output):
            raise ValueError("The installed engine could not enumerate its policies.")
        for line in output.read_text().splitlines():
            parts = line.split("|")
            if len(parts) < 8:
                continue
            policy, framework = parts[2].strip(), parts[6].strip().lower()
            if framework in policies and POLICY_ID.fullmatch(policy):
                policies[framework].add(policy)
    if not all(policies.values()):
        raise ValueError("One or more selected frameworks returned no policy IDs.")
    return {"engine": "Checkov", "engineVersion": ENGINE,
            "uniquePolicies": len(set.union(*policies.values())),
            "frameworks": {k: sorted(v) for k, v in policies.items()}}


def belongs(path, frameworks):
    suffix, name = path.suffix.lower(), path.name.lower()
    yaml = suffix in (".yml", ".yaml")
    return (("terraform" in frameworks and (suffix in (".tf", ".tfvars") or name.endswith((".tf.json", ".tfvars.json"))))
            or ("bicep" in frameworks and suffix == ".bicep")
            or ("arm" in frameworks and suffix in (".json", ".jsonc"))
            or ("dockerfile" in frameworks and (name == "dockerfile" or name.startswith("dockerfile.") or name.endswith(".dockerfile")))
            or (frameworks & {"cloudformation", "openapi", "kubernetes", "serverless"} and (yaml or suffix in (".json", ".template")))
            or ("ansible" in frameworks and yaml)
            or ("github_actions" in frameworks and path.parts[:2] == (".github", "workflows") and yaml)
            or ("gitlab_ci" in frameworks and yaml))


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], timeout=45, stderr=subprocess.DEVNULL)


def snapshot(repo, frameworks, destination):
    revision = git(repo, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", revision):
        raise ValueError("The source must be a local Git repository with a committed revision.")
    listing = git(repo, "ls-tree", "-rlz", revision)
    if len(listing) > 32 * 1024**2:
        raise ValueError("The selected repository exceeds the file inventory limit.")
    count = total = excluded = 0
    for entry in listing.split(b"\0"):
        if not entry:
            continue
        meta, raw_path = entry.split(b"\t", 1)
        mode, kind, blob, size = meta.decode().split()
        path = PurePosixPath(os.fsdecode(raw_path))
        if path.is_absolute() or ".." in path.parts or set(path.parts) & SKIP_DIRS:
            continue
        if kind == "commit":
            excluded += 1
            continue
        if path.name.startswith(".checkov") or not belongs(path, frameworks):
            continue
        if mode not in ("100644", "100755") or kind != "blob":
            excluded += 1
            continue
        length = int(size)
        count += 1
        total += length
        if count > MAX_FILES or length > 4 * 1024**2 or total > MAX_SOURCE:
            raise ValueError("The selected committed definitions exceed the scan limits.")
        target = destination.joinpath(*path.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        data = git(repo, "cat-file", "blob", blob)
        if len(data) != length:
            raise ValueError("A committed source file could not be read completely.")
        target.write_bytes(data)
    if not count:
        raise ValueError("The revision has no supported definitions for the selected frameworks.")
    return revision, count, excluded


def aggregate(reports, selected, catalogue):
    rules, resources, errors = {}, 0, 0
    observed_frameworks, executed_frameworks = set(), set()
    registry = {framework: set(catalogue["frameworks"][framework]) for framework in selected}
    for report in reports if isinstance(reports, list) else [reports]:
        framework = report["check_type"]
        if framework not in selected or framework in observed_frameworks:
            raise ValueError("Unexpected or duplicate framework in engine output.")
        observed_frameworks.add(framework)
        summary, results = report["summary"], report["results"]
        if summary["checkov_version"] != ENGINE:
            raise ValueError("Policy engine version differs from the approved registry.")
        for field in ("passed", "failed", "skipped", "resource_count", "parsing_errors"):
            if type(summary[field]) is not int or summary[field] < 0:
                raise ValueError("Invalid policy count in source report.")
        decision_subjects = set()
        if not isinstance(results["parsing_errors"], list) or len(results["parsing_errors"]) != summary["parsing_errors"]:
            raise ValueError("Engine parse failures disagree with the reported total.")
        errors += summary["parsing_errors"]
        for group, expected in (("passed", "PASSED"), ("failed", "FAILED"), ("skipped", "SKIPPED")):
            rows = results[group + "_checks"]
            if not isinstance(rows, list) or len(rows) != summary[group]:
                raise ValueError("Reported policy totals disagree with the detailed decisions.")
            for row in rows:
                policy = row["check_id"]
                if (policy not in registry[framework] or
                        row["check_result"]["result"] != expected):
                    raise ValueError("Unexpected policy or inconsistent decision in engine output.")
                rules.setdefault(policy, Counter())[group] += 1
                if group != "skipped":
                    executed_frameworks.add(framework)
                if not summary["resource_count"]:
                    path, resource = row.get("file_path"), row.get("resource")
                    if isinstance(path, str) and path and isinstance(resource, str) and resource:
                        decision_subjects.add((path, resource))
        # Some runners omit their resource count even when they identify every checked subject.
        resources += summary["resource_count"] or len(decision_subjects)
    return rules, resources, errors, sorted(observed_frameworks), sorted(selected - executed_frameworks)


def status(counts, incomplete=False):
    if counts["failed"]:
        return "FAIL"
    if incomplete or counts["skipped"] or not counts["passed"]:
        return "UNKNOWN"
    return "PASS"


def assessment(source, revision, selected, files, excluded, reports, catalogue):
    rules, resources, errors, reported, unassessed = aggregate(reports, selected, catalogue)
    scope = hashlib.sha256(json.dumps([source, sorted(selected)], separators=(",", ":")).encode()).hexdigest()[:24]
    totals = sum(rules.values(), Counter())
    incomplete = bool(errors or excluded or not resources or unassessed)
    available = len(set.union(*(set(catalogue["frameworks"][item]) for item in selected)))
    summary = {"frameworks": sorted(selected), "reportedFrameworks": reported, "revision": revision, "scope": scope,
               "unassessedFrameworks": unassessed, "availablePolicies": available, "executedPolicies": sum(bool(c["passed"] or c["failed"]) for c in rules.values()),
               "policiesWithResults": len(rules), "files": files, "resourceCount": resources, "parseErrors": errors,
               "excludedLinks": excluded, "decisions": {k: totals[k] for k in ("passed", "failed", "skipped")}}
    return summary, rules, incomplete


def make_bundle(control, source, revision, selected, files, excluded, reports, catalogue, at=None):
    summary, rules, incomplete = assessment(source, revision, selected, files, excluded, reports, catalogue)
    scope, available = summary["scope"], summary["availablePolicies"]
    resources, errors = summary["resourceCount"], summary["parseErrors"]
    totals = Counter(summary["decisions"])
    at = at or datetime.now(timezone.utc)
    stamp = lambda value: value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    scan_id = uuid4()
    observations = []
    policy_rows = sorted(rules.items())
    shards = max(1, (len(policy_rows) + 18) // 19)
    for i in range(shards):
        key = str(uuid5(scan_id, str(i)))
        counts = summary["decisions"]
        overview = {"key": "scan-summary", "label": "Infrastructure policy scan", "status": status(totals, incomplete),
                    "observed": f"{summary['executedPolicies']} policies executed from {available} available. "
                                f"{counts['passed']} passed, {counts['failed']} failed, {counts['skipped']} skipped resource decisions.",
                    "detail": f"Checkov {ENGINE}. Git {revision}. {resources} resources, {errors} parse errors, "
                              f"{excluded} excluded links. Part {i+1} of {shards}. Scan {scan_id}."}
        checks = [overview]
        for policy, result in policy_rows[i*19:(i+1)*19]:
            checks.append({"key": policy.lower(), "label": policy, "status": status(result, incomplete),
                           "observed": f"{result['passed']} passed, {result['failed']} failed, {result['skipped']} skipped resources."})
        observations.append({"idempotencyKey": key, "body": {"controlId": str(UUID(control)),
                             "externalId": f"iac/{scope}/{key}", "observedAt": stamp(at),
                             "validUntil": stamp(at + timedelta(hours=1)), "summary": "Infrastructure policy results for committed definitions.",
                             "checks": checks}})
    return {"format": "regpilot-infrastructure-policy-v1", "engineVersion": ENGINE,
            "scanId": str(scan_id), "summary": summary, "observations": observations}


def scan(args):
    selected = set(args.framework)
    catalogue = json.loads(CATALOGUE.read_text())
    if catalogue["engineVersion"] != ENGINE or not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", args.source):
        raise ValueError("Use the pinned registry and a stable source identifier.")
    with tempfile.TemporaryDirectory() as name:
        root = Path(name)
        directory = root / "source"
        directory.mkdir()
        revision, files, excluded = snapshot(args.repo, selected, directory)
        output = root / "report.json"
        code = run_engine(["--directory", str(directory), "--framework", *sorted(selected),
                           "--download-external-modules", "false", "--output", "json"], root, output)
        inputs = (args.source, revision, selected, files, excluded, json.loads(output.read_bytes()), catalogue)
        if args.mode == "inspect":
            summary, rules, incomplete = assessment(*inputs)
            report = {"format": "regpilot-infrastructure-inspection-v1", "engineVersion": ENGINE,
                      "summary": summary, "status": status(Counter(summary["decisions"]), incomplete),
                      "policies": {policy: dict(counts) for policy, counts in sorted(rules.items())}}
        else:
            report = make_bundle(str(UUID(args.control)), *inputs)
            summary = report["summary"]
        if code and not (summary["decisions"]["failed"] or summary["parseErrors"]):
            raise ValueError("The engine exited unsuccessfully without reporting its cause.")
        write_new(args.output, report)
        print(json.dumps(summary, sort_keys=True))


def send_saved(report, workspace, send, credential):
    if report.stat().st_size > 12 * 1024**2:
        raise ValueError("The saved receipt bundle exceeds the intake limit.")
    bundle = json.loads(report.read_bytes())
    scan_id = UUID(bundle["scanId"])
    scope = bundle["summary"]["scope"]
    if (bundle.get("format") != "regpilot-infrastructure-policy-v1" or not re.fullmatch("[a-f0-9]{24}", scope)
            or not 1 <= len(bundle["observations"]) <= 500):
        raise ValueError("This file is not a saved infrastructure scan.")
    origin = workspace.rstrip("/")
    destination = hashlib.sha256(origin.encode()).hexdigest()[:24]
    receipts = report.parent / (".iac-receipts-" + str(scan_id)) / destination
    receipts.mkdir(parents=True, exist_ok=True, mode=0o700)
    for i, envelope in enumerate(bundle["observations"]):
        key = str(uuid5(scan_id, str(i)))
        if envelope["idempotencyKey"] != key or envelope["body"]["externalId"] != f"iac/{scope}/{key}":
            raise ValueError("An observation differs from its saved scan identity.")
        digest = hashlib.sha256(json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        receipt = receipts / (key + ".json")
        if not receipt.exists():
            ack = send(origin, envelope, credential)
            saved = {"envelopeHash": digest, "id": str(UUID(ack["id"])), "key": ack["idempotencyKey"]}
            try:
                write_new(receipt, saved)
            except FileExistsError:
                pass  # Concurrent senders share a server idempotency key and the same acknowledgement.
        persisted = json.loads(receipt.read_bytes())
        if persisted["envelopeHash"] != digest or persisted["key"] != key or str(UUID(persisted["id"])) != persisted["id"]:
            raise ValueError("A saved acknowledgement differs from its original observation.")
    return len(bundle["observations"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    registry = modes.add_parser("catalogue", help="Enumerate installed policies without running a scan")
    registry.add_argument("--output", required=True, type=Path)
    for name, help_text in (("inspect", "Save local policy evidence for a committed repository"),
                            ("scan", "Save control-scoped observations for workspace delivery")):
        check = modes.add_parser(name, help=help_text)
        for field in ("source", "repo", "output"):
            check.add_argument("--" + field, required=True)
        if name == "scan":
            check.add_argument("--control", required=True)
        check.add_argument("--framework", nargs="+", required=True, choices=FRAMEWORKS)
    delivery = modes.add_parser("deliver", help="Send or resume a saved scan with a scoped workspace credential")
    delivery.add_argument("--report", required=True, type=Path)
    delivery.add_argument("--workspace", required=True)
    options = parser.parse_args()
    if options.mode == "catalogue":
        write_new(options.output, policy_catalogue())
    elif options.mode == "deliver":
        from deliver import deliver
        token = os.environ.get("REGPILOT_OBSERVATION_TOKEN") or getpass.getpass("Workspace observation credential: ")
        count = send_saved(options.report, options.workspace, deliver, token)
        print(f"{count} scoped observations acknowledged.")
    else:
        scan(options)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, KeyError, OSError, RuntimeError, http.client.HTTPException, subprocess.SubprocessError) as exc:
        sys.exit("Infrastructure policy collection failed: " + str(exc))
