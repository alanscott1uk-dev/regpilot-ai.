"""Verify each proposed product against Pipedream's public release metadata."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from html import unescape
import json
from pathlib import Path
import re
from threading import Lock
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CELLS=re.compile(r"<dt\b[^>]*>(.*?)</dt>\s*<dd\b[^>]*>(.*?)</dd>",re.I|re.S)
TAG=re.compile(r"<[^>]+>")


def verify(source,output,cache):
    proposals=json.loads(source.read_bytes())
    cache.mkdir(parents=True,exist_ok=True)
    rate=Lock()
    next_request=[0.]
    def fetch(url):
        with rate:
            time.sleep(max(0,next_request[0]-time.monotonic()))
            next_request[0]=time.monotonic()+.16
        req=Request(url,headers={"User-Agent":"RegPilot integration release verifier","Accept":"text/html"})
        with urlopen(req,timeout=15) as response:
            if not response.geturl().startswith("https://pipedream.com/apps/"):
                raise ValueError("Unexpected component registry origin")
            body=response.read(512001)
            if len(body)>512000:raise ValueError("Unexpected component metadata size")
        fields={unescape(TAG.sub("",k)).strip():unescape(TAG.sub("",v)).strip() for k,v in CELLS.findall(body.decode())}
        return fields
    def check(entry):
        family,apps=entry
        confirmed=[]
        for slug,actions in sorted(apps.items()):
            for action,version,prop in actions:
                key=slug+"-"+action
                stored=cache/(key+"@"+version+".json")
                if stored.is_file():
                    fields=json.loads(stored.read_text())
                else:
                    try:
                        fields=fetch("https://pipedream.com/apps/"+slug+"/actions/"+action)
                    except HTTPError as ex:
                        if ex.code in (404,410):fields={}
                        elif ex.code==429:
                            with rate:next_request[0]=max(next_request[0],time.monotonic()+min(120,int(ex.headers.get("Retry-After","15"))))
                            continue
                        else:continue
                    except (URLError,TimeoutError,ConnectionError,ValueError):continue
                    stored.write_text(json.dumps(fields))
                auth=fields.get("Authentication","").strip()
                if (fields.get("Registry key")==key and fields.get("Version")==version and fields.get("Read-only")=="Yes"
                        and fields.get("Destructive")=="No" and auth.lower() not in ("","none","no auth","no authentication","not required","public","n/a")):
                    confirmed.append([slug,action,version,prop,fields["App"],auth])
                    break
        return family,confirmed
    result={}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for index,(family,rows) in enumerate(pool.map(check,proposals["products"].items()),1):
            if rows:result[family]=rows
            if index%100==0:print(index,"products inspected,",len(result),"confirmed",flush=True)
    payload={"revision":proposals["revision"],"sourceDigest":proposals["sourceDigest"],"checkedAt":datetime.now(timezone.utc).isoformat(),
             "products":result}
    output.write_text(json.dumps(payload,separators=(",",":"),ensure_ascii=True)+"\n")
    print("Published, authenticated product families",len(result),flush=True)


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("source",type=Path);p.add_argument("output",type=Path);p.add_argument("--cache",required=True,type=Path)
    a=p.parse_args();verify(a.source,a.output,a.cache)
