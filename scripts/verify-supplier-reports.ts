import {mkdir,writeFile} from "node:fs/promises";
import {collectScorecard} from "../lib/connectors/scorecard";
import {CollectionError} from "../lib/connectors/collection-error";
import {hashValue} from "../lib/regulatory/intelligence";

// Public contract check. The tested controls are allowed to have genuine exceptions.
async function verify(repository:string) {
  try {
    const latest=await collectScorecard({repository});
    const revision=new URL(latest.sourceUrl).searchParams.get("commit");
    if(!revision)return {repository,state:"NO_PUBLIC_REPORT"};
    const pinned=await collectScorecard({repository,deployedCommit:revision});
    const exact=pinned.checks.find(check=>check.id==="scorecard-deployed-revision");
    if(exact?.status!=="PASS")return {repository,state:"REVISION_UNAVAILABLE"};
    return {repository,state:"VERIFIED",source:pinned.sourceUrl,publication:pinned.checks.find(check=>check.id==="scorecard-freshness"),
      outcomes:pinned.checks.map(({id,status})=>({id,status})),observationHash:hashValue(pinned)};
  } catch(error) {
    return {repository,state:"UNAVAILABLE",reason:error instanceof CollectionError?error.code:"COLLECTION_FAILED"};
  }
}

async function main(){
  const results=await Promise.all(["alphagov/govuk-frontend","ossf/scorecard"].map(verify));
  await mkdir("artifacts",{recursive:true});
  await writeFile("artifacts/supplier-connector-contract.json",JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+"\n");
  for(const result of results)console.log(result.repository,result.state);
  if(results.some(result=>result.state!=="VERIFIED"))process.exitCode=1;
}
void main().catch(()=>{console.error("Could not complete the public supplier contract check");process.exitCode=1;});
