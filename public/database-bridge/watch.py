"""Run one due database check and keep source and availability observations on disk."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from uuid import UUID, uuid5, NAMESPACE_URL


def timestamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def write_json(path, value):
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", delete=False) as stage:
        json.dump(value, stage)
        stage.flush()
        os.fsync(stage.fileno())
    os.replace(stage.name, path)


recovery_steps = {
    "PLAN": "Download the test and its matching source plan again. Check the definition and version.",
    "IMAGE": "Verify the installed source image and its approved digest.",
    "CONFIG": "Check the local configuration file and the authorised source network.",
    "ACCESS": "Check connectivity and the read account. Renew its credential if required and run the access check.",
    "DISCOVERY": "Confirm the reader can discover the required schema and streams.",
    "SELECTION": "Check the stream, namespace and field mapping against current discovery.",
    "READ": "Check read permission and connector limits on the selected stream, then collect again.",
    "RECEIPT": "Verify local space and write permission for the observation spool.",
    "COLLECTOR": "Check that the collection runner is installed alongside the scheduler."
}


def tick(args):
    definition = json.loads(args.test_definition.read_text())
    control = str(UUID(definition["control"]))
    scope = hashlib.sha256(json.dumps([definition, args.digest, args.interval_seconds, args.source], sort_keys=True).encode()).hexdigest()
    args.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (args.directory / ".lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"state": "RUNNING"}
        state_file = args.directory / "schedule.json"
        now = time.time()
        if not state_file.exists():
            write_json(state_file, {"scope": scope, "start": now, "last": -1})
        state = json.loads(state_file.read_text())
        if scope != state["scope"]:
            raise ValueError("Use a new directory for a different rule, source version or interval.")
        period = args.interval_seconds
        slot = state.get("pending", int((now - state["start"]) // period))
        if slot <= state["last"]:
            return {"state": "NOT_DUE", "nextAt": timestamp(state["start"] + (state["last"]+1)*period)}
        if "pending" not in state:
            state["pending"] = slot
            write_json(state_file,state)
        missed = slot - state["last"] - 1
        prefix = str(slot).zfill(12)
        source_file = args.directory / (prefix+"-source.json")
        availability = args.directory / (prefix+"-availability.json")
        summary_file = args.directory / (prefix+"-status.json")
        if not summary_file.exists():
            failure_stage = None
            if not source_file.exists() and not availability.exists():
                runner = [sys.executable, str(Path(__file__).with_name("collect.py")), "--plan", str(args.plan),
                          "--config", str(args.config), "--digest", args.digest, "--network", args.network,
                          "--test-definition", str(args.test_definition), "--output", str(source_file), "--scheduled-diagnostics"]
                if args.source:
                    runner.extend(["--source",args.source])
                result = subprocess.run(runner, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
                if result.returncode:
                    stage = result.stderr.strip()
                    failure_stage = stage if stage in recovery_steps else 'COLLECTOR'
                if result.returncode and source_file.exists():
                    raise RuntimeError("Inconsistent collector outcome; inspect the source receipt.")
            success = source_file.exists()
            captured = time.time()
            if not availability.exists():
                key = str(uuid5(NAMESPACE_URL, f"regpilot-cadence/{control}/{scope}/{state['start']}/{slot}"))
                body = {"controlId":control, "externalId":"cadence/"+scope[:24]+"/"+key,
                        "observedAt":timestamp(captured), "validUntil":timestamp(captured+max(period,3600)),
                        "summary":"Scheduled source availability for "+definition.get("name","database check")[:100],
                        "checks":[{"key":"scheduled-read","label":"Source reading received","status":"PASS" if success else "FAIL",
                                   "observed":"Source receipt present" if success else "No source receipt",
                                   "detail":"Historical attempt at "+timestamp(captured)+". No new source observation is issued on failure."},
                                  {"key":"missed-intervals","label":"Scheduled intervals missed","status":"FAIL" if missed else "PASS",
                                   "observed":str(missed),"detail":"Elapsed intervals without a runner invocation since the last completed slot."}]}
                if failure_stage:
                    body["checks"][0].update(observed=failure_stage, detail=recovery_steps[failure_stage])
                elif success and state["last"] >= 0:
                    previous_file = args.directory / (str(state["last"]).zfill(12)+"-status.json")
                    previous = json.loads(previous_file.read_text())
                    if previous.get("state") == "FAILED":
                        body["checks"][0]["detail"] = "Collection restored after failed slot " + str(state["last"]) + " (" + (previous.get("failureStage") or "stage unavailable") + ")."
                write_json(availability, {"idempotencyKey":key,"body":body})
            recorded = json.loads(availability.read_text())["body"]
            observed = recorded["observedAt"]
            summary = {"slot":slot,"dueAt":timestamp(state["start"]+slot*period),"observedAt":observed,
                       "state":"READ" if success else "FAILED","missedIntervals":missed,
                       "source":source_file.name if success else None,"availability":availability.name}
            health = recorded["checks"][0]
            if not success and health["observed"] in recovery_steps:
                summary.update(failureStage=health["observed"], recoveryGuidance=health["detail"])
            if success and health["detail"].startswith("Collection restored after failed slot "):
                summary["recoveredAfterSlot"] = state["last"]
            write_json(summary_file,summary)
        else:
            summary = json.loads(summary_file.read_text())
        state.pop("pending",None)
        write_json(state_file,{**state,"last":slot})
        return summary


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for flag in ("plan","config","test-definition","directory"):
        parser.add_argument("--"+flag, type=Path, required=True)
    parser.add_argument("--digest",required=True)
    parser.add_argument("--network",required=True)
    parser.add_argument("--source")
    parser.add_argument("--interval-seconds",type=int,required=True)
    args=parser.parse_args()
    if not 10 <= args.interval_seconds <= 604800:
        parser.error("Choose an interval from 10 seconds to seven days.")
    try:
        outcome=tick(args)
        print(json.dumps(outcome))
        sys.exit(1 if outcome["state"]=="FAILED" else 0)
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        sys.exit("Unable to run this schedule: "+str(error))
