import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {collectAws} from "../lib/connectors/aws";
import {awsBinding,awsRoleTemplate} from "../lib/connectors/aws-target";
import {awsPosture,managementEvents,type AwsEvidenceReader} from "../lib/connectors/aws-posture";
import {collectGleif,findGleifCompany,gleifTarget} from "../lib/connectors/gleif";
import {CollectionError} from "../lib/connectors/collection-error";
import {observationOutcome} from "../lib/connectors/observation";
import {awsTransport,accountId,brokerArn} from "./helpers/aws-evidence-fixture";
import {ukRecord,lei,number} from "./helpers/gleif-fixture";

const target={accountId,region:"eu-west-2" as const},org=randomUUID();
const fails=(why:string)=>(e:unknown)=>e instanceof CollectionError&&e.code===why;
test("the official AWS clients use broker, external ID and exact caller binding before reading customer evidence",async()=>{
  process.env.REGPILOT_AWS_BROKER_ROLE_ARN=brokerArn;
  const f=awsTransport(org),out=await collectAws(target,org,f.runtime);
  assert.deepEqual(f.externalIds,[null,"regpilot-check-"+org,awsBinding(org).externalId]);
  assert.deepEqual(f.calls.slice(0,5),["AssumeRoleWithWebIdentity","AssumeRole","AssumeRole","AssumeRole","GetCallerIdentity"]);
  assert.equal(out.checks.length,10);assert.equal(observationOutcome(out),"OBSERVED");
  assert.ok(out.limitations.some(l=>l.includes(accountId)&&l.includes(target.region)));
  assert.doesNotMatch(JSON.stringify(out),/customer-trail|CUSTOMERKEY|BROKERKEY|fixture-session/);
  const trust=awsRoleTemplate(org,brokerArn).Resources.EvidenceRole.Properties;
  assert.equal(trust.AssumeRolePolicyDocument.Statement[0].Principal.AWS,brokerArn);
  assert.equal(trust.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals["sts:ExternalId"],awsBinding(org).externalId);
  assert.equal(trust.Policies[0].PolicyDocument.Statement[0].Action.length,4);
  assert.throws(()=>awsRoleTemplate(org,"*"));assert.notDeepEqual(awsBinding(randomUUID()),awsBinding(org));
});
test("absent or incorrect external ID accepted by AWS stops before any evidence read",async()=>{
  process.env.REGPILOT_AWS_BROKER_ROLE_ARN=brokerArn;
  for(const loose of ["missing","incorrect"] as const){
    const f=awsTransport(org,{loose});await assert.rejects(collectAws(target,org,f.runtime),fails("AWS_TRUST_UNSCOPED"));
    assert.ok(!f.calls.includes("GetCallerIdentity"));assert.ok(!f.calls.includes("DescribeTrails"));
  }
});
test("both role and AWS account must match and loss of workload identity fails closed",async()=>{
  process.env.REGPILOT_AWS_BROKER_ROLE_ARN=brokerArn;
  for(const opts of [{wrongAccount:true},{wrongRole:true}]){
    const f=awsTransport(org,opts);await assert.rejects(collectAws(target,org,f.runtime),fails("TARGET_MISMATCH"));assert.ok(!f.calls.includes("GetPublicAccessBlock"));
  }
  const f=awsTransport(org);
  await assert.rejects(collectAws(target,org,{...f.runtime,token:async()=>{throw Error("fixture");}}),fails("AWS_WORKLOAD_UNAVAILABLE"));assert.deepEqual(f.calls,[]);
});
test("AWS distinguishes denied reads, throttling and an explicitly absent public access block",async()=>{
  process.env.REGPILOT_AWS_BROKER_ROLE_ARN=brokerArn;
  const denied=await collectAws(target,org,awsTransport(org,{deny:true}).runtime);
  assert.deepEqual(new Set(denied.checks.map(c=>c.status)),new Set(["UNKNOWN"]));
  const absent=await collectAws(target,org,awsTransport(org,{absentBlock:true}).runtime);
  assert.equal(absent.checks.filter(c=>c.status==="FAIL").length,4);
  await assert.rejects(collectAws(target,org,awsTransport(org,{throttle:true}).runtime),fails("RATE_LIMITED"));
});
const selectors={EventSelectors:[{IncludeManagementEvents:true,ReadWriteType:"All" as const}]};
function trail(id:string,integrity=true){return {TrailARN:"arn:aws:cloudtrail:eu-west-2:"+accountId+":trail/"+id,HomeRegion:"eu-west-2",LogFileValidationEnabled:integrity};}
test("management reads, writes and log integrity require one active trail as a witness",async()=>{
  const a=trail("reads",false),b=trail("integrity");
  const reader:AwsEvidenceReader={publicBlock:async()=>null,trails:async()=>[a,b],status:async()=>({IsLogging:true,LatestDeliveryTime:new Date(Date.now()-60000),LatestDigestDeliveryTime:new Date(Date.now()-60000)}),
    selectors:async arn=>arn===a.TrailARN?selectors:{EventSelectors:[{IncludeManagementEvents:false,ReadWriteType:"All"}]}};
  const out=await awsPosture(target,reader);assert.deepEqual(out.checks.slice(4).map(c=>c.status),["PASS","PASS","PASS","FAIL","PASS","FAIL"]);
  const stopped=await awsPosture(target,{...reader,status:async()=>({IsLogging:false})});assert.ok(stopped.checks.slice(4).every(c=>c.status==="FAIL"));
  const missed=await awsPosture(target,{...reader,trails:async()=>Array.from({length:11},(_,i)=>trail("t"+i)),status:async()=>({IsLogging:false})});
  assert.ok(missed.checks.slice(4).every(c=>c.status==="UNKNOWN"));
  const empty=await awsPosture(target,{...reader,trails:async()=>[]});assert.ok(empty.checks.slice(4).every(c=>c.status==="FAIL"));
  const foreign={...a,TrailARN:a.TrailARN.replace(accountId,"999999999999")};
  let reads=0;await assert.rejects(awsPosture(target,{...reader,trails:async()=>[foreign],status:async()=>{reads++;return {IsLogging:true};}}),fails("TARGET_MISMATCH"));assert.equal(reads,0);
});
test("delivery evidence preserves stale and missing coverage and reports S3 delivery errors without storing provider details",async()=>{
  process.env.REGPILOT_AWS_BROKER_ROLE_ARN=brokerArn;
  for(const hours of [25,-2]){
    const out=await collectAws(target,org,awsTransport(org,{ageHours:hours}).runtime);
    assert.ok(out.checks.slice(-2).every(c=>c.status==="UNKNOWN"));
  }
  const out=await collectAws(target,org,awsTransport(org,{deliveryError:true}).runtime);
  assert.ok(out.checks.slice(-2).every(c=>c.status==="FAIL"));assert.doesNotMatch(JSON.stringify(out),/fixture-private-bucket/);
});
test("basic and advanced AWS selectors distinguish full, restricted and data-only coverage",()=>{
  const field=(Field:string,...Equals:string[])=>({Field,Equals});
  const m=field("eventCategory","Management"),ro=field("readOnly","true"),rw=field("readOnly","false");
  assert.equal(managementEvents({AdvancedEventSelectors:[{FieldSelectors:[m,ro]},{FieldSelectors:[m,rw]}]}),true);
  assert.equal(managementEvents({AdvancedEventSelectors:[{FieldSelectors:[m,ro]}]}),false);
  assert.equal(managementEvents({AdvancedEventSelectors:[{FieldSelectors:[m,field("eventSource","s3.amazonaws.com")]}]}),null);
  assert.equal(managementEvents({AdvancedEventSelectors:[{FieldSelectors:[field("eventCategory","Data")]}]}),false);
  assert.equal(managementEvents({EventSelectors:[{IncludeManagementEvents:true,ReadWriteType:"All",ExcludeManagementEventSources:["kms.amazonaws.com"]}]}),null);
  assert.equal(managementEvents({EventSelectors:[{IncludeManagementEvents:true,ReadWriteType:"WriteOnly"},{IncludeManagementEvents:true,ReadWriteType:"ReadOnly"}]}),true);
  assert.equal(managementEvents(null),null);
});
test("GLEIF discovery checks register, UK jurisdiction, exact leading zeros and pagination before offering matches",async()=>{
  assert.throws(()=>gleifTarget.parse({lei:lei.slice(0,-2)+"01",companyNumber:number}));
  const wrong=ukRecord();wrong.attributes.entity.jurisdiction="US";
  const other=ukRecord();other.attributes.entity.registeredAt.id="RA000587";
  const lostZeros=ukRecord();lostZeros.attributes.entity.registeredAs="14259";
  const find=await findGleifCompany(number,async url=>{
    assert.equal(new URL(String(url)).searchParams.get("filter[entity.registeredAs]"),number);
    return Response.json({data:[wrong,other,lostZeros,ukRecord()],meta:{pagination:{currentPage:1,total:28,lastPage:2}}});
  });
  assert.deepEqual(find,{candidates:[{name:"Fixture Bank",lei}],more:true});
  for (const [companyNumber,authority,jurisdiction] of [["SC045551","RA000587","GB-SCT"],["NI012345","RA000586","GB-NIR"]]){
    const row=ukRecord();Object.assign(row.attributes.entity,{registeredAs:companyNumber,registeredAt:{id:authority},jurisdiction});
    assert.equal((await collectGleif({lei,companyNumber},async()=>Response.json({data:row}))).checks[0].status,"PASS");
    row.attributes.entity.registeredAt.id="RA000585";await assert.rejects(collectGleif({lei,companyNumber},async()=>Response.json({data:row})),fails("TARGET_MISMATCH"));
  }
  const empty=await findGleifCompany(number,async()=>Response.json({data:[],meta:{pagination:{currentPage:1,total:0,lastPage:0}}}));
  assert.deepEqual(empty,{candidates:[],more:false});
});
test("GLEIF collection binds both identifiers, retains selected public fields and separates lapse from unknown evidence",async()=>{
  const row=ukRecord(),now=Date.parse("2026-06-01T00:00:00Z"),run=()=>collectGleif({lei,companyNumber:number},async()=>Response.json({data:row}),now);
  const first=await run();assert.equal(observationOutcome(first),"OBSERVED");assert.doesNotMatch(JSON.stringify(first),/private-address/);
  row.attributes.registration.nextRenewalDate="2026-05-01T00:00:00Z";assert.equal((await run()).checks[3].status,"FAIL");
  row.attributes.registration.nextRenewalDate="invalid";assert.equal((await run()).checks[3].status,"UNKNOWN");
  row.attributes.registration.status="LAPSED";assert.equal((await run()).checks[2].status,"FAIL");
  row.attributes.entity.jurisdiction="US";await assert.rejects(run(),fails("TARGET_MISMATCH"));
  await assert.rejects(collectGleif({lei,companyNumber:number},async()=>new Response(null,{status:404})),fails("REGISTER_RECORD_MISSING"));
});
