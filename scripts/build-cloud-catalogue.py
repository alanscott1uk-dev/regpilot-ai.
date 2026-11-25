"""Extract the IDs of executable inventory checks from the exact upstream distribution."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
WHEEL_SHA = "b9134bdbf4899cbb2ef36e1bb1432d97b2af19a155d7f9861086f780a3ca0a96"


def catalogue(wheel):
    if hashlib.sha256(wheel.read_bytes()).hexdigest() != WHEEL_SHA:
        raise ValueError("The Prowler wheel does not match the approved release.")
    checks = {}
    with ZipFile(wheel) as dist:
        for path in sorted(dist.namelist()):
            if not path.startswith("prowler/providers/") or not path.endswith(".metadata.json"):
                continue
            row = json.loads(dist.read(path))
            provider, identifier = row["Provider"], row["CheckID"]
            stem = path.removesuffix(".metadata.json")
            if path.split("/")[2] != provider or stem.rsplit("/",1)[1] != identifier:
                raise ValueError("Mismatched policy metadata in the upstream distribution.")
            classes = ast.parse(dist.read(stem+".py")).body
            if not any(isinstance(node, ast.ClassDef) and node.name == identifier and
                       any(isinstance(fn, ast.FunctionDef) and fn.name == "execute" for fn in node.body) for node in classes):
                raise ValueError("Missing executable policy " + identifier)
            checks.setdefault(provider, []).append(identifier)
    return {"engine":"Prowler", "version":"5.52.0", "wheelSha256":WHEEL_SHA,
            "upstreamRevision":"dea664572ca5b3795c25bbf10ad291766a08ca59",
            "uniquePolicies":len(set().union(*checks.values())),
            "providers":{kind:sorted(set(ids)) for kind,ids in sorted(checks.items())}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheel",type=Path)
    parser.add_argument("--verify",action="store_true")
    args = parser.parse_args()
    result = catalogue(args.wheel)
    path = ROOT/"public/cloud-controls/catalogue.json"
    if args.verify:
        assert json.loads(path.read_bytes()) == result
    else:
        path.write_text(json.dumps(result,indent=2)+"\n")
    print(result["uniquePolicies"],"distinct policies in",len(result["providers"]),"providers")
