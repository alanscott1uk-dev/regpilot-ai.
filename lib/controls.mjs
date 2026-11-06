import {isValidDate} from "./obligations.mjs";
import {reviewState} from "./document-review.mjs";
export const CONTROL_KEY="regpilot-demo-controls-v1";
export const CONTROL_STATUSES=Object.freeze(["Designed","In operation","Under review","Retired"]);
export const CONTROL_FREQUENCIES=Object.freeze(["Monthly","Quarterly","Six-monthly","Annual","Event-triggered"]);
const MAX=300;
const uniqIds=(input)=>Array.isArray(input)&&input.length<=100&&input.every(x=>typeof x==="string"&&x.length>0&&x.length<=80)&&new Set(input).size===input.length;
export function validControl(x){
 return !!x&&typeof x==="object"&&!Array.isArray(x)&&
 typeof x.id==="string"&&x.id.length>0&&x.id.length<=80&&
 typeof x.title==="string"&&x.title.trim().length>0&&x.title.length<=160&&
 typeof x.purpose==="string"&&x.purpose.length<=500&&
 typeof x.owner==="string"&&x.owner.trim().length>0&&x.owner.length<=80&&
 CONTROL_STATUSES.includes(x.status)&&CONTROL_FREQUENCIES.includes(x.frequency)&&
 typeof x.reviewDate==="string"&&(x.reviewDate===""||isValidDate(x.reviewDate))&&
 uniqIds(x.actionIds)&&uniqIds(x.documentIds);
}
export function parseControls(raw){
 if(typeof raw!=="string"||raw.length>500000)return [];
 try{const x=JSON.parse(raw);if(!Array.isArray(x))return [];const ids=new Set();return x.filter(c=>{
  if(!validControl(c)||ids.has(c.id))return false;
  ids.add(c.id);return true;
 }).slice(0,MAX)}catch{return []}
}
/** Self-recorded controls and attached document metadata only; no effectiveness or legal opinion. */
export function controlCoverage(controls,actions,documents,today){
 if(!isValidDate(today))throw new Error("Invalid date");
 const actionMap=new Map((Array.isArray(actions)?actions:[]).map(x=>[x.id,x]));
 const documentMap=new Map((Array.isArray(documents)?documents:[]).map(x=>[x.id,x]));
 return (Array.isArray(controls)?controls:[]).filter(validControl).map(c=>{
  const linkedActions=c.actionIds.map(id=>actionMap.get(id)).filter(Boolean);
  const linkedDocuments=c.documentIds.map(id=>documentMap.get(id)).filter(Boolean);
  const missingActionLinks=c.actionIds.length-linkedActions.length;
  const missingDocumentLinks=c.documentIds.length-linkedDocuments.length;
  const goodFiles=linkedDocuments.filter(d=>d.status==="Approved"&&d.hasAttachment===true&&["current","due-soon"].includes(reviewState(d,today)));
  const overdue=c.reviewDate!==""&&c.reviewDate<today&&c.status!=="Retired";
  const missingFiles=goodFiles.length===0&&c.status!=="Retired";
  const state=c.status==="Retired"?"retired":overdue?"review-overdue":missingActionLinks||missingDocumentLinks?"broken-links":missingFiles?"evidence-unconfirmed":c.status==="In operation"?"metadata-linked":"needs-review";
  const notes=[];
  if(overdue)notes.push("Control review date has passed");
  if(missingActionLinks||missingDocumentLinks)notes.push("Some linked records are no longer available");
  if(missingFiles)notes.push("No approved current file metadata is linked");
  if(c.actionIds.length===0)notes.push("No related work items selected");
  if(c.status!=="In operation"&&c.status!=="Retired")notes.push("Control not recorded as in operation");
  return {...c,linkedActions:linkedActions.length,linkedDocuments:linkedDocuments.length,approvedFileMetadata:goodFiles.length,missingActionLinks,missingDocumentLinks,state,notes};
 });
}
export function controlSummary(rows){
 return {total:rows.length,active:rows.filter(x=>x.status==="In operation").length,reviewOverdue:rows.filter(x=>x.state==="review-overdue").length,
  missingEvidence:rows.filter(x=>x.state==="evidence-unconfirmed"||x.state==="broken-links").length,metadataLinked:rows.filter(x=>x.state==="metadata-linked").length,retired:rows.filter(x=>x.state==="retired").length};
}
