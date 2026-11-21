import type {ConnectorHealthItem} from "./connectors/health-dashboard.mjs";
import {normalisePublicationText} from "./regulatory/publication-query.mjs";
import {inferSopStarter} from "./sop-draft";

const topics:Record<string,string>={
  WORKFORCE_LEAVER:"leaver leavers offboarding off-boarding staff termination account removal employee access bamboohr microsoft entra jira ticket",
  AWS_ORGANIZATIONS:"aws organization organisation cloudtrail cloud inventory s3 accounts",AWS:"aws cloudtrail storage s3 logging infrastructure",
  GLEIF:"supplier legal identity lei companies house",COMPANIES_HOUSE:"supplier legal identity companies house",
  OKTA:"okta workforce access identity",MICROSOFT365:"microsoft entra access identity",INTUNE:"intune endpoint device"
};
export function scopeWords(value:string){
  return value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ")||"";
}
export function matchesNamedScope(text:string,scope:string){
  const expected=scopeWords(scope);
  return !scope.trim()||Boolean(expected&&(" "+scopeWords(text)+" ").includes(" "+expected+" "));
}
export function relevantConnections(question:string,asset:string,connections:ConnectorHealthItem[]){
  const query=normalisePublicationText(question);
  const words=[...new Set(scopeWords(query).split(" "))].filter(w=>w.length>2&&!/^(the|can|and|for|show|our|does|current|with|what|which|has|have|evidence|control|please)$/.test(w));
  const issue=question.match(/\b([a-z][a-z0-9_]{1,19}-[1-9]\d{0,10})\b/i)?.[1]?.toUpperCase();
  const employee=question.match(/\b(?:employee|leaver)\s*(?:id\s*)?[#:]?\s*(\d+)\b/i)?.[1];
  const directoryId=question.match(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i)?.[0]?.toLowerCase();
  return connections.flatMap(c=>{
    const text=[c.target,c.provider,topics[c.provider]||"",...c.controls.map(v=>v.title)].join(" ");
    if(!matchesNamedScope(text+" "+(c.scope?.branch||""),asset))return [];
    if(c.provider==="WORKFORCE_LEAVER"){
      const parts=c.scope?.repository.split(":"),objectId=c.scope?.branch.split(":")[2];
      if((issue&&parts?.[4]!==issue)||(employee&&parts?.[2]!==employee)||(directoryId&&objectId!==directoryId))return [];
      if(issue||employee||directoryId)return [{c,score:words.length+1}];
    }
    const tokens=new Set(scopeWords(text).split(" ")),score=words.filter(w=>tokens.has(w)).length;
    return score?[{c,score}]:[];
  }).sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id)).slice(0,5).map(v=>v.c);
}
export function operatorQuestions(question:string,asset:string,hasProcedure:boolean,hasEvidence:boolean,connections:ConnectorHealthItem[]){
  const starter=inferSopStarter(question),items:string[]=[];
  if(starter==="mapping"&&!asset)items.push("Which storage area, site or equipment ID should the mapping evidence cover?");
  if(starter==="food"&&!asset)items.push("Which product or production line does this allergen handover concern?");
  if(starter==="leaver"&&connections.filter(c=>c.provider==="WORKFORCE_LEAVER").length!==1)items.push("Which employee ID or Jira issue should be checked against the directory?");
  if(normalisePublicationText(question).trim()==="sop")items.push("Which activity and site should the procedure cover?");
  if((starter==="mapping"||starter==="food")&&asset&&!hasEvidence)items.push("A reviewed site record is needed to confirm what happened at "+asset+".");
  if(!hasProcedure&&starter!=="general")items.push("A current approved procedure for this scope could not be established.");
  return items;
}
export function researchHandoff(question:string,organizationId=""){
  const search=organizationId?"?"+new URLSearchParams({organizationId}):"";
  return "/team/knowledge"+search+"#workspace-research?"+new URLSearchParams({q:question.trim().slice(0,1200)});
}
