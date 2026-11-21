import {mkdir,writeFile} from "node:fs/promises";
import {collectGleif,findGleifCompany} from "../lib/connectors/gleif";
import {CollectionError} from "../lib/connectors/collection-error";
import {hashValue} from "../lib/regulatory/intelligence";

const targets=[
  {companyNumber:"00014259",lei:"MP6I5ZYZBEU3UXPYFY54"},
  {companyNumber:"SC045551",lei:"2138005O9XJIJN4JPN90"},
  {companyNumber:"02366777",lei:"2138001LSWETH5TDQG53"},
  {companyNumber:"NI003721",lei:"635400HGEXBSGYDUIP53"}
];
async function verify(target:typeof targets[number]){
  try{
    const [list,value]=await Promise.all([findGleifCompany(target.companyNumber),collectGleif(target)]);
    const match=list.candidates.find(candidate=>candidate.lei===target.lei);
    if(!match||value.checks.find(check=>check.id==="uk-entity-match")?.status!=="PASS")return {...target,state:"IDENTITY_UNCONFIRMED"};
    return {...target,state:"VERIFIED",registeredName:match.name,source:value.sourceUrl,assessedAt:value.capturedAt,
      indicators:value.checks.map(({id,status})=>({id,status})),observationHash:hashValue(value)};
  }catch(e){return {...target,state:"UNAVAILABLE",reason:e instanceof CollectionError?e.code:"COLLECTION_FAILED"};}
}
async function main(){
  const results=[];
  for(const target of targets)results.push(await verify(target));
  await mkdir("artifacts",{recursive:true});
  await writeFile("artifacts/gleif-supplier-contract.json",JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+"\n");
  for(const result of results)console.log(result.companyNumber,result.state);
  if(results.some(r=>r.state!=="VERIFIED"))process.exitCode=1;
}
void main().catch(()=>{console.error("Could not complete the live GLEIF supplier contract");process.exitCode=1;});
