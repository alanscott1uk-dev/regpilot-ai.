"""Read the security configuration of one authorised account and emit hourly control receipts."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
from importlib.metadata import version
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from uuid import UUID, uuid4, uuid5


def shared(name, target):
    spec = importlib.util.spec_from_file_location(name, target)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parent
RECEIPTS = shared("policy_receipts", ROOT.parent / "infrastructure-policy" / "collect.py")
CATALOGUE = json.loads((ROOT / "catalogue.json").read_bytes())
ENGINE = CATALOGUE["version"]


def utc(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def aggregate(rows, provider, account, selected, earliest, latest):
    if not isinstance(rows, list) or not 0 < len(rows) <= 500000:
        raise ValueError("No bounded account findings were returned.")
    results = {check: Counter() for check in selected}
    seen, scan_ids = set(), set()
    for finding in rows:
        meta, origin = finding["metadata"], finding["unmapped"]
        policy, product = meta["event_code"], meta["product"]
        if product["uid"] != "prowler" or product["version"] != ENGINE or policy not in results:
            raise ValueError("A finding differs from the pinned engine or selected policy scope.")
        cloud_account = finding.get("cloud", {}).get("account", {}).get("uid") if provider != "kubernetes" else origin.get("provider_uid")
        if origin.get("provider") != provider or str(cloud_account) != account:
            raise ValueError("A finding belongs to a different provider or customer account.")
        scan_ids.add(str(UUID(origin["scan_id"])))
        when = finding["time"]
        if type(when) not in (float, int) or not earliest.timestamp()-1 <= when <= latest.timestamp()+1:
            raise ValueError("A finding falls outside this collection window.")
        uid = finding["finding_info"]["uid"]
        status = finding.get("status_code")
        if not isinstance(uid, str) or not uid or (policy, uid) in seen or status not in ("PASS", "FAIL", "MANUAL"):
            raise ValueError("An unexpected or duplicated resource decision was returned.")
        seen.add((policy, uid))
        state = finding["status"]
        if state not in ("New", "Suppressed"):
            raise ValueError("Unrecognised OCSF finding state.")
        results[policy]["UNKNOWN" if state == "Suppressed" or status == "MANUAL" else status] += 1
    if len(scan_ids) != 1:
        raise ValueError("The result combines multiple scans.")
    return results, scan_ids.pop()


def bundle(provider, account, source, control, selected, rows, started, ended):
    counts, upstream = aggregate(rows, provider, account, selected, started, ended)
    scope = hashlib.sha256(json.dumps([provider, account, source, control, sorted(selected)],separators=(",", ":")).encode()).hexdigest()[:24]
    scan_id = uuid4()
    executed = sum(bool(c["PASS"] + c["FAIL"]) for c in counts.values())
    total = sum(counts.values(), Counter())
    summary = {"provider":provider,"scope":scope,"sourceScanId":upstream,"selectedPolicies":len(counts),
               "policiesWithDecisions":executed,"resourceDecisions":dict(total),"startedAt":utc(started),"finishedAt":utc(ended)}
    items = sorted(counts.items())
    observations = []
    for index in range(0,len(items),19):
        key = str(uuid5(scan_id,str(index//19)))
        overall = "FAIL" if total["FAIL"] else "UNKNOWN" if executed != len(counts) or total["UNKNOWN"] else "PASS"
        checks = [{"key":"scan-summary","label":"Cloud control scan","status":overall,
                   "observed":f"{executed} of {len(counts)} selected policies returned a pass or fail decision.",
                   "detail":f"Prowler {ENGINE}. Source scan {upstream}. Part {index//19+1} of {(len(items)+18)//19}."}]
        for name, c in items[index:index+19]:
            outcome = "FAIL" if c["FAIL"] else "UNKNOWN" if not c["PASS"] or c["UNKNOWN"] else "PASS"
            check_key = name if len(name)<=80 else "policy-"+hashlib.sha256(name.encode()).hexdigest()[:32]
            checks.append({"key":check_key,"label":name,"status":outcome,
                           "observed":f"{c['PASS']} passed, {c['FAIL']} failed, {c['UNKNOWN']} manual or suppressed resource findings." if c else "No applicable resource decision returned."})
        observations.append({"idempotencyKey":key,"body":{"controlId":control,"externalId":f"cloud/{scope}/{key}",
                             "observedAt":utc(ended),"validUntil":utc(started+timedelta(hours=1)),
                             "summary":"Hourly cloud controls for the authorised customer account.","checks":checks}})
    return {"format":"regpilot-cloud-control-v1","scanId":str(scan_id),"engineVersion":ENGINE,"summary":summary,"observations":observations}


def run(a):
    if version("prowler")!=ENGINE:
        raise ValueError("Install the pinned Prowler release.")
    known = set(CATALOGUE["providers"][a.provider])
    selected = set(a.check or known)
    if not selected or not selected <= known or not re.fullmatch(r"[A-Za-z0-9._-]{1,100}",a.source) or not (0<len(a.account)<=256):
        raise ValueError("Choose a listed provider policy, account and stable site source.")
    if a.output.exists():
        raise ValueError("Use a new scan file, or deliver the saved scan again.")
    control = str(UUID(a.control))
    extra = []
    if a.region:
        if a.provider!="aws" or not re.fullmatch("[a-z0-9-]{3,30}",a.region):
            raise ValueError("Select a valid AWS region.")
        extra += ["--region", a.region]
    if a.auth:
        modes = {"azure":{"az-cli-auth","sp-env-auth","managed-identity-auth"},"m365":{"az-cli-auth","sp-env-auth","env-auth"}}
        if a.auth not in modes.get(a.provider,set()):
            raise ValueError("Select a supported account authentication mode.")
        extra.append("--"+a.auth)
    env = dict(os.environ)
    for key in list(env):
        if key.startswith("REGPILOT_"):
            del env[key]
    with tempfile.TemporaryDirectory() as temp:
        started = datetime.now(timezone.utc)
        args = [str(Path(sys.executable).with_name("prowler")),a.provider,"--check",*sorted(selected),*extra,
                "--no-banner","--no-color","--ignore-exit-code-3","--output-formats","json-ocsf",
                "--output-directory",temp,"--output-filename","regpilot"]
        p = subprocess.run(args,cwd=temp,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3000)
        ended = datetime.now(timezone.utc)
        raw = Path(temp)/"regpilot.ocsf.json"
        if p.returncode!=0 or not raw.is_file() or raw.stat().st_size>150*1024**2:
            raise ValueError("The scoped engine did not complete a bounded scan. Check native read permissions and provider configuration.")
        report = bundle(a.provider,a.account,a.source,control,selected,json.loads(raw.read_bytes()),started,ended)
        RECEIPTS.write_new(a.output,report)
        print(json.dumps(report["summary"],sort_keys=True))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    subs=parser.add_subparsers(dest="mode",required=True)
    scan=subs.add_parser("scan")
    scan.add_argument("--provider",choices=sorted(CATALOGUE["providers"]),required=True)
    for name in ("account","source","control"):
        scan.add_argument("--"+name,required=True)
    scan.add_argument("--output",type=Path,required=True)
    scan.add_argument("--region")
    scan.add_argument("--auth")
    scan.add_argument("--check",nargs="+")
    delivery=subs.add_parser("deliver")
    delivery.add_argument("--report",type=Path,required=True)
    delivery.add_argument("--workspace",required=True)
    a=parser.parse_args()
    if a.mode=="scan":
        run(a)
    else:
        sender=shared("site_delivery",ROOT.parent/"instrument-bridge"/"deliver.py")
        token=os.environ.get("REGPILOT_OBSERVATION_TOKEN")
        if not token:
            raise ValueError("Set the scoped workspace observation credential.")
        n=RECEIPTS.send_saved(a.report,a.workspace,sender.deliver,token)
        print(f"{n} cloud control observations acknowledged.")


if __name__=="__main__":
    try:
        main()
    except (ValueError,OSError,KeyError,TypeError,RuntimeError,subprocess.SubprocessError) as error:
        sys.exit("Cloud collection failed: "+str(error))
