"""Read a disposable database with the installed vendor connector before and after credential rotation."""
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from uuid import uuid4


def command(*args, **kwargs):
    return subprocess.run(args, text=True, check=True, **kwargs)


kind = sys.argv[1]
pg = kind == "postgres"
engines = {
    "postgres": ("postgres:17", "3.8.11", "decd338e-5647-4c0b-adf4-da0e75f5a750", "POSTGRES_PASSWORD"),
    "mysql": ("mysql:8.4", "3.53.10", "435bb9a5-7887-4809-aa58-28c27df0d7ad", "MYSQL_ROOT_PASSWORD"),
    "clickhouse": ("clickhouse/clickhouse-server:25.8", "0.4.0", "bad83517-5e54-4a3d-9b53-63e85fbd4d7c", "CLICKHOUSE_PASSWORD")
}
db_image, version, definition, password_env = engines[kind]
source = "airbyte/source-" + kind
network = "regpilot-" + kind
instance = "evidence-" + kind
admin, first, second = [secrets.token_hex(20) for _ in range(3)]
command("docker", "pull", source + ":" + version, stdout=subprocess.DEVNULL)
digests = json.loads(command("docker", "image", "inspect", "--format", "{{json .RepoDigests}}", source + ":" + version,
                             capture_output=True).stdout)
digest = next(d.split("@")[1] for d in digests if d.startswith(source + "@"))
command("docker", "network", "create", network)
os.environ[password_env] = admin
try:
    command("docker", "run", "-d", "--name", instance, "--network", network,
            "-e", password_env, db_image)
    cli = (["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"] if pg else ["mysql", "-uroot"])
    if kind == "clickhouse":
        cli = ["clickhouse-client", "--multiquery"]
    def query(sql, check=True):
        # Pass credentials via environment, SQL over stdin. Never print credential-bearing SQL.
        env = dict(os.environ, MYSQL_PWD=admin, CLICKHOUSE_PASSWORD=admin)
        return subprocess.run(["docker", "exec", "-i", "-e", "MYSQL_PWD", "-e", "CLICKHOUSE_PASSWORD", instance, *cli],
                              input=sql, env=env, text=True, capture_output=True, check=check)
    for attempt in range(90):
        if query("select 1;", False).returncode == 0 and (kind != "mysql" or
                subprocess.run(["docker","exec",instance,"mysqladmin","--protocol=tcp","ping"],capture_output=True).returncode == 0):
            break
        time.sleep(2)
    if pg:
        query("CREATE TABLE release_gate(id int primary key, decision text); CREATE USER source_reader PASSWORD '" + first +
              "'; GRANT SELECT ON release_gate TO source_reader; INSERT INTO release_gate VALUES(1,'accepted'),(2,'accepted'),(3,'hold');")
        cfg = {"host": instance, "port": 5432, "database": "postgres", "schemas": ["public"], "username": "source_reader",
               "tunnel_method": {"tunnel_method": "NO_TUNNEL"}, "replication_method": {"method": "Standard"},
               "ssl_mode": {"mode": "disable"}}
    elif kind == "mysql":
        query("CREATE DATABASE evidence; CREATE TABLE evidence.release_gate(id int primary key, decision varchar(32)); "
              "CREATE USER 'source_reader'@'%' IDENTIFIED BY '" + first +
              "'; GRANT SELECT ON evidence.* TO 'source_reader'@'%'; INSERT INTO evidence.release_gate VALUES(1,'accepted'),(2,'accepted'),(3,'hold');")
        cfg = {"host": instance, "port": 3306, "database": "evidence", "username": "source_reader",
               "replication_method": {"method": "STANDARD"}, "ssl_mode": {"mode": "preferred"}}
    else:
        query("CREATE DATABASE evidence; CREATE TABLE evidence.release_gate(id UInt32, decision String) ENGINE=MergeTree ORDER BY id; "
              "CREATE USER source_reader IDENTIFIED WITH sha256_password BY '" + first +
              "'; GRANT SELECT ON evidence.* TO source_reader; INSERT INTO evidence.release_gate VALUES(1,'accepted'),(2,'accepted'),(3,'hold');")
        cfg = {"host":instance, "port":8123, "database":"evidence", "username":"source_reader", "ssl":False}
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        plan, config = folder / "plan.json", folder / "config.json"
        plan.write_text(json.dumps({"format": "regpilot-airbyte-source-v1", "image": source, "version": version, "definitionId": definition, "artifactDigest": digest}))
        cfg["password"] = first
        config.write_text(json.dumps(cfg))
        command_base = [sys.executable, "public/database-bridge/collect.py", "--config", str(config), "--plan", str(plan),
                        "--digest", digest, "--network", network]
        access = command(*command_base, "--check-access", capture_output=True)
        assert json.loads(access.stdout) == {"access":"confirmed"}
        streams = json.loads(command(*command_base, "--list-streams", capture_output=True).stdout)
        matches = [stream for stream in streams if stream["stream"] == "release_gate" and "decision" in stream["fields"]]
        assert len(matches) == 1, "Expected one release gate stream with the configured field"
        qualifier = ["--namespace", matches[0]["namespace"]] if matches[0]["namespace"] is not None else []
        def read(label):
            receipt = folder / (label + ".json")
            result = subprocess.run([*command_base, "--stream", "release_gate", *qualifier,
                                    "--field", "decision", "--expected", '"accepted"', "--control", control, "--output", str(receipt)],
                                   capture_output=True, text=True)
            if label == "retired":
                assert result.returncode and not receipt.exists(), "Retired credential must not produce a receipt"
                return
            if result.returncode:
                raise RuntimeError(label + ": " + result.stderr.strip())
            envelope = json.loads(receipt.read_text())
            assert envelope["body"]["controlId"] == control and len(envelope["body"]["checks"]) >= 3
            assert first not in receipt.read_text() and second not in receipt.read_text()
            return json.loads(result.stdout)
        control = str(uuid4())
        old = read("before")
        assert old == {"rows": 3, "status": "FAIL", "counts": {"matched": 2, "different": 1, "missing": 0}}, old
        if pg:
            query("UPDATE release_gate SET decision='accepted' WHERE id=3; ALTER USER source_reader PASSWORD '" + second + "';")
        elif kind == "mysql":
            query("UPDATE evidence.release_gate SET decision='accepted' WHERE id=3; ALTER USER 'source_reader'@'%' IDENTIFIED BY '" + second + "';")
        else:
            query("ALTER TABLE evidence.release_gate UPDATE decision='accepted' WHERE id=3 SETTINGS mutations_sync=1; "
                  "ALTER USER source_reader IDENTIFIED WITH sha256_password BY '" + second + "';")
        read("retired")
        cfg["password"] = second
        config.write_text(json.dumps(cfg))
        renewed = read("renewed")
        assert renewed == {"rows": 3, "status": "PASS", "counts": {"matched": 3, "different": 0, "missing": 0}}, renewed
        envelopes = [json.loads((folder / name).read_text()) for name in ("before.json","renewed.json")]
        Path("database-acceptance-envelopes.json").write_text(json.dumps(envelopes))
        report = {"source": source, "version": version, "digest": digest, "before": old, "retiredCredentialRejected": True,
                  "renewed": renewed, "scope": "Disposable CI database"}
        Path("live-" + kind + "-evidence.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
finally:
    subprocess.run(["docker", "rm", "-f", instance], capture_output=True)
    subprocess.run(["docker", "network", "rm", network], capture_output=True)
