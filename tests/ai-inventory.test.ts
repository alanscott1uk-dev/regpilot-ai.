import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {assessUse, actionSchema, type UseProfile} from "../lib/ai-inventory";
import {discoverModels} from "../lib/server/ai-inventory-bom";
import {GET, POST} from "../app/api/workspace/ai-inventory/route";

const serial = "urn:uuid:" + randomUUID();
const model = {type:"machine-learning-model", "bom-ref":"model-a", name:"Example model", version:"1"};
const bom = {bomFormat:"CycloneDX", specVersion:"1.6", serialNumber:serial, version:1};
const profile: UseProfile = {dataClass:"PUBLIC",access:"READ",impact:"INTERNAL",purpose:"Read public product manuals.",safeguards:"An editor checks the resulting draft."};

test("risk triage explains the declared use and leaves undisclosed use unassessed",()=>{
  assert.equal(assessUse(null).priority,"Unassessed");
  assert.equal(assessUse(profile).priority,"Routine");
  assert.equal(assessUse({...profile,dataClass:"PERSONAL"}).priority,"Elevated");
  assert.equal(assessUse({...profile,access:"AUTONOMOUS",impact:"HEALTH"}).reasons.length,2);
  assert.equal(assessUse({...profile,dataClass:"SENSITIVE"}).priority,"High");
  assert.equal(actionSchema.safeParse({action:"CREATE",kind:"AGENT",name:"Agent",ownerId:randomUUID(),requestKey:randomUUID(),profile:{...profile,purpose:""},controlId:null,vendorId:null}).success,false);
});

test("CycloneDX includes the metadata component and nested models and ignores ordinary applications",()=>{
  const result = discoverModels({...bom,metadata:{component:{...model,"bom-ref":"root"}},components:[{name:"Suite",type:"application",components:[model]}]});
  assert.equal(result.inspected,3);
  assert.deepEqual(result.models.map(c=>c.reference),["root","model-a"]);
  assert.deepEqual(discoverModels({...bom,specVersion:"1.7",components:[]}).models,[]);
  const reordered = {version:"1",name:"Example model","bom-ref":"model-a",type:"machine-learning-model"};
  assert.equal(discoverModels({...bom,components:[model]}).manifestHash,discoverModels({...bom,components:[reordered]}).manifestHash);
  assert.notEqual(discoverModels({...bom,components:[model]}).manifestHash,discoverModels({...bom,components:[{...model,modelCard:{limitations:"A changed limitation."}}]}).manifestHash);
});

test("ambiguous, unsupported and oversized bill-of-material inputs fail as a whole",()=>{
  for (const input of [
    {...bom,serialNumber:"incorrect"}, {...bom,specVersion:"1.5"}, {...bom,components:[model,{...model,type:"library"}]},
    {...bom,components:[{...model,"bom-ref":undefined}]}, {...bom,components:[model,{components:[]}]},
    {...bom,components:Array.from({length:2001},()=>({type:"library",name:"Component"}))},
    {...bom,components:Array.from({length:101},(_,i)=>({...model,"bom-ref":"m"+i}))},
  ]) assert.throws(()=>discoverModels(input));
});

test("private inventory endpoints use the existing activation and session boundary",async()=>{
  const org=randomUUID(), url="https://example.invalid/api/workspace/ai-inventory?organizationId="+org;
  for (const res of [await GET(new Request(url)),await POST(new Request(url,{method:"POST",body:"{}"}))]) {
    assert.ok([401,403,503].includes(res.status));
    assert.equal(res.headers.get("Cache-Control"),"no-store");
    assert.equal("systems" in await res.json(),false);
  }
});
