"""Exercise cloud account scope, hourly receipts and a real Prowler executable against local S3."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

import boto3

ROOT=Path(__file__).resolve().parents[1]
COLLECTOR=ROOT/"public/cloud-controls/collect.py"
spec=importlib.util.spec_from_file_location("cloud",COLLECTOR)
cloud=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)


def run():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1",0))
        port=listener.getsockname()[1]
    url=f"http://127.0.0.1:{port}"
    env=dict(os.environ,AWS_ACCESS_KEY_ID="fixture",AWS_SECRET_ACCESS_KEY="fixture",AWS_DEFAULT_REGION="us-east-1",
             AWS_ENDPOINT_URL=url,AWS_EC2_METADATA_DISABLED="true")
    binary=Path(sys.executable).with_name("moto_server")
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)
        service=subprocess.Popen([str(binary),"-H","127.0.0.1","-p",str(port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                if service.poll() is not None:
                    raise RuntimeError("The local Moto server did not start.")
                try:
                    with socket.create_connection(("127.0.0.1",port),.2):
                        break
                except OSError:
                    time.sleep(.1)
            s3=boto3.client("s3",endpoint_url=url,region_name="us-east-1",aws_access_key_id="fixture",aws_secret_access_key="fixture")
            for name in ("approved-site-bucket","incomplete-site-bucket"):
                s3.create_bucket(Bucket=name)
            s3.put_public_access_block(Bucket="approved-site-bucket",PublicAccessBlockConfiguration=dict(BlockPublicAcls=True,IgnorePublicAcls=True,BlockPublicPolicy=True,RestrictPublicBuckets=True))
            args=[sys.executable,str(COLLECTOR),"scan","--provider","aws","--region","us-east-1","--source","fixture","--control",str(uuid4()),"--check","s3_bucket_level_public_access_block","s3_bucket_public_access","--output",str(path/"scan.json"),"--account"]
            subprocess.run([*args,"123456789012"],env=env,check=True,timeout=120)
            report=json.loads((path/"scan.json").read_bytes())
            assert report["summary"]["policiesWithDecisions"]==2
            assert report["summary"]["resourceDecisions"]["FAIL"]>=1 and report["summary"]["resourceDecisions"]["PASS"]>=1
            assert "approved-site-bucket" not in json.dumps(report)
            assert len(report["observations"])==1
            assert report["observations"][0]["body"]["checks"][0]["status"]=="FAIL"
            calls=[]
            def send(origin,envelope,token):
                calls.append(envelope["idempotencyKey"])
                return {"id":str(uuid4()),"idempotencyKey":calls[-1]}
            for _ in range(2):
                assert cloud.RECEIPTS.send_saved(path/"scan.json","https://fixture.invalid",send,"fixture")==1
            assert len(calls)==1
            args[args.index(str(path/"scan.json"))]=str(path/"other.json")
            rejected=subprocess.run([*args,"987654321098"],env=env,capture_output=True,timeout=120)
            assert rejected.returncode!=0 and b"different provider or customer account" in rejected.stderr and not (path/"other.json").exists()
            print("Two native AWS controls, mixed resource outcomes, wrong-account rejection, and idempotent delivery passed.")
        finally:
            service.terminate()
            service.wait(timeout=10)


if __name__=="__main__":
    run()
