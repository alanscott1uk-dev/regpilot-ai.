"""Read selected SQL control fields locally with the database's Python driver."""
import hashlib
import json
import ssl
import time
from contextlib import closing
from decimal import Decimal
from importlib.metadata import version
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

FORMAT = "regpilot-native-sql-v1"
SOURCES = {
    "postgres": ("PostgreSQL", "psycopg", "3.3.9", "psycopg[binary]==3.3.9", 5432),
    "mysql": ("MySQL", "PyMySQL", "1.2.4", "PyMySQL[rsa]==1.2.4", 3306),
    "mssql": ("Microsoft SQL Server", "python-tds", "1.17.1", "python-tds==1.17.1 pyOpenSSL==26.4.0", 1433),
    "clickhouse": ("ClickHouse", "clickhouse-connect", "1.13.0", "clickhouse-connect==1.13.0", 8443),
}


def plan_for(engine):
    name, package, release, install, _ = SOURCES[engine]
    return {"format": FORMAT, "name": name, "engine": engine, "driver": package,
            "driverVersion": release, "install": install, "version": "1.0.0",
            "definitionId": str(uuid5(NAMESPACE_URL, "https://regpilot.ai/connectors/sql/" + engine)),
            "artifactDigest": "sha256:" + hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


def verify(plan, digest):
    engine = plan["engine"]
    if engine not in SOURCES or plan != plan_for(engine) or digest != plan["artifactDigest"]:
        raise ValueError("Native SQL collector does not match the downloaded plan.")
    if version(plan["driver"]) != plan["driverVersion"]:
        raise ValueError("Install the driver version specified in the source plan.")
    return "regpilot/sql-" + engine + "@" + digest


def connect(engine, cfg):
    transport = cfg.get("transport", "verified-tls")
    if transport not in ("verified-tls", "private-network"):
        raise ValueError("Choose verified-tls or private-network transport.")
    secure = transport == "verified-tls"
    ca = cfg.get("caFile") or ssl.get_default_verify_paths().cafile
    args = dict(host=cfg["host"], port=int(cfg.get("port", SOURCES[engine][4])),
                user=cfg["username"], database=cfg["database"], password=cfg["password"])
    if engine == "postgres":
        import psycopg
        args["dbname"] = args.pop("database")
        return psycopg.connect(**args, connect_timeout=12, options="-c default_transaction_read_only=on -c statement_timeout=120000",
                               sslmode="verify-full" if secure else "disable", sslrootcert=ca if secure else None)
    if engine == "mysql":
        import pymysql
        return pymysql.connect(**args, connect_timeout=12, read_timeout=120, write_timeout=12,
                               ssl=ssl.create_default_context(cafile=ca) if secure else None,
                               ssl_disabled=not secure, cursorclass=pymysql.cursors.SSCursor)
    if engine == "mssql":
        import pytds
        if secure and not ca:
            raise ValueError("Supply the trusted SQL Server CA certificate file.")
        args["server"] = args.pop("host")
        return pytds.connect(**args, login_timeout=12, timeout=120, readonly=True, cafile=ca if secure else None,
                             validate_host=True, disable_connect_retry=True)
    from clickhouse_connect import dbapi
    args["username"] = args.pop("user")
    return dbapi.connect(**args, secure=secure, verify=secure, ca_cert=ca if secure else None,
                         connect_timeout=12, send_receive_timeout=120)


def identifier(engine, name):
    if not isinstance(name, str) or not name or len(name) > 256 or any(ord(c) < 32 for c in name):
        raise ValueError("Unsupported database identifier.")
    left, right = ("[", "]") if engine == "mssql" else (('"', '"') if engine == "postgres" else ('`', '`'))
    if engine == "clickhouse":
        name = name.replace("\\", "\\\\")
    return left + name.replace(right, right + right) + right


def values(engine, cfg, statement, parameters=()):
    with closing(connect(engine, cfg)) as db, closing(db.cursor()) as cursor:
        cursor.execute(statement, parameters) if parameters else cursor.execute(statement)
        while batch := cursor.fetchmany(256):
            yield from batch


def discover(engine, cfg):
    if engine == "clickhouse":
        sql, args = "SELECT database, table, name FROM system.columns WHERE database=currentDatabase() LIMIT 5001", ()
    else:
        schemas = (cfg.get("schemas", ["public" if engine == "postgres" else "dbo"])
                   if engine != "mysql" else [cfg["database"]])
        if not isinstance(schemas, list) or not 1 <= len(schemas) <= 32 or any(not isinstance(s, str) or not s for s in schemas):
            raise ValueError("Select between one and 32 database schemas.")
        sql = "SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_schema IN (" + ",".join(["%s"] * len(schemas)) + ")"
        args = tuple(schemas)
    streams = {}
    for index, (namespace, name, field) in enumerate(values(engine, cfg, sql, args)):
        if index >= 5000:
            raise ValueError("Narrow the read account or selected schemas to 5,000 accessible columns.")
        streams.setdefault((namespace, name), {})[field] = {}
    return [{"name": name, "namespace": namespace, "json_schema": {"properties": fields},
             "supported_sync_modes": ["full_refresh"]} for (namespace, name), fields in streams.items()]


def run(engine, cfg, command, handler, catalog=None, fields=()):
    if command == "check":
        if [tuple(row) for row in values(engine, cfg, "SELECT 1")] != [(1,)]:
            raise ValueError("Read account did not confirm source access.")
        handler({"type": "CONNECTION_STATUS", "connectionStatus": {"status": "SUCCEEDED"}})
    elif command == "discover":
        handler({"type": "CATALOG", "catalog": {"streams": discover(engine, cfg)}})
    elif command == "read":
        stream = json.loads(catalog.read_text())["streams"][0]["stream"]
        if not fields or any(f not in stream["json_schema"]["properties"] for f in fields):
            raise ValueError("The selected columns were not found in this source.")
        columns = ", ".join(identifier(engine, f) for f in fields)
        table = ".".join(identifier(engine, stream[k]) for k in ("namespace", "name"))
        projection = "TOP (20001) " if engine == "mssql" else ""
        limit = "" if engine == "mssql" else " LIMIT 20001"
        sql = "SELECT " + projection + columns + " FROM " + table + limit
        deadline = time.monotonic() + 240
        for count, row in enumerate(values(engine, cfg, sql)):
            if count >= 20000 or time.monotonic() > deadline:
                raise ValueError("Narrow the selected source view before collecting this control.")
            data = {key: Decimal(str(value)) if isinstance(value, float) else value for key, value in zip(fields, row)}
            handler({"type": "RECORD", "record": {"stream": stream["name"], "namespace": stream["namespace"], "data": data}})
    else:
        raise ValueError("Unknown collection operation.")


if __name__ == "__main__":
    import sys
    plans = {engine: plan_for(engine) for engine in SOURCES}
    print(json.dumps(plans if sys.argv[1] == "--manifest" else plans[sys.argv[1]], indent=2))
