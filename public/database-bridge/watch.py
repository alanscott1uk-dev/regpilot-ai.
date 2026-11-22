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
            if not source_file.exists() and not availability.exists():
                runner = [sys.executable, str(Path(__file__).with_name("collect.py")), "--plan", str(args.plan),
                          "--config", str(args.config), "--digest", args.digest, "--network", args.network,
                          "--test-definition", str(args.test_definition), "--output", str(source_file)]
                if args.source:
                    runner.extend(["--source",args.source])
                result = subprocess.run(runner, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
                write_json(availability, {"idempotencyKey":key,"body":body})
            observed = json.loads(availability.read_text())["body"]["observedAt"]
            summary = {"slot":slot,"dueAt":timestamp(state["start"]+slot*period),"observedAt":observed,
                       "state":"READ" if success else "FAILED","missedIntervals":missed,
                       "source":source_file.name if success else None,"availability":availability.name}
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
