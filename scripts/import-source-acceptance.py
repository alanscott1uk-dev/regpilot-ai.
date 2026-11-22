"""Import a completed branch acceptance run into RegPilot staging using gh and psql."""
import json
import re
import subprocess
import sys

REPO = "alanscott1uk-dev/regpilot-ai."
BRANCH = "feature/traceability-benchmark-batch-20261106"
READ_STEP = "Read real database rows and rotate the source credential"
INTAKE_STEP = "Admit the real collector receipts through the RegPilot observations API"


def gh(*args):
    return subprocess.check_output(["gh", *args], text=True)


def import_run(run_id):
    if not re.fullmatch(r"[1-9][0-9]{0,18}", run_id):
        raise ValueError("Invalid run ID")
    run = json.loads(gh("api", f"repos/{REPO}/actions/runs/{run_id}"))
    if (run["event"] != "pull_request" or run["head_repository"]["full_name"] != REPO or run["head_branch"] != BRANCH or
            run["path"] != ".github/workflows/integration-directory.yml" or run["conclusion"] != "success"):
        raise ValueError("Expected a successful integration workflow from the RegPilot feature branch")
    data = json.loads(gh("run", "view", run_id, "--repo", REPO, "--json", "jobs"))
    jobs = [j for j in data["jobs"] if j["name"].startswith("database-source (")]
    if not jobs:
        raise ValueError("The workflow did not run any database collectors")
    for job in jobs:
        passed = {s["name"] for s in job["steps"] if s["conclusion"] == "success"}
        if job["conclusion"] != "success" or not {READ_STEP, INTAKE_STEP}.issubset(passed):
            raise ValueError("Database collector or workspace admission did not pass")
        lines = gh("run", "view", "--repo", REPO, "--job", str(job["databaseId"]), "--log").splitlines()
        reports = [json.loads(line[line.index('{"source":'):]) for line in lines if READ_STEP in line and '{"source":' in line]
        if len(reports) != 1:
            raise ValueError("Expected one collector report")
        r = reports[0]
        before, after = r["before"], r["renewed"]
        if not (r["scope"] == "Disposable CI database" and r["retiredCredentialRejected"] is True and
                before["status"] == "FAIL" and after["status"] == "PASS" and
                before["counts"]["missing"] == after["counts"]["missing"] == after["counts"]["different"] == 0 and
                before["counts"]["different"] > 0 and before["rows"] == after["rows"] == after["counts"]["matched"] ==
                before["counts"]["matched"] + before["counts"]["different"]):
            raise ValueError("Evidence does not demonstrate the tested control transition")
        params = {"job":job["databaseId"],"run":run_id,"sha":run["head_sha"],"image":r["source"],
                  "version":r["version"],"digest":r["digest"],"completed":job["completedAt"],
                  "matched":before["counts"]["matched"],"different":before["counts"]["different"],"after":after["rows"]}
        statement = """
INSERT INTO regpilot_verification.source_acceptance
 (job,run,commit_sha,definition_id,version,digest,completed_at,before_matched,before_different,after_matched)
VALUES (:'job'::bigint,:'run'::bigint,:'sha',(SELECT id FROM regpilot_verification.source_collection_plans
 WHERE kind='database' AND artifact_verified AND image=:'image' AND version=:'version' AND artifact_digest=:'digest'),
 :'version',:'digest',:'completed'::timestamptz,:'matched'::int,:'different'::int,:'after'::int)
ON CONFLICT(job) DO NOTHING;
"""
        args = ["psql","-Xq","-v","ON_ERROR_STOP=1"]
        for name, value in params.items():
            args += ["-v", name + "=" + str(value)]
        subprocess.run(args, input=statement, text=True, check=True)
        print(r["source"], r["version"], "job", job["databaseId"])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Pass the integration workflow run ID")
    import_run(sys.argv[1])
