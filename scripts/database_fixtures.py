"""Start isolated databases for the source collection acceptance tests."""
import os
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
def mssql(network, host, first, second):
    admin = "Rp!" + secrets.token_hex(24)
    docker("pull", "mcr.microsoft.com/mssql/server:2022-latest")
    docker("run", "-d", "--name", host, "--network", network,
           "-e", "ACCEPT_EULA=Y", "-e", "MSSQL_PID=Developer", "-e", "MSSQL_SA_PASSWORD",
           "mcr.microsoft.com/mssql/server:2022-latest", env=dict(os.environ, MSSQL_SA_PASSWORD=admin))

    def sql(statement, required=True):
        return docker("exec", "-i", "-e", "SQLCMDPASSWORD", host, "/opt/mssql-tools18/bin/sqlcmd",
                      "-S", "localhost", "-U", "sa", "-C", "-b", input_text=statement,
                      env=dict(os.environ, SQLCMDPASSWORD=admin), required=required)

    wait_for(lambda: sql("SELECT 1;", False).returncode == 0)
    sql("CREATE DATABASE evidence;")
    sql("CREATE LOGIN source_reader WITH PASSWORD=N'Rp!" + first + "';")
    sql("USE evidence; CREATE USER source_reader FOR LOGIN source_reader; "
        "CREATE TABLE dbo.release_gate(id int PRIMARY KEY, decision varchar(32)); "
        "INSERT INTO dbo.release_gate VALUES(1,'accepted'),(2,'accepted'),(3,'hold'); "
        "ALTER ROLE db_datareader ADD MEMBER source_reader; GRANT VIEW DEFINITION TO source_reader;")

    def rotate():
        sql("USE evidence; UPDATE dbo.release_gate SET decision='accepted' WHERE id=3;")
        sql("ALTER LOGIN source_reader WITH PASSWORD=N'Rp!" + second + "';")

    def config(password):
        return {"host":host,"port":1433,"database":"evidence","schemas":["dbo"],"username":"source_reader",
                "password":"Rp!"+password,"replication_method":{"method":"STANDARD"},
                "ssl_mode":{"mode":"encrypted_trust_server_certificate"},"tunnel_method":{"tunnel_method":"NO_TUNNEL"}}

    yield config, rotate


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
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError

    image = "mongo:7.0"
    admin = secrets.token_hex(24)
    key_volume = "regpilot-mongo-"+secrets.token_hex(8)
    data_volume = key_volume+"-data"
    def client():
        address = docker("port",host,"27017/tcp").stdout.strip()
        port = int(address.split(":")[-1])
        return MongoClient("127.0.0.1",port,username="fixture_admin",password=admin,authSource="admin",
                           directConnection=True,serverSelectionTimeoutMS=2000,connectTimeoutMS=2000)
    def ready(c, primary=False):
        try:
            c.admin.command("connectionStatus")
            return not primary or c.admin.command("hello").get("isWritablePrimary") is True
        except PyMongoError:
            return False
    mount = ["-v",data_volume+":/data/db","-p","127.0.0.1::27017"]
    docker("volume","create",key_volume)
    docker("volume","create",data_volume)
    try:
        docker("run","--rm","-i","--entrypoint","sh","-v",key_volume+":/secret",image,"-c",
               "umask 077; cat > /secret/key && chown mongodb:mongodb /secret/key && chmod 400 /secret/key",
               input_text=secrets.token_hex(64))
        # The image provisions its first administrator before accepting connections on the container network.
        docker("run","-d","--name",host,"--network",network,*mount,"-e","MONGO_INITDB_ROOT_USERNAME=fixture_admin",
               "-e","MONGO_INITDB_ROOT_PASSWORD",image,env=dict(os.environ,MONGO_INITDB_ROOT_PASSWORD=admin))
        with client() as standalone:
            wait_for(lambda: ready(standalone))
        docker("stop","-t","30",host)
        docker("rm",host)
        docker("run","-d","--name",host,"--hostname",host,"--network",network,*mount,"-v",key_volume+":/secret:ro",image,
               "mongod","--replSet","rs0","--bind_ip_all","--keyFile","/secret/key")
        with client() as replica:
            wait_for(lambda: ready(replica))
            replica.admin.command("replSetInitiate",{"_id":"rs0","members":[{"_id":0,"host":host+":27017"}]})
            wait_for(lambda: ready(replica,primary=True))
            replica.admin.command("createUser","source_reader",pwd=first,roles=[{"role":"read","db":"evidence"}])
            table=replica.evidence.release_gate
            table.insert_many([{"_id":1,"decision":"accepted"},{"_id":2,"decision":"accepted"},{"_id":3,"decision":"hold"}])
            def rotate():
                assert table.update_one({"_id":3},{"$set":{"decision":"accepted"}}).modified_count==1
                replica.admin.command("updateUser","source_reader",pwd=second)
            yield (lambda password: {"database_config":{"cluster_type":"SELF_MANAGED_REPLICA_SET",
                     "connection_string":"mongodb://"+host+":27017/?replicaSet=rs0","databases":["evidence"],
                     "username":"source_reader","password":password,"auth_source":"admin","schema_enforced":True}},rotate)
    finally:
        docker("rm","-f","-v",host,required=False)
        docker("volume","rm",key_volume,data_volume,required=False)
