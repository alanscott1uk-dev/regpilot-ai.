"""Short wall-clock acceptance run against the disposable PostgreSQL source."""
import json
from pathlib import Path
import secrets
import subprocess
import sys
import time
from uuid import uuid4


def check_cadence(folder, plan, config, digest, network, query, config_for):
    query("""CREATE TABLE stock_count(expected int, counted int);
             CREATE TABLE staff_access(leaver boolean, enabled boolean);
             CREATE TABLE sop_use(approved int, in_use int);
             INSERT INTO stock_count VALUES(10,10); INSERT INTO staff_access VALUES(true,false); INSERT INTO sop_use VALUES(3,3);
             CREATE VIEW pilot_checks AS
               SELECT 'stock' AS resource, expected=counted AS good FROM stock_count
               UNION ALL SELECT 'identity', NOT (leaver AND enabled) FROM staff_access
               UNION ALL SELECT 'document', approved=in_use FROM sop_use;
             GRANT SELECT ON pilot_checks TO source_reader;""")
    test_file = folder / "cadence-test.json"
    definition = json.loads(plan.read_text())
    control = str(uuid4())
    test_file.write_text(json.dumps({"format":"regpilot-source-test-v1","name":"Internal stock, identity and document checks",
        "definitionId":definition["definitionId"],"version":definition["version"],"stream":"pilot_checks","namespace":"public",
        "pointer":"/good","expected":"true","resourcePointer":"/resource","instance":"internal-pharma-source","control":control,"remediationDays":7}))
    spool = folder / "cadence"
    interval = 45
    cli = [sys.executable,"public/database-bridge/watch.py","--plan",str(plan),"--config",str(config),
           "--digest",digest,"--network",network,"--test-definition",str(test_file),"--directory",str(spool),"--interval-seconds",str(interval)]
    events=[]
    def run(slot, expected):
        if slot:
            start=json.loads((spool/"schedule.json").read_text())["start"]
            time.sleep(max(0,start+slot*interval+0.2-time.time()))
        r=subprocess.run(cli,capture_output=True,text=True)
        assert r.returncode==(1 if expected=="FAILED" else 0), (r.returncode,r.stderr[:300])
        summary=json.loads(r.stdout)
        assert summary["state"]==expected and summary["slot"]==slot,summary
        availability=json.loads((spool/summary["availability"]).read_text())
        source=json.loads((spool/summary["source"]).read_text()) if summary["source"] else None
        events.append({"summary":summary,"availability":availability,"source":source})
        return summary
    run(0,"READ")
    assert json.loads(subprocess.check_output(cli,text=True))["state"]=="NOT_DUE"
    query("UPDATE stock_count SET counted=9; UPDATE staff_access SET enabled=true; UPDATE sop_use SET in_use=2;")
    run(1,"READ")
    renewal=secrets.token_hex(20)
    query("ALTER USER source_reader PASSWORD '"+renewal+"';")
    # No invocation in slot 2. The next invocation must report it AND detect the rejected source access.
    failed=run(3,"FAILED")
    assert failed["missedIntervals"]==1 and failed["source"] is None
    assert failed["failureStage"]=="ACCESS" and "credential" in failed["recoveryGuidance"]
    config.write_text(json.dumps(config_for(renewal)))
    query("UPDATE stock_count SET counted=10; UPDATE staff_access SET enabled=false; UPDATE sop_use SET in_use=3;")
    recovered=run(4,"READ")
    assert recovered["recoveredAfterSlot"]==3
    for i,outcome in ((0,"PASS"),(1,"FAIL"),(3,"PASS")):
        row=next(c for c in events[i]["source"]["body"]["checks"] if c["key"]=="row-rule")
        assert row["status"]==outcome
        assert json.loads(row["observed"])["different"]==(3 if i==1 else 0)
    assert [c["status"] for c in events[2]["availability"]["body"]["checks"]]==["FAIL","FAIL"]
    Path("pilot-cadence-envelopes.json").write_text(json.dumps(events))
    report={"scope":"Fictional stock, identity and procedure tables in one disposable PostgreSQL database.",
            "intervalSeconds":interval,"checks":["stock","identity","document"],"attempts":[e["summary"] for e in events]}
    Path("pilot-cadence-report.json").write_text(json.dumps(report,indent=2))
    print(json.dumps(report),flush=True)
