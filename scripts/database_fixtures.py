"""Start isolated databases for the source collection acceptance tests."""
import json
import os
import re
import secrets
import subprocess
import time
from contextlib import contextmanager


def docker(*args, input_text=None, env=None, required=True):
    result = subprocess.run(["docker", *args], input=input_text, text=True, capture_output=True,
                            env=env, timeout=180)
    if required and result.returncode:
        # Shell and database error messages can echo statements containing fixture credentials.
        raise RuntimeError("Database fixture command failed (%s, exit %s)" % (args[0], result.returncode))
    return result


def wait_for(probe):
    for _ in range(70):
        if probe():
            return
        time.sleep(2)
    raise RuntimeError("The disposable database did not become ready")


@contextmanager
def tidb(network, host, first, second):
    docker("run","-d","--name",host,"--network",network,"pingcap/tidb:v8.5.3",
           "--store=unistore","--path=","--host=0.0.0.0")
    client = "mysql:8.4"
    docker("pull",client)
    admin = secrets.token_hex(24)
    def sql(statement, password, required=True):
        return docker("run","--rm","-i","--network",network,"-e","MYSQL_PWD",client,"mysql","--protocol=tcp",
                      "--ssl-mode=DISABLED","-h",host,"-P","4000","-u","root",
                      input_text=statement,env=dict(os.environ,MYSQL_PWD=password),required=required)
    wait_for(lambda: sql("SELECT 1;","",False).returncode == 0)
    sql("ALTER USER 'root'@'%' IDENTIFIED BY '"+admin+"';","")
    sql("CREATE DATABASE evidence; CREATE TABLE evidence.release_gate(id INT PRIMARY KEY, decision VARCHAR(32)); "
        "CREATE USER 'source_reader'@'%' IDENTIFIED BY '"+first+"'; GRANT SELECT ON evidence.* TO 'source_reader'@'%'; "
        "INSERT INTO evidence.release_gate VALUES(1,'accepted'),(2,'accepted'),(3,'hold');",admin)
    def rotate():
        sql("UPDATE evidence.release_gate SET decision='accepted' WHERE id=3; "
            "ALTER USER 'source_reader'@'%' IDENTIFIED BY '"+second+"';",admin)
    yield (lambda password: {"host":host,"port":4000,"database":"evidence","username":"source_reader",
                             "password":password,"ssl":False},rotate)


@contextmanager
def cockroachdb(network, host, first, second):
    image = "cockroachdb/cockroach:v23.2.6"
    certs = "regpilot-certs-"+secrets.token_hex(8)
    docker("volume","create",certs)
    mount = certs+":/certs"
    try:
        for cert in (["create-ca"],["create-node",host,"localhost","127.0.0.1"],["create-client","root"]):
            docker("run","--rm","--user","0:0","-v",mount,image,"cert",*cert,"--certs-dir=/certs","--ca-key=/certs/ca.key")
        docker("run","-d","--name",host,"--network",network,"--user","0:0","-v",mount+":ro",image,
               "start-single-node","--certs-dir=/certs","--advertise-addr="+host,"--store=type=mem,size=640MiB")
        def sql(statement, required=True):
            return docker("exec","-i",host,"/cockroach/cockroach","sql","--certs-dir=/certs","--host=localhost",
                          input_text=statement,required=required)
        wait_for(lambda: sql("SELECT 1;",False).returncode == 0)
        sql("CREATE DATABASE evidence; CREATE TABLE evidence.public.release_gate(id INT PRIMARY KEY, decision STRING); "
            "CREATE USER source_reader WITH PASSWORD '"+first+"'; GRANT CONNECT ON DATABASE evidence TO source_reader; "
            "GRANT USAGE ON SCHEMA evidence.public TO source_reader; GRANT SELECT ON evidence.public.release_gate TO source_reader; "
            "INSERT INTO evidence.public.release_gate VALUES(1,'accepted'),(2,'accepted'),(3,'hold');")
        def rotate():
            sql("UPDATE evidence.public.release_gate SET decision='accepted' WHERE id=3; "
                "ALTER USER source_reader WITH PASSWORD '"+second+"';")
        yield (lambda password: {"host":host,"port":26257,"database":"evidence","username":"source_reader","password":password,
                                 "ssl":True,"jdbc_url_params":"sslmode=require"},rotate)
    finally:
        docker("rm","-f",host,required=False)
        docker("volume","rm",certs,required=False)


@contextmanager
def mongodb(network, host, first, second):
    image = "mongo:7.0"
    admin = secrets.token_hex(24)
    volume = "regpilot-mongo-"+secrets.token_hex(8)
    data = volume+"-data"
    docker("volume","create",volume)
    docker("volume","create",data)
    try:
        docker("run","--rm","-i","--entrypoint","sh","-v",volume+":/secret",image,"-c",
               "umask 077; cat > /secret/key && chown mongodb:mongodb /secret/key && chmod 400 /secret/key",
               input_text=secrets.token_hex(64))
        def js(statement, auth=False, required=True):
            login = "db.getSiblingDB('admin').auth('fixture_admin',"+json.dumps(admin)+");" if auth else ""
            program = login+statement
            script = "try { eval(process.env.REGPILOT_MONGO_TEST_JS) } catch(e) { print('fixture-code:'+String(e.codeName || e.code || e.name)); quit(1) }"
            result = docker("exec","-e","REGPILOT_MONGO_TEST_JS",host,"mongosh","mongodb://127.0.0.1:27017/admin?directConnection=true",
                            "--quiet","--eval",script,env=dict(os.environ,REGPILOT_MONGO_TEST_JS=program),required=False)
            if required and result.returncode:
                code = re.search(r"fixture-code:([A-Za-z0-9_-]+)",result.stdout)
                raise RuntimeError("MongoDB fixture failed: "+(code[1] if code else "shell exit "+str(result.returncode)))
            return result
        # Provision the fixture administrator through loopback before starting the authenticated replica.
        docker("run","-d","--name",host,"--network","none","-v",data+":/data/db",image,"mongod","--bind_ip","127.0.0.1")
        wait_for(lambda: js("if(!db.adminCommand({ping:1}).ok) quit(2)",required=False).returncode==0)
        js("db.getSiblingDB('admin').createUser({user:'fixture_admin',pwd:"+json.dumps(admin)+",roles:['root']});")
        docker("stop","-t","30",host)
        docker("rm",host)
        docker("run","-d","--name",host,"--hostname",host,"--network",network,"-v",volume+":/secret:ro","-v",data+":/data/db",
               image,"mongod","--replSet","rs0","--bind_ip_all","--keyFile","/secret/key")
        wait_for(lambda: js("if(!db.adminCommand({getCmdLineOpts:1}).ok) quit(2);",True,False).returncode==0)
        js("const r=db.adminCommand({replSetInitiate:{_id:'rs0',members:[{_id:0,host:'"+host+":27017'}]}}); if(!r.ok) quit(4);",True)
        wait_for(lambda: js("if(!db.hello().isWritablePrimary) quit(2);",True,False).returncode==0)
        js("db.getSiblingDB('admin').createUser({user:'source_reader',pwd:"+json.dumps(first)+
           ",roles:[{role:'read',db:'evidence'}]}); db.getSiblingDB('evidence').release_gate.insertMany("
           "[{_id:1,decision:'accepted'},{_id:2,decision:'accepted'},{_id:3,decision:'hold'}]);",True)
        def rotate():
            js("db.getSiblingDB('evidence').release_gate.updateOne({_id:3},{$set:{decision:'accepted'}}); "
               "db.getSiblingDB('admin').changeUserPassword('source_reader',"+json.dumps(second)+");",True)
        yield (lambda password: {"database_config":{"cluster_type":"SELF_MANAGED_REPLICA_SET",
                 "connection_string":"mongodb://"+host+":27017/?replicaSet=rs0","databases":["evidence"],
                 "username":"source_reader","password":password,"auth_source":"admin","schema_enforced":True}},rotate)
    finally:
        docker("rm","-f",host,required=False)
        docker("volume","rm",volume,required=False)
        docker("volume","rm",data,required=False)
