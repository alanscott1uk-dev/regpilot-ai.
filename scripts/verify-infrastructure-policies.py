"""Exercise the shipped collector, independent policy list and offline redelivery against real source files."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
from unittest.mock import MagicMock, patch
import sys
from tempfile import TemporaryDirectory
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "public/infrastructure-policy/collect.py"
spec = importlib.util.spec_from_file_location("policy_bridge", TOOL)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

TERRAFORM = """
resource "aws_s3_bucket_public_access_block" "archived" {
  bucket = "private-fixture-bucket"
  block_public_acls = true
  ignore_public_acls = true
  block_public_policy = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_public_access_block" "review" {
  bucket = "private-fixture-review"
  block_public_acls = false
  ignore_public_acls = true
  block_public_policy = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket" "records" {
  #checkov:skip=CKV_AWS_145:Deferred in this test fixture
  bucket = "regpilot-fixture-evidence"
}
"""
POD = """apiVersion: v1
kind: Pod
metadata:
  name: internal-fixture-object
spec:
  containers:
    - name: sample
      image: nginx:1.28
      securityContext:
        runAsNonRoot: true
"""
CLOUDFORMATION = """AWSTemplateFormatVersion: '2010-09-09'
Resources:
  SampleBucket:
    Type: AWS::S3::Bucket
    Properties:
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        IgnorePublicAcls: true
        BlockPublicPolicy: true
        RestrictPublicBuckets: true
"""

EXTRA_FILES = {
    "storage.json": json.dumps({
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        "contentVersion": "1.0.0.0", "resources": [{"type": "Microsoft.Storage/storageAccounts",
        "apiVersion": "2023-01-01", "name": "samplefixturestorage", "location": "uksouth",
        "kind": "StorageV2", "sku": {"name": "Standard_LRS"}, "properties": {"allowBlobPublicAccess": False}}]}),
    "storage.bicep": """resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'samplefixturestorage'
  location: 'uksouth'
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: { allowBlobPublicAccess: false }
}
""",
    "Dockerfile": 'FROM alpine:3.21\nUSER 10001\nCMD ["true"]\n',
    ".github/workflows/fixture.yml": """name: Fixture
on: [workflow_dispatch]
permissions: {contents: read}
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: echo fixture
""",
    ".gitlab-ci.yml": "stages: [build]\nbuild:\n  stage: build\n  image: alpine:3.21\n  script: [echo fixture]\n",
    "roles/fixture/tasks/main.yml": """- name: Check a service endpoint
  ansible.builtin.uri:
    url: https://example.invalid/health
    validate_certs: true
- name: Install a package
  ansible.builtin.apt:
    name: ca-certificates
    state: present
""",
    "openapi.yml": """openapi: 3.0.3
info: {title: Test service, version: '1'}
servers: [{url: 'https://example.invalid'}]
paths:
  /health:
    get:
      responses:
        '200': {description: Healthy}
""",
    "serverless.yml": """service: policy-fixture
provider:
  name: aws
  runtime: nodejs22.x
functions:
  status:
    handler: index.status
""",
}


def verify(output):
    catalogue = json.loads(bridge.CATALOGUE.read_bytes())
    assert bridge.policy_catalogue() == catalogue
    template = (TOOL.parent / "monitor.yml").read_text()
    for source in (TOOL, bridge.CATALOGUE, TOOL.parent / "requirements.txt", ROOT / "public/instrument-bridge/deliver.py"):
        assert hashlib.sha256(source.read_bytes()).hexdigest() + "  " + source.name in template
    sender_spec = importlib.util.spec_from_file_location("regpilot_sender", ROOT / "public/instrument-bridge/deliver.py")
    sender = importlib.util.module_from_spec(sender_spec)
    sender_spec.loader.exec_module(sender)
    preview = "https://authorised.example.invalid"
    credentials = {"REGPILOT_PREVIEW_ORIGIN": preview, "REGPILOT_PREVIEW_TOKEN": "fixture-key"}
    assert sender.preview_headers(preview, credentials) == {"x-vercel-protection-bypass": "fixture-key"}
    assert sender.preview_headers(preview, {}) == {}
    for destination in ("https://other.example.invalid", preview+".foreign.invalid"):
        try:
            sender.preview_headers(destination, credentials)
            raise AssertionError("A different origin cannot receive the preview credential.")
        except ValueError:
            pass
    empty = {"check_type": "terraform", "summary": {"checkov_version": bridge.ENGINE, "passed": 0, "failed": 0,
             "skipped": 0, "resource_count": 0, "parsing_errors": 1},
             "results": {"passed_checks": [], "failed_checks": [], "skipped_checks": [], "parsing_errors": ["fixture"]}}
    incomplete = bridge.make_bundle(str(uuid4()), "fixture", "a"*40, {"terraform"}, 1, 0, empty, catalogue)
    assert incomplete["observations"][0]["body"]["checks"][0]["status"] == "UNKNOWN"
    actual_style = {"check_type": "github_actions", "summary": {"checkov_version": bridge.ENGINE, "passed": 2, "failed": 0,
                    "skipped": 0, "resource_count": 0, "parsing_errors": 0}, "results": {"failed_checks": [], "skipped_checks": [],
                    "parsing_errors": [], "passed_checks": [{"file_path": "/.github/workflows/check.yml", "resource": "jobs(test)",
                    "check_result": {"result": "PASSED"}, "check_id": policy} for policy in ("CKV_GHA_1", "CKV_GHA_2")]}}
    qualified = bridge.make_bundle(str(uuid4()), "fixture", "a"*40, {"github_actions"}, 1, 0, actual_style, catalogue)
    assert qualified["observations"][0]["body"]["checks"][0]["status"] == "PASS" and qualified["summary"]["resourceCount"] == 1
    partial = bridge.make_bundle(str(uuid4()), "fixture", "a"*40, {"github_actions","terraform"}, 1, 0, actual_style, catalogue)
    assert partial["observations"][0]["body"]["checks"][0]["status"] == "UNKNOWN" and partial["summary"]["unassessedFrameworks"] == ["terraform"]
    empty["summary"]["passed"] = 1
    try:
        bridge.aggregate(empty, {"terraform"}, catalogue)
        raise AssertionError("A missing policy result must invalidate the scan.")
    except ValueError:
        pass
    with TemporaryDirectory() as name:
        work = Path(name)
        repo = work / "repo"
        repo.mkdir()
        sources = {"sample.tf": TERRAFORM, "pod.yaml": POD, "stack.template": CLOUDFORMATION, **EXTRA_FILES}
        for path, data in sources.items():
            (repo / path).parent.mkdir(parents=True, exist_ok=True)
            (repo / path).write_text(data)
        (repo / ".checkov.yml").write_text("skip-check: CKV_AWS_53\n")
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
        subprocess.run(["git", "-C", str(repo), "-c", "user.name=RegPilot QA", "-c",
                        "user.email=qa@example.invalid", "commit", "-qm", "Fixture"], check=True)
        revision = bridge.git(repo, "rev-parse", "HEAD").decode().strip()
        (repo / "sample.tf").write_text("")  # Only committed definitions can contribute.
        report = work / "report.json"
        control = str(uuid4())
        subprocess.run([sys.executable, str(TOOL), "scan", "--repo", str(repo), "--source", "release-fixture",
                        "--control", control, "--framework", *bridge.FRAMEWORKS,
                        "--output", str(report)], check=True, stdout=subprocess.DEVNULL)
        bundle = json.loads(report.read_bytes())
        summary = bundle["summary"]
        assert summary["reportedFrameworks"] == sorted(bridge.FRAMEWORKS), summary
        assert summary["revision"] == revision and summary["files"] == len(sources) and summary["parseErrors"] == 0
        assert summary["executedPolicies"] > 19 and all(n > 0 for n in summary["decisions"].values())
        assert summary["availablePolicies"] > summary["executedPolicies"] and len(bundle["observations"]) > 1
        checks = {check["key"]: check for envelope in bundle["observations"] for check in envelope["body"]["checks"]}
        assert checks["ckv_aws_53"]["status"] == "FAIL" and checks["ckv_aws_145"]["status"] == "UNKNOWN"
        assert all(e["body"]["checks"][0]["status"] == "FAIL" for e in bundle["observations"])
        assert not any(secret in report.read_text() for secret in ("internal-fixture-object", "private-fixture", "sample.tf", "Deferred in"))
        assert all(len(e["body"]["checks"]) <= 20 for e in bundle["observations"])
        envelope = bundle["observations"][0]
        returned = {"id": str(uuid4()), "externalId": envelope["body"]["externalId"],
                    "controlId": envelope["body"]["controlId"], "reused": False}
        transport = MagicMock()
        transport.getresponse.return_value.status = 201
        transport.getresponse.return_value.read.return_value = json.dumps(returned).encode()
        with patch.dict(sender.os.environ, credentials), patch.object(sender.http.client, "HTTPSConnection", return_value=transport):
            assert sender.deliver(preview, envelope, "workspace-scope")["id"] == returned["id"]
        headers = transport.request.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer workspace-scope"
        assert headers["x-vercel-protection-bypass"] == "fixture-key"
        delivered, lost = [], [True]
        def send(origin, envelope, credential):
            assert origin == "https://fixture.invalid" and credential == "test"
            key = envelope["idempotencyKey"]
            if delivered and lost[0]:
                lost[0] = False
                raise TimeoutError("synthetic transport interruption")
            delivered.append(key)
            return {"id": str(uuid4()), "idempotencyKey": key}
        try:
            bridge.send_saved(report, "https://fixture.invalid", send, "test")
            raise AssertionError("Expected the interrupted batch")
        except TimeoutError:
            pass
        assert bridge.send_saved(report, "https://fixture.invalid", send, "test") == len(delivered)
        assert bridge.send_saved(report, "https://fixture.invalid", send, "test") == len(delivered)
        assert len(delivered) == len(set(delivered)) == len(bundle["observations"])
        if output:
            output.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(report, output / "observations.json")
            bridge.write_new(output / "benchmark.json", {"engineVersion": bridge.ENGINE, "uniquePolicies": catalogue["uniquePolicies"],
                             "formats": len(catalogue["frameworks"]), "tested": summary, "scope": "Synthetic committed definitions"})
        print(json.dumps({"engineVersion": bridge.ENGINE, "uniquePolicies": catalogue["uniquePolicies"], **summary}))


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("--output", type=Path)
    verify(args.parse_args().output)
