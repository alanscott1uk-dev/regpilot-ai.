// Isolated physical restore of generated records. Every database and file path is created by this process.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createServer} from "node:net";
import {randomBytes,createHash} from "node:crypto";
import {mkdtemp, mkdir, appendFile, cp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const repo=fileURLToPath(new URL("..",import.meta.url));
const bin=process.env.REGPILOT_TEST_PG_BIN||execFileSync("pg_config",["--bindir"],{encoding:"utf8"}).trim();
const version=execFileSync(join(bin,"postgres"),["--version"],{encoding:"utf8"}).trim();
const work=await mkdtemp(join(tmpdir(),"regpilot-restore-"));
const source=join(work,"source"),backup=join(work,"backup"),restored=join(work,"restored");
const port=await new Promise((resolve,reject)=>{
  const server=createServer().once("error",reject).listen(0,"127.0.0.1",()=>{
    const port=server.address().port;
    server.close(()=>resolve(port));
  });
});
const password=randomBytes(24).toString("hex"),pwfile=join(work,"fixture-password");
const url=new URL("postgresql://regpilot_fixture@127.0.0.1/postgres");
url.port=String(port);url.password=password;
process.env.DATABASE_URL=url.toString();
const prisma=join(repo,"node_modules",".bin","prisma");
const backend=(name,args)=>execFileSync(join(bin,name),args,{stdio:"pipe"});
let running=null,db;
function start(dir){
  backend("pg_ctl",["-D",join(dir,"db"),"-l",join(work,"postgres.log"),"-w","start"]);
  running=dir;
}
function stop(){
  if(running)backend("pg_ctl",["-D",join(running,"db"),"-m","fast","-w","stop"]);
  running=null;
}
try{
  await mkdir(source,{mode:0o700});await writeFile(pwfile,password+"\n",{mode:0o600});
  backend("initdb",["-D",join(source,"db"),"-U","regpilot_fixture","--auth-local=trust","--auth-host=scram-sha-256","--pwfile="+pwfile,"--no-locale","--encoding=UTF8"]);
  await appendFile(join(source,"db","postgresql.conf"),"\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\nport = "+port+"\n");
  start(source);
  for(const args of [["db","push","--skip-generate"],...["security/test-role-setup.sql","security/supabase-private-tables.sql"].map(file=>["db","execute","--file",file,"--schema","prisma/schema.prisma"])]){
    execFileSync(prisma,args,{cwd:repo,stdio:"pipe"});
  }
  const {assuranceFixture}=await import("../tests/helpers/assurance-fixture.ts");
  const {downloadEvidence}=await import("../lib/server/evidence-service.ts");
  ({db}=await import("../lib/server/db.ts"));
  const fixture=await assuranceFixture(),file=await fixture.file();
  const original=await db.evidence.findFirstOrThrow({where:{organizationId:fixture.a.id,id:file.id}});
  const sourceAudit=await db.auditEvent.findMany({where:{organizationId:fixture.a.id,entityId:file.id},orderBy:{id:"asc"}});
  assert.ok(sourceAudit.some(row=>row.action==="evidence.independent_review"));
  const filePath=join(source,"vault",original.storageKey);
  await mkdir(dirname(filePath),{recursive:true,mode:0o700});
  await writeFile(filePath,await fixture.store.get(original.storageKey),{mode:0o600});
  await db.$disconnect();stop();
  await cp(source,backup,{recursive:true,preserveTimestamps:true});
  const started=Date.now();
  await cp(backup,restored,{recursive:true,preserveTimestamps:true});start(restored);
  const storage={get:key=>readFile(join(restored,"vault",key))};
  const actual=await downloadEvidence(fixture.ad,file.id,storage);
  const sha256=createHash("sha256").update(actual.bytes).digest("hex");
  assert.equal(sha256,file.sha256);
  assert.deepEqual(await db.evidence.findUniqueOrThrow({where:{id:file.id}}),original);
  assert.deepEqual(await db.auditEvent.findMany({where:{organizationId:fixture.a.id,entityId:file.id},orderBy:{id:"asc"}}),sourceAudit);
  await assert.rejects(downloadEvidence(fixture.out,file.id,storage),e=>e.status===404);
  const [protection]=await db.$queryRaw`SELECT relrowsecurity AS protected, has_table_privilege('authenticated','public."Evidence"','SELECT') AS exposed FROM pg_class WHERE oid='public."Evidence"'::regclass`;
  assert.deepEqual(protection,{protected:true,exposed:false});
  const altered=Buffer.from(actual.bytes);altered[altered.length-1]^=1;
  await writeFile(join(restored,"vault",original.storageKey),altered);
  await assert.rejects(downloadEvidence(fixture.ad,file.id,storage),e=>e.status===409);
  const receipt={scenario:"isolated cold restore of generated PostgreSQL and local evidence files",postgres:version,restoreAndVerifyMs:Date.now()-started,sha256,
    evidenceFiles:1,tenants:2,auditEntries:sourceAudit.length,independentApprovalRetained:true,foreignAccessBlocked:true,privateTableGrantsRetained:true,alteredBytesBlocked:true};
  await mkdir(join(repo,"artifacts"),{recursive:true});
  await writeFile(join(repo,"artifacts","recovery-drill.json"),JSON.stringify(receipt,null,2)+"\n");
  console.log(JSON.stringify(receipt));
} catch(error) {
  const log=await readFile(join(work,"postgres.log"),"utf8").catch(()=>"");
  if(log)console.error(log.trim().split("\n").slice(-5).join("\n"));
  throw error;
} finally {
  await db?.$disconnect();
  try{stop();}finally{if(!running)await rm(work,{recursive:true,force:true});}
}
