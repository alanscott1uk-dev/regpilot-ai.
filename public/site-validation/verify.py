"""Verify a customer cold-chain inspection ZIP against the exact digest from its authenticated download."""
import argparse
import base64
import csv
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import io
import hashlib
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile, BadZipFile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError("Invalid numeric temperature evidence.") from exc
    require(result.is_finite(), "Invalid numeric temperature evidence.")
    return result


def csv_rows(archive, entry, columns, maximum):
    with archive.open(entry) as raw, io.TextIOWrapper(raw, encoding="utf-8", newline="") as stream:
        reader = csv.reader(stream, strict=True)
        require(next(reader, None) == columns, "Temperature CSV columns differ from the export format.")
        rows = []
        for row in reader:
            require(len(row) == len(columns) and len(rows) < maximum, "Malformed or oversized temperature CSV.")
            rows.append(row)
    return rows


def verify_temperatures(archive, packet, excursion, require_history):
    history = excursion.get("history")
    receipt = excursion["receiptId"]
    links = [r for r in packet.get("temperatureReadings", []) if r["receiptId"] == receipt]
    if history is None:
        require(not links and not require_history, "No retained temperature history for the approved excursion.")
        return {"state": "UNAVAILABLE"}
    require(len(links) == 1 and links[0]["caseId"] == excursion["caseId"],
            "Temperature history does not resolve to the approved case and review receipt.")
    link = links[0]
    require(link["entry"] == f"temperature-{receipt}.csv", "Unexpected temperature evidence entry.")
    rows = csv_rows(archive, link["entry"], ["Sample UTC", "Temperature (C)", "Within approved limits", "Collection ID", "Result SHA-256"], 101)
    points = history["points"]
    require(len(rows) == len(points), "Temperature reading count differs from the reviewed history.")
    for row, point in zip(rows, points):
        require(row[0] == point["at"] and number(row[1]) == number(point["celsius"]) and
                row[2:] == [point["status"], point["runId"], point["resultHash"]], "Temperature reading differs from the reviewed history.")
    window = history.get("hourlyTemperature")
    require(bool(points) or (window and window["hours"]), "Temperature history has no observations.")
    require(("rangesEntry" in link) == (window is not None), "Hourly range attachment differs from the reviewed history.")
    result = {"state": "VERIFIED", "readings": len(points), "historyLimited": history["limited"], "hourlyRanges": 0}
    if window is not None:
        require(window.get("instrumentSerial", excursion["serial"]) == excursion["serial"] and
                link["rangesEntry"] == f"hourly-ranges-{receipt}.csv", "Hourly ranges refer to a different instrument or receipt.")
        ranges = csv_rows(archive, link["rangesEntry"], ["Hour start UTC", "Hour end UTC (exclusive)", "Minimum Celsius", "Maximum Celsius", "Reported samples"], 24)
        require(len(ranges) == len(window["hours"]), "Hourly range count differs from the reviewed history.")
        for row, hour in zip(ranges, window["hours"]):
            start = datetime.fromisoformat(hour["start"].replace("Z", "+00:00"))
            end = (start + timedelta(hours=1)).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            require(row[:2] == [hour["start"], end] and number(row[2]) == number(hour["minimum"]) and
                    number(row[3]) == number(hour["maximum"]) and row[4] == str(hour["samples"]),
                    "Hourly range differs from the reviewed instrument evidence.")
        result.update(hourlyRanges=len(ranges), sourceReportedComplete=window["complete"])
    return result


def inspect(path, digest, release, site_name, serial, stock, require_history=False):
    require(path.stat().st_size <= 40*1024**2, "Inspection file exceeds the supported size.")
    match=re.fullmatch(r"sha-256=:([A-Za-z0-9+/]{43}=):",digest)
    expected=base64.b64decode(match[1]).hex() if match else digest.lower()
    require(re.fullmatch(r"[a-f0-9]{64}",expected) and hashlib.sha256(path.read_bytes()).hexdigest()==expected,
            "The ZIP differs from the trusted workspace download digest.")
    with ZipFile(path) as archive:
        files=archive.infolist()
        require(len(files)<=500 and len({f.filename for f in files})==len(files)
                and sum(f.file_size for f in files)<40*1024**2,"Duplicate or oversized ZIP entries.")
        packet=json.loads(archive.read("site-inspection.json"), parse_float=Decimal)
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
                "temperatureEvidence":verify_temperatures(archive,packet,exc,require_history),"reviewedOriginals":len(roles),"zipSha256":expected}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive",type=Path)
    parser.add_argument("--require-history",action="store_true",help="Require retained temperature readings or hourly ranges.")
    for name in ("digest","release","site","serial","stock"):
        parser.add_argument("--"+name,required=True)
    args=parser.parse_args()
    try:
        print(json.dumps(inspect(args.archive,args.digest,args.release,args.site,args.serial,args.stock,args.require_history),indent=2))
    except (ValueError,OSError,KeyError,TypeError,OverflowError,csv.Error,BadZipFile) as exc:
        sys.exit("Inspection verification failed. "+str(exc))
