"""Publish retained case identifiers and observed outcomes from successful upstream checks."""
from collections import Counter
import json
import sys
from pathlib import Path

root=Path(__file__).resolve().parents[1]
catalogue=json.loads((root/"public/cloud-controls/catalogue.json").read_bytes())
rows,seen,decisions={},set(),Counter()
for arg in sys.argv[2:]:
    report=json.loads(Path(arg).read_bytes())
    if report["failedBatches"] or report["version"]!=catalogue["version"] or report["upstreamRevision"]!=catalogue["upstreamRevision"]:
        raise ValueError("All submitted execution shards must match the pinned engine and pass.")
    for row in report["checks"]:
        provider,identifier=row["provider"],row["id"]
        if identifier not in catalogue["providers"][provider] or (provider,identifier) in seen:
            raise ValueError("A submitted result is unregistered or repeated.")
        seen.add((provider,identifier))
        states=row["decisions"]
        if not states or not set(states)<={"PASS","FAIL","MANUAL"} or any(type(n) is not int or n<1 for n in states.values()):
            raise ValueError("Check did not return a resource decision.")
        case=row["case"]
        prefix="tests/providers/"+provider+"/services/"
        if not case.startswith(prefix) or ("/"+identifier+"/"+identifier+"_test.py::") not in case:
            raise ValueError("Upstream test does not identify the expected policy.")
        rows.setdefault(provider,[]).append([identifier,case[len(prefix):].split("/",1)[0],case.split("::",1)[1],states])
        decisions.update(states)
n=len({identifier for _,identifier in seen})
if n<=1400:
    raise ValueError("The submitted shards did not exercise more than 1,400 distinct checks.")
out={"engine":"Prowler","version":catalogue["version"],"upstreamRevision":catalogue["upstreamRevision"],
     "environment":"Upstream inventory fixtures with isolated provider transports","available":catalogue["uniquePolicies"],
     "distinctExecuted":n,"resourceDecisions":dict(decisions),"columns":["policy","service","test","resourceDecisions"],
     "cases":{p:sorted(v) for p,v in sorted(rows.items())}}
Path(sys.argv[1]).write_text(json.dumps(out,sort_keys=True,separators=(",",":"))+"\n")
print(n,"distinct policies returned resource decisions")
