import type {Observation} from "./connectors/observation";
export function vendorAttention(v:{active:boolean;reviewState:string;recommendation:string|null;nextReviewAt:Date|string},today=new Date().toISOString().slice(0,10)){
 if(!v.active)return {needed:false,label:"Archived",next:"History retained"};
 if(v.reviewState==="NOT_REVIEWED")return {needed:true,label:"First review needed",next:"Gather evidence and prepare an independent review"};
 if(v.reviewState==="STALE"||v.reviewState==="EXPIRED")return {needed:true,label:"Review no longer current",next:"Refresh the supporting evidence and register observation, then obtain new sign-off"};
 if(v.recommendation==="REJECT")return {needed:true,label:"Rejected supplier",next:"Resolve the recorded next-step tasks and reassess the service"};
 if(v.recommendation==="CONDITIONAL")return {needed:true,label:"Conditions to resolve",next:"Complete the owned follow-up and obtain a new decision before treating conditions as cleared"};
 if(new Date(v.nextReviewAt).toISOString().slice(0,10)<=today)return {needed:true,label:"Review due",next:"Prepare the next supplier review"};
 return {needed:false,label:"Current review",next:"Continue scheduled monitoring"};
}
export function compareVendorSignals(current:Observation|null,reviewed:Observation|null){
 if(!current||!reviewed)return [];
 const before=new Map(reviewed.checks.map(c=>[c.id,c])),after=new Map(current.checks.map(c=>[c.id,c]));
 return [...new Set([...before.keys(),...after.keys()])].flatMap(id=>{const a=before.get(id),b=after.get(id);return a?.status===b?.status&&a?.observed===b?.observed?[]:[{id,label:b?.label||a!.label,before:a?`${a.status}: ${a.observed}`:"Not previously reported",after:b?`${b.status}: ${b.observed}`:"No longer reported"}];});
}
