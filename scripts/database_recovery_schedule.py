"""Exercise the installed scheduler on three wall-clock intervals and keep its receipts."""
import json
import subprocess
import sys
import time
from pathlib import Path


class RecoverySchedule:
    def __init__(self, folder, plan, config, digest, network, test):
        self.spool = folder / "scheduled-recovery"
        self.interval = 60
        self.events = []
        self.command = [sys.executable, "public/database-bridge/watch.py", "--plan", str(plan),
                        "--config", str(config), "--digest", digest, "--network", network,
                        "--test-definition", str(test), "--directory", str(self.spool),
                        "--interval-seconds", str(self.interval)]

    def collect(self, expected):
        if self.events:
            state = json.loads((self.spool / "schedule.json").read_text())
            time.sleep(max(0, state["start"] + (state["last"] + 1) * self.interval + 0.2 - time.time()))
        result = subprocess.run(self.command, capture_output=True, text=True, timeout=330)
        assert result.returncode == (1 if expected == "FAILED" else 0), "Unexpected schedule result"
        summary = json.loads(result.stdout)
        assert summary["state"] == expected
        if self.events:
            assert summary["slot"] > self.events[-1]["summary"]["slot"]
        availability = json.loads((self.spool / summary["availability"]).read_text())
        source = json.loads((self.spool / summary["source"]).read_text()) if summary["source"] else None
        health = availability["body"]["checks"][0]
        if expected == "FAILED":
            assert source is None and health["status"] == "FAIL"
            assert summary["failureStage"] in ("ACCESS", "DISCOVERY", "READ") and summary["recoveryGuidance"]
        else:
            assert health["status"] == "PASS" and source
            row = next(check for check in source["body"]["checks"] if check["key"] == "row-rule")
            assert row["status"] == ("PASS" if self.events else "FAIL")
            if self.events:
                assert summary["recoveredAfterSlot"] == self.events[-1]["summary"]["slot"]
        self.events.append({"summary":summary, "availability":availability, "source":source})

    def report(self, image, version, digest):
        assert [event["summary"]["state"] for event in self.events] == ["READ", "FAILED", "READ"]
        result = {"format":"regpilot-database-scheduled-recovery-v1","source":image,"version":version,
                  "digest":digest,"scope":"Disposable CI database","intervalSeconds":self.interval,
                  "attempts":self.events}
        Path("database-scheduled-recovery.json").write_text(json.dumps(result, indent=2))
