"""Run one upstream resource fixture per eligible policy and record actual check returns."""
import argparse
import ast
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import functools
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT/"public/cloud-controls/catalogue.json"


def cases(suite, catalogue):
    chosen = []
    for provider, ids in catalogue["providers"].items():
        for identifier in ids:
            found = list((suite/"tests/providers"/provider/"services").glob("*/"+identifier+"/"+identifier+"_test.py"))
            if len(found) != 1:
                continue
            path = found[0]
            source = path.read_text()
            choices = []
            tree = ast.parse(source)
            functions = [(fn,"") for fn in tree.body if isinstance(fn,ast.FunctionDef)]
            for cls in tree.body:
                if isinstance(cls,ast.ClassDef) and cls.name.startswith("Test"):
                    functions.extend((fn,cls.name+"::") for fn in cls.body if isinstance(fn,ast.FunctionDef))
            for fn,group in functions:
                if not fn.name.startswith("test_") or ".execute(" not in source:
                    continue
                body = "\n".join(source.splitlines()[fn.lineno-1:fn.end_lineno])
                if ".status" not in body:
                    continue
                case = str(path.relative_to(suite))+"::"+group+fn.name
                choices.append((0 if "PASS" in body or "FAIL" in body else 1,len(body),case))
            if choices:
                chosen.append((provider,identifier,min(choices)[-1]))
    return chosen


class Capture:
    def __init__(self, cases):
        self.cases = {case:(provider,identifier) for provider,identifier,case in cases}
        self.active = None
        self.returns, self.passed = {}, set()

    def pytest_sessionstart(self,session):
        from prowler.lib.check.models import Check
        def wrap(cls):
            method = cls.__dict__.get("execute")
            parts = cls.__module__.split(".")
            if not method or len(parts)<5 or parts[:2]!=["prowler","providers"]:
                return
            @functools.wraps(method)
            def execute(instance,*args,**kwargs):
                returned = method(instance,*args,**kwargs)
                if self.active and self.cases.get(self.active)==(parts[2],cls.__name__):
                    states = Counter(getattr(item,"status","") for item in returned)
                    if states and set(states) <= {"PASS","FAIL","MANUAL"}:
                        self.returns[self.active] = dict(states)
                return returned
            cls.execute = execute
        def subclasses(base):
            for child in base.__subclasses__():
                wrap(child)
                subclasses(child)
        subclasses(Check)
        original = Check.__init_subclass__
        def created(cls, **kwargs):
            original(**kwargs)
            wrap(cls)
        Check.__init_subclass__ = classmethod(created)

    def pytest_runtest_setup(self,item):
        self.active = item.nodeid.partition("[")[0]

    def pytest_runtest_logreport(self,report):
        if report.when=="call" and report.passed:
            self.passed.add(report.nodeid.partition("[")[0])


def batch(suite, work):
    import pytest
    # The controlled suite can access loopback fixtures. Public account reads are a separate test.
    previous = socket.socket.connect
    def locally(sock,destination):
        if sock.family in (socket.AF_INET,socket.AF_INET6) and destination[0] not in ("127.0.0.1","localhost","::1"):
            raise OSError("External networks are disabled for controlled policy fixtures.")
        return previous(sock,destination)
    socket.socket.connect = locally
    group = json.loads(work.read_text())
    if any(provider == "m365" for provider, _, _ in group):
        # Upstream tests inject Microsoft service objects. Keep their eager module-level
        # clients from starting or authenticating a real PowerShell process during import.
        from unittest.mock import patch
        from prowler.providers.m365.lib.powershell.m365_powershell import M365PowerShell
        patch.object(M365PowerShell, "__init__", return_value=None).start()
        # No provider inventory exists outside the scenario injected by each test.
        # Scope the empty transport to this pytest process. All decisions still come
        # from the pinned check's execute() and the upstream scenario assertions.
        patch.object(M365PowerShell, "execute", return_value="").start()
        for name in ("close", "connect_exchange_online", "connect_microsoft_teams", "connect_pnp_online"):
            if hasattr(M365PowerShell, name):
                patch.object(M365PowerShell, name, return_value=None).start()
    capture = Capture(group)
    sys.path.insert(0,str(suite))
    os.chdir(suite)
    status = pytest.main(["-q","--disable-warnings","--tb=short",*[case for _,_,case in group]],plugins=[capture])
    records=[{"provider":provider,"id":identifier,"case":case,"decisions":capture.returns[case]}
             for provider,identifier,case in group if case in capture.returns and case in capture.passed]
    work.with_suffix(".results").write_text(json.dumps({"exit":int(status),"checks":records}))


def run(args):
    catalogue = json.loads(CATALOGUE.read_bytes())
    suite = args.suite.resolve()
    cs = cases(suite,catalogue)
    if args.provider:
        cs = [entry for entry in cs if entry[0] == args.provider]
    if args.shards > 1:
        cs = [entry for entry in cs if int(hashlib.sha256(entry[1].encode()).hexdigest(),16)%args.shards==args.shard]
    print(len(cs),"eligible policy fixtures",flush=True)
    groups = [cs[i:i+35] for i in range(0,len(cs),35)]
    args.output.parent.mkdir(parents=True,exist_ok=True)
    evidence, failures = [], []
    with TemporaryDirectory() as temporary:
        base=Path(temporary)
        def execute(item):
            index,group=item
            task=base/(str(index)+".json")
            task.write_text(json.dumps(group))
            env={"HOME":str(base),"PATH":os.environ["PATH"],"PYTEST_DISABLE_PLUGIN_AUTOLOAD":"1",
                 "AWS_ACCESS_KEY_ID":"testing","AWS_SECRET_ACCESS_KEY":"testing","AWS_SESSION_TOKEN":"testing",
                 "AWS_DEFAULT_REGION":"us-east-1","AWS_EC2_METADATA_DISABLED":"true","PYTHONDONTWRITEBYTECODE":"1"}
            log=args.output.with_suffix("."+str(index)+".log")
            with log.open("w") as stream:
                outcome=subprocess.run([sys.executable,__file__,"--batch",str(task),"--suite",str(suite)],
                                       env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=700)
            report=task.with_suffix(".results")
            return (json.loads(report.read_text()) if outcome.returncode==0 and report.exists() else {"exit":1,"checks":[]}),index
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for report,index in pool.map(execute,enumerate(groups)):
                evidence.extend(report["checks"])
                if report["exit"]:
                    failures.append(index)
                print("Batch",index,"actual checks",len(report["checks"]),"pytest exit",report["exit"],flush=True)
    output={"version":catalogue["version"],"upstreamRevision":catalogue["upstreamRevision"],"type":"Controlled inventory fixture execution",
            "eligible":len(cs),"uniqueExecuted":len({r["id"] for r in evidence}),"failedBatches":failures,"checks":evidence}
    args.output.write_text(json.dumps(output,separators=(",",":"))+"\n")
    print("Distinct executed policies",output["uniqueExecuted"],"failed batches",failures,flush=True)
    if failures or (not args.provider and args.shards==1 and output["uniqueExecuted"]<=1400):
        sys.exit(1)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite",type=Path,required=True)
    parser.add_argument("--output",type=Path)
    parser.add_argument("--workers",type=int,default=2)
    parser.add_argument("--shards",type=int,default=1)
    parser.add_argument("--shard",type=int,default=0)
    parser.add_argument("--provider")
    parser.add_argument("--batch",type=Path)
    args=parser.parse_args()
    if args.batch:batch(args.suite,args.batch)
    elif args.output and 0<=args.shard<args.shards and 1<=args.workers<=8:run(args)
    else:parser.error("Choose an output file and valid worker and shard limits.")
