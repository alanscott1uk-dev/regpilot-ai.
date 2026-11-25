import {scheduledEvidence,missingMonitoringEvidence,sameKnownChecks} from '../lib/monitoring-criteria';
import test from "node:test";
import assert from "node:assert/strict";
import {collectWorkforce} from "../lib/connectors/workforce";
import {collectAwsOrganization,inspectAwsOrganization} from "../lib/connectors/aws-organization";
import {CollectionError} from "../lib/connectors/collection-error";
import {reconcileObservation,observationOutcome} from "../lib/connectors/observation";
import {compareLicence,licenceImport} from "../lib/supplier-licence";
import {supplierRegisterLinks} from "../lib/supplier-register-links";
import {findRegulatorServices,regulatorServices} from "../lib/regulator-services";
import {operatorQuestions,relevantConnections,researchHandoff} from "../lib/operator-answer";
import {connectorHealth} from "../lib/connectors/health-dashboard.mjs";
import {workspaceHref} from "../lib/client/workspace-context";
import {workforceTransport,leaver,credentials} from "./helpers/workforce-fixture";
import {awsTransport,brokerArn,accountId} from "./helpers/aws-evidence-fixture";
import {readWorkforceKeys,workforceKeys} from "../lib/connectors/workforce-target";

test("a completed Jira issue requires a unique HR match and a fresh read of the immutable Entra user",async()=>{
  const {state,fetcher,calls}=workforceTransport(),run=()=>collectWorkforce(leaver,credentials,fetcher);
  assert.deepEqual(readWorkforceKeys(...Object.values(workforceKeys(leaver)) as [string,string]),leaver);
  assert.equal(observationOutcome(await run()),"FOLLOW_UP");
  state.enabled=false;assert.equal(observationOutcome(await run()),"OBSERVED");assert.ok(calls.at(-1)?.endsWith(leaver.objectId));
  assert.doesNotMatch(JSON.stringify(await run()),/former@example|fictional-auth-token|fictional-microsoft-secret/);
  state.issue="new";assert.equal(observationOutcome(await run()),"FOLLOW_UP");state.issue="done";
  for(const change of [{aliases:0},{aliases:2},{partial:true},{absent:true},{wrongObject:true},{linked:false},{missingEmail:true},{termination:"2999-03-22"}]){
    const saved={...state};Object.assign(state,change);assert.equal(observationOutcome(await run()),"INCOMPLETE",JSON.stringify(change));Object.assign(state,saved);
  }
  state.revoked=true;await assert.rejects(run,(e:any)=>e.code==="CREDENTIAL_REJECTED");
});

const orgId="o-aabbccddee",target={awsOrganizationId:orgId,accountId,region:"eu-west-2" as const};
const member=(id:string)=>({Id:id,Arn:"arn:aws:organizations::"+accountId+":account/"+orgId+"/"+id,State:"ACTIVE"});
const clean=async(id:string)=>({engine:"member",sourceUrl:"https://aws.amazon.com/",capturedAt:new Date().toISOString(),checks:[{id:"s3",label:"Storage",status:"PASS" as const,observed:id,nextStep:"Inspect."}],limitations:[]});
test("AWS discovery follows empty pages to a terminal token, verifies account ownership and discloses omitted accounts",async()=>{
  const ids=[accountId,"333333333333"],identity={Organization:{Id:orgId,MasterAccountId:accountId}};
  const run=(accounts:ReturnType<typeof member>[],limit=false)=>inspectAwsOrganization(target,async(action,body)=>{
    if(action==="DescribeOrganization")return identity;
    if(limit)return {Accounts:[],NextToken:"page"+(Number(String(body.NextToken||"page0").slice(4))+1)};
    return body.NextToken?{Accounts:accounts}:{Accounts:[],NextToken:"second"};
  },clean);
  const result=await run(ids.map(member));assert.equal(observationOutcome(result),"OBSERVED");assert.match(result.checks.at(-1)!.observed,/2 of 2/);
  assert.equal(observationOutcome(await run(Array.from({length:7},(_,i)=>member(i===0?accountId:String(300000000000+i))))),"INCOMPLETE");
  assert.equal(observationOutcome(await run([],true)),"INCOMPLETE");
  await assert.rejects(()=>run([{...member(accountId),Arn:"arn:aws:organizations::another:account"}]),(e:any)=>e.code==="TARGET_MISMATCH");
  await assert.rejects(()=>run([member(accountId),member(accountId)]),(e:any)=>e.code==="INVALID_RESPONSE");
});
test("member role recovery replaces the earlier unknown check in a scheduled observation",async()=>{
  const read=async(action:string)=>action==="DescribeOrganization"?{Organization:{Id:orgId,ManagementAccountId:accountId}}:{Accounts:[member(accountId),member("333333333333")]};
  const denied=await inspectAwsOrganization(target,read,async id=>{if(id===accountId)throw new CollectionError("AWS_ROLE_ACCESS");return clean(id);});
  assert.equal(observationOutcome(denied),"INCOMPLETE");
  const recovered=reconcileObservation(await inspectAwsOrganization(target,read,clean),denied);
  assert.equal(recovered.checks.find(c=>c.id===accountId+"-access")?.status,"PASS");assert.equal(observationOutcome(recovered),"OBSERVED");
});
test("AWS organization requests are signed with the verified workspace customer session",async()=>{
  process.env.REGPILOT_AWS_BROKER_ROLE_ARN=brokerArn;
  const workspace=leaver.objectId,mock=awsTransport(workspace),calls:string[]=[];
  const result=await collectAwsOrganization(target,workspace,{...mock.runtime,fetcher:async(input,init)=>{
    assert.equal(String(input),"https://organizations.us-east-1.amazonaws.com/");
    const headers=new Headers(init?.headers),action=headers.get("x-amz-target")!.split(".").pop()!;
    assert.match(headers.get("authorization")||"",/AWS4-HMAC-SHA256.*us-east-1\/organizations\/aws4_request/);
    assert.ok(headers.get("x-amz-security-token"));calls.push(action);
    return Response.json(action==="DescribeOrganization"?{Organization:{Id:orgId,MasterAccountId:accountId}}:{Accounts:[member(accountId)]});
  }});
  assert.deepEqual(calls,["DescribeOrganization","ListAccounts"]);assert.equal(observationOutcome(result),"OBSERVED");
});

test("licence review matches site, legal name, explicit activity and evidence date independently",()=>{
  const scope={companyNumber:"SC123456",number:"12345",activity:"Holding" as const,premises:"Unit 2, High Street, Glasgow G1 1XX",reviewerId:leaver.objectId};
  const identity={companyNumber:scope.companyNumber,name:"Fictional Medicines Limited"};
  const record={state:"LISTED" as const,number:"12345",holder:identity.name,premises:scope.premises,activities:["Holding" as const],source:"https://cms.mhra.gov.uk/mhra/wda/uk-wdah-12345",checkedOn:"2026-11-01",reviewBy:"2026-12-01",conditions:"Specific products under the site annex",evidenceId:leaver.clientId};
  const compare=(r:typeof record)=>compareLicence(scope,r,identity,"2026-11-20");
  assert.deepEqual(compare(record),[]);
  const special={...scope,requiredAnnexEntries:["3.3","3.1.1"] as ("3.3"|"3.1.1")[]};
  assert.equal(compareLicence(special,record,identity,"2026-11-20").length,2);
  assert.deepEqual(compareLicence(special,{...record,annexEntries:["3.3","3.1.1"]},identity,"2026-11-20"),[]);
  for(const diff of [{holder:identity.name+" UK"},{premises:scope.premises.replace("2","3")},{activities:[]},{number:"1234"},{reviewBy:"2026-11-19"}])assert.ok(compare({...record,...diff}).length);
  assert.ok(compareLicence(scope,null,identity,"2026-11-20").length);
  assert.equal(licenceImport.safeParse({...record,source:record.source+"9"}).success,false);
  assert.equal(licenceImport.safeParse({...record,source:record.source.replace("cms.mhra.gov.uk","example.invalid")}).success,false);
});
test("regulator account questions return official, territory-specific actions independently of evidence search",()=>{
  const ids=(q:string,nation="")=>findRegulatorServices(q,nation).map(s=>s.id);
  assert.deepEqual(ids("Where can I sign in to my MHRA WDA(H) account?"),["mhra-process"]);
  assert.deepEqual(ids("Track our WDA(H) application"),["mhra-tracking"]);
  assert.deepEqual(ids("Home Office domestic licence renewal","Scotland"),["home-domestic"]);
  assert.deepEqual(ids("Apply for a domestic controlled-drug licence in Northern Ireland"),["ni-domestic"]);
  assert.deepEqual(ids("Open the Home Office import account","Northern Ireland"),["home-trade"]);
  assert.deepEqual(ids("Companies House login"),["companies-house"]);
  assert.deepEqual(ids("MHRA application for a specials manufacturer"),["mhra-manufacturing"]);
  for(const query of ["Check a supplier’s MHRA account","Open the public register for WDA(H)","What temperature must we record?"])assert.deepEqual(ids(query),[]);
  assert.equal(new Set(regulatorServices.map(s=>s.id)).size,regulatorServices.length);
  for(const service of regulatorServices)for(const url of [service.href,service.guidance].filter((v):v is string=>!!v)){
    const u=new URL(url);assert.equal(u.protocol,"https:");assert.equal(u.search+u.hash+u.username+u.password,"");
    assert.ok(u.hostname.endsWith(".gov.uk"));
  }
});
test("supplier records preserve the recorded MHRA edition, require the holder and premises, and reject unrelated identity links",()=>{
  const scope={companyNumber:"SC123456",number:"012345",premises:"Unit 2, High Street, Glasgow G1 1XX"};
  const record={state:"SUSPENDED" as const,number:scope.number,holder:"Fixture Ltd.",premises:scope.premises,activities:[],
    source:"https://cms.mhra.gov.uk/index.php/mhra/wda/uk-wdah-012345-3",checkedOn:"2026-06-01",reviewBy:"2026-07-01",
    conditions:"Fixture terms",evidenceId:leaver.clientId};
  const finding={scope,registeredName:"Fixture Ltd",saved:{record},identities:[]};
  const links=supplierRegisterLinks(finding,null);
  assert.equal(links[0].href,record.source);assert.match(links[0].note,/suspended on 2026-06-01/);
  assert.equal(links[1].href,"https://find-and-update.company-information.service.gov.uk/company/SC123456");
  for(const diff of [{holder:"Other Ltd"},{premises:"Unit 20, High Street, Glasgow"},{number:"12345"},{source:record.source+"?session=fixture"},{source:record.source.replace("cms.mhra.gov.uk","example.invalid")}]){
    const [fallback]=supplierRegisterLinks({...finding,saved:{record:{...record,...diff}}},null);
    assert.equal(fallback.kind,"search");assert.equal(fallback.href,"https://cms.mhra.gov.uk/mhra/wda");
  }
  assert.equal(supplierRegisterLinks({...finding,registeredName:null},null)[0].kind,"search");
  const other={current:true,companyNumber:"SC999999",snapshot:{capturedAt:"2026-06-01T12:00:00Z",observation:{sourceUrl:"https://search.gleif.org/#/record/12345678901234567890"}}};
  assert.equal(supplierRegisterLinks(finding,other).length,2);
  assert.deepEqual(supplierRegisterLinks(null,{...other,current:false}),[]);
  assert.equal(supplierRegisterLinks(null,{...other,snapshot:{...other.snapshot,observation:{sourceUrl:other.snapshot.observation.sourceUrl+"?redirect=elsewhere"}}}).length,1);
});
test("operator questions ask for missing site or employee and preserve private hand-off fragments",()=>{
  assert.match(operatorQuestions("temperature mappping","",false,false,[]).join(" " ),/storage area/);
  assert.match(operatorQuestions("standard operating procedures","",false,false,[]).join(" "),/activity and site/);
  assert.match(operatorQuestions("staff offboarding","",false,false,[]).join(" "),/employee ID/);
  assert.match(operatorQuestions("food allergen handover","",false,false,[]).join(" "),/production line/);
  const connection=connectorHealth([{id:"case42",target:"BambooHR sample-employer · leaver 42 · Jira OPS-42",provider:"WORKFORCE_LEAVER",scope:workforceKeys(leaver),controls:[]}]).items[0];
  assert.equal(relevantConnections("check OPS-42","",[connection]).length,1);
  for(const q of ["leaver OPS-420","employee ID 4","check OPS-43"])assert.deepEqual(relevantConnections(q,"",[connection]),[]);
  assert.deepEqual(relevantConnections("staff offboarding","leaver 4",[connection]),[]);
  const link=researchHandoff("temperature mappping",leaver.tenantId),url=new URL(link,"https://pilot.invalid");
  assert.equal(url.searchParams.size,1);assert.match(url.hash,/q=temperature\+mappping/);assert.equal(workspaceHref(link,leaver.tenantId),link);
});

test('customer cadence needs a current scheduled pair with a stable check set and distinct receipts',()=>{
 const now=Date.parse('2026-01-10T10:00:00Z'), day=86400000;
 const sample=(id:string,age:number)=>({id,mode:'SCHEDULED',version:4,at:new Date(now-age).toISOString(),checks:[{id:'stock',status:'PASS'}]});
 const newest=sample('two',1000),older=sample('one',day+1000);
 const check=(rows:typeof newest[])=>scheduledEvidence(rows,4,24,now);
 assert.deepEqual(check([older,newest]).cadenceReceipts,{older:'one',newer:'two'});
 assert.equal(check([older,newest,newest]).scheduledReads,2);
 assert.equal(check([{...newest,mode:'MANUAL'},sample('old',2*day),older]).cadence,false);
 assert.equal(check([{...newest,version:3},older]).cadence,false);
 assert.equal(check([{...newest,checks:[{id:'different',status:'PASS'}]},older]).cadence,false);
 assert.equal(check([{...newest,checks:[{id:'stock',status:'UNKNOWN'}]},older]).cadence,false);
 assert.equal(check([sample('future',-1000),older]).cadence,false);
 assert.equal(check([newest,sample('late',day+32*60000)]).cadence,false);
 assert.equal(check([{...newest,checks:[{id:'stock',status:'FAIL'}]},older]).cadence,true);
});
test('benchmark reasons use the same criteria as the qualified product total',()=>{
 const complete={productKey:'AWS',category:'CUSTOMER',current:true,repeat:true,rotated:true,cadence:true,recovered:true,inference:null};
 assert.deepEqual(missingMonitoringEvidence(complete),[]);
 assert.deepEqual(missingMonitoringEvidence({...complete,category:'STAGING',productKey:null,cadence:false,recovered:false,inference:false}),['product','ownership','cadence','recovery','inference']);
 assert.equal(sameKnownChecks([{id:'a',status:'PASS'}],[{id:'a',status:'UNKNOWN'}]),false);
});

test('software validation locates a current artifact only for the exact release, run, repository and final attempt',async()=>{
 const {softwareValidation}=await import('../lib/server/software-validation');
 const revision='c'.repeat(40),repo='alanscott1uk-dev/regpilot-ai.',run={id:110,run_attempt:2,path:'.github/workflows/release-validation.yml',repository:{full_name:repo},head_repository:{full_name:repo},head_sha:revision,status:'completed',conclusion:'success'};
 const artifact={id:112,name:'pharma-validation-'+revision+'-2',expired:false,digest:'sha256:'+'d'.repeat(64),expires_at:new Date(Date.now()+100000).toISOString(),workflow_run:{id:110,head_sha:revision}};
 const check=(r=run,a=artifact)=>softwareValidation(revision,async u=>Response.json(String(u).includes('/artifacts?')?{artifacts:[a]}:{workflow_runs:[r]}));
 const good=await check();assert.equal(good.state,'AVAILABLE');assert.ok(good.state==='AVAILABLE'&&good.downloadUrl.endsWith('/110/artifacts/112'));
 assert.equal((await check({...run,head_repository:{full_name:'other/repo'}})).state,'MISSING');assert.equal((await check({...run,conclusion:'failure'})).state,'FAILED');
 for(const item of [{...artifact,expired:true},{...artifact,name:artifact.name.slice(0,-1)+'1'},{...artifact,digest:''},{...artifact,workflow_run:{id:111,head_sha:revision}}])assert.equal((await check(run,item)).state,'UNAVAILABLE');
});
