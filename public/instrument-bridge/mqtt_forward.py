"""Automatically seal site MQTT evidence windows and deliver each durable receipt."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import fcntl
import http.client
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from uuid import UUID

from deliver import deliver, DeliveryRejected, workspace_url
from mqtt_logger import config, export, instant, open_spool, sha


def tick(cfg, samples, archive, origin, period, token, send=deliver, now=None):
    url = workspace_url(origin)
    origin = "https://" + url.netloc.lower()
    if not token or type(period) is not int or not 1 <= period <= 3600:
        raise ValueError("Configure a workspace credential and an interval of 1 to 3600 seconds.")
    archive.mkdir(parents=True, mode=0o700, exist_ok=True)
    now = now or datetime.now(timezone.utc)
    latest = (int(now.timestamp()) - cfg["maxDeliveryDelaySeconds"]) // period * period
    with (archive/".forward.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"state": "RUNNING"}
        with closing(sqlite3.connect(archive/"delivery.sqlite", timeout=20)) as queue:
            queue.executescript("""
              CREATE TABLE IF NOT EXISTS schedule(id INTEGER PRIMARY KEY CHECK(id=1),scope TEXT,origin TEXT,period INTEGER,nextEnd INTEGER);
              CREATE TABLE IF NOT EXISTS windows(end INTEGER PRIMARY KEY,status TEXT NOT NULL,digest TEXT NOT NULL,ack TEXT);
              CREATE INDEX IF NOT EXISTS pending_windows ON windows(status,end);
            """)
            with queue:
                queue.execute("INSERT OR IGNORE INTO schedule VALUES(1,?,?,?,?)",(cfg["scope"],origin,period,latest))
            scope, target, interval, cursor = queue.execute("SELECT scope,origin,period,nextEnd FROM schedule WHERE id=1").fetchone()
            if (scope,target,interval) != (cfg["scope"],origin,period):
                raise ValueError("This archive belongs to a different source, interval or workspace.")
            # Include the latest closed interval even while recovering older windows after downtime.
            due = list(range(cursor,min(cursor + 12*period,latest+period),period))
            for end in dict.fromkeys([latest, *due] if due else []):
                if queue.execute("SELECT 1 FROM windows WHERE end=?", (end,)).fetchone():
                    continue
                path = archive/str(end)
                export(cfg, samples, datetime.fromtimestamp(end-period,timezone.utc), datetime.fromtimestamp(end,timezone.utc), path)
                with queue:
                    queue.execute("INSERT INTO windows VALUES(?,'PENDING',?,NULL)",(end,sha((path/"receipt.json").read_bytes())))
            if due:
                with queue:
                    queue.execute("UPDATE schedule SET nextEnd=? WHERE id=1",(due[-1]+period,))
            current = queue.execute("SELECT end,digest FROM windows WHERE status='PENDING' ORDER BY end DESC LIMIT 4").fetchall()
            older = queue.execute("SELECT end,digest FROM windows WHERE status='PENDING' ORDER BY end LIMIT 8").fetchall()
            for end,digest in dict.fromkeys([*current,*older]):
                path = archive/str(end)
                raw = (path/"receipt.json").read_bytes()
                if sha(raw) != digest:
                    raise ValueError("The saved observation differs from the sealed MQTT window.")
                envelope = json.loads(raw)
                source_hash = envelope["body"]["partnerRecord"]["record"]["rawFileSha256"]
                if sha((path/"source.jsonl").read_bytes()) != source_hash:
                    raise ValueError("The site source archive differs from its sealed digest.")
                try:
                    received = send(origin, envelope, token)
                except DeliveryRejected as failure:
                    if (failure.status != 400 or failure.code != "invalid_observation_window"
                            or instant(envelope["body"]["validUntil"]) > now):
                        raise
                    status, receipt = "EXPIRED_UNDELIVERED", None
                except (OSError, http.client.HTTPException) as exc:
                    raise ConnectionError("Could not confirm workspace delivery.") from exc
                else:
                    if received["idempotencyKey"] != envelope["idempotencyKey"]:
                        raise ValueError("The workspace acknowledgement differs from its sealed window.")
                    status, receipt = "ACKNOWLEDGED", str(UUID(received["id"]))
                with queue:
                    queue.execute("UPDATE windows SET status=?,ack=? WHERE end=?",(status,receipt,end))
            counts = dict(queue.execute("SELECT status,count(*) FROM windows GROUP BY status"))
            return {"state":"CHECKED","acknowledged":counts.get("ACKNOWLEDGED",0),"pending":counts.get("PENDING",0),
                    "expiredUndelivered":counts.get("EXPIRED_UNDELIVERED",0),"catchingUp":bool(due and due[-1]<latest)}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("config","spool","archive"):
        parser.add_argument("--"+field, type=Path, required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--interval-seconds",type=int,default=3600)
    parser.add_argument("--once",action="store_true",help="Process due windows once for a site timer")
    args = parser.parse_args()
    cfg, token = config(args.config), os.environ.get("REGPILOT_OBSERVATION_TOKEN")
    if not args.spool.is_file():
        raise ValueError("Start the site logger and use its existing spool.")
    if not token:
        raise ValueError("Set the scoped workspace observation credential.")
    with closing(open_spool(args.spool,cfg["scope"])) as samples:
        while True:
            try:
                print(json.dumps(tick(cfg,samples,args.archive,args.workspace,args.interval_seconds,token)),flush=True)
            except (DeliveryRejected, ConnectionError, TimeoutError, http.client.HTTPException) as exc:
                if args.once:
                    raise
                print("Workspace delivery pending. "+str(exc),file=sys.stderr,flush=True)
            if args.once:
                return
            time.sleep(min(30,args.interval_seconds))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error, http.client.HTTPException) as error:
        sys.exit("MQTT forwarding failed: "+str(error))
