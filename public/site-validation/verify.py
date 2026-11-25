"""Verify a customer cold-chain inspection ZIP against the exact digest from its authenticated download."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile, BadZipFile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def inspect(path, digest, release, site_name, serial, stock):
    require(path.stat().st_size <= 40*1024**2, "Inspection file exceeds the supported size.")
    match=re.fullmatch(r"sha-256=:([A-Za-z0-9+/]{43}=):",digest)
    expected=base64.b64decode(match[1]).hex() if match else digest.lower()
    require(re.fullmatch(r"[a-f0-9]{64}",expected) and hashlib.sha256(path.read_bytes()).hexdigest()==expected,
            "The ZIP differs from the trusted workspace download digest.")
    with ZipFile(path) as archive:
        files=archive.infolist()
        require(len(files)<=500 and len({f.filename for f in files})==len(files)
                and sum(f.file_size for f in files)<40*1024**2,"Duplicate or oversized ZIP entries.")
        packet=json.loads(archive.read("site-inspection.json"))
        site=packet["site"];protocol=site["protocol"];supplier=packet["supplier"]
        require(packet["format"]=="regpilot-site-inspection-v1" and site["status"]=="APPROVED_FOR_SITE_USE" and not site["blockers"],
                "The workspace has not recorded a current site approval.")
        require(protocol["environment"]=="PROTECTED_PILOT" and protocol["site"]==site_name and protocol["intendedUse"]
                and protocol["release"]==site["currentRelease"]==site["finishRelease"]==supplier["revision"]==release,
                "The site or release differs from the assessor's expected scope.")
        approved=[d for d in site["decisions"] if d["input"]["decision"]=="APPROVE"]
        require(len(approved)==1 and not any(d["input"]["decision"]=="WITHDRAW" for d in site["decisions"]),
                "The sign-off was withdrawn or ambiguous.")
        approval=approved[0];exc=approval["excursion"];qual=exc["qualification"]
        require(exc["site"]==site_name and qual["release"]==release and qual["ownership"]["category"]=="CUSTOMER"
                and exc["serial"]==serial and stock in exc["stock"] and exc["assessorId"] and exc["disposition"] and exc["sourceRef"],
                "The independent excursion does not cover this instrument and stock.")
        require(approval["supplier"]=={"receiptId":supplier["receiptId"],"digest":supplier["digest"]}
                and supplier["digest"]=="sha256:"+hashlib.sha256(archive.read(supplier["entry"])).hexdigest(),
                "The supplier validation attachment differs from the approved release.")
        roles={}
        for record in packet["sources"]:
            data=archive.read(record["entry"])
            require(len(data)==record["sizeBytes"] and hashlib.sha256(data).hexdigest()==record["sha256"],
                    "A reviewed original differs from the dossier.")
            roles[record["id"]]=set(record["roles"])
        for identifier,role in ((exc["stockEvidenceId"],"excursion-stock"),(exc["decisionEvidenceId"],"excursion-disposition"),
                                (exc["authorityEvidenceId"],"excursion-authority"),(approval["input"]["decisionFile"],"signed-approve"),
                                (approval["input"]["authorityFile"],"signatory-authority")):
            require(role in roles.get(identifier,set()),"A required signed source is missing.")
        require(any("excursion-calibration" in group for group in roles.values()),"The calibration evidence is missing.")
        return {"site":site_name,"intendedUse":protocol["intendedUse"],"release":release,"instrument":serial,
                "lot":stock,"case":exc["caseId"],"disposition":exc["disposition"],"reviewReceipt":exc["receiptId"],
                "reviewedOriginals":len(roles),"zipSha256":expected}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive",type=Path)
    for name in ("digest","release","site","serial","stock"):
        parser.add_argument("--"+name,required=True)
    args=parser.parse_args()
    try:
        print(json.dumps(inspect(args.archive,args.digest,args.release,args.site,args.serial,args.stock),indent=2))
    except (ValueError,OSError,KeyError,TypeError,BadZipFile) as exc:
        sys.exit("Inspection verification failed. "+str(exc))
