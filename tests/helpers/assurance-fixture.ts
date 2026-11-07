import {randomUUID} from "node:crypto";
import {db} from "../../lib/server/db";
import type {AuthorizedContext} from "../../lib/server/authorization";
import {createEvidence,reviewEvidence} from "../../lib/server/evidence-service";
import type {EvidenceObjectStore} from "../../lib/server/evidence-storage";
import {fixturePdf} from "./pdf-fixture.mjs";
export const rejects=(status:number)=>(e:any)=>e.status===status;
export const future=(days=14)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
export async function assuranceFixture(){
 const suffix=randomUUID(),users=await Promise.all(["owner","admin","editor","staff","later","foreign","replacement"].map(n=>db.user.create({data:{email:n+suffix+"@example.invalid",externalId:randomUUID()}})));
 const [owner,admin,editor,staff,later,foreign,replacement]=users;
 const orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional assurance "+n+suffix}}))),[a,b]=orgs,orgIds=orgs.map(o=>o.id);
 process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(u=>u.email).join(",");
 const ctx=(u:typeof owner,role:AuthorizedContext["role"],organizationId=a.id):AuthorizedContext=>({organizationId,userId:u.id,role});
 const o=ctx(owner,"OWNER"),ad=ctx(admin,"ADMIN"),ed=ctx(editor,"EDITOR"),st=ctx(staff,"VIEWER"),la=ctx(later,"VIEWER"),out=ctx(foreign,"OWNER",b.id),re=ctx(replacement,"EDITOR");
 await db.membership.createMany({data:[o,ad,ed,st,la,out,re]});
 const objects=new Map<string,Uint8Array>(),store:EvidenceObjectStore={async put(k,v){objects.set(k,v);},async get(k){return objects.get(k)!;},async remove(k){objects.delete(k);}};
 const task=await db.obligation.create({data:{organizationId:a.id,title:"Fictional evidence collection",category:"Internal",ownerName:editor.email,dueDate:new Date()}});
 let sequence=0;
 async function file(approved=true){
  const e=await createEvidence(ed,task.id,"fictional-"+(++sequence)+".pdf",fixturePdf([["Fictional assurance document "+sequence+". No customer information."]]),{storage:store,scan:async()=>({status:"CLEAN" as const,engine:"fictional"})});
  if(approved)await reviewEvidence(ad,e.id,{decision:"APPROVED",version:1,notes:"Independently checked this fictional assurance document."},store);
  return e;
 }
 async function cleanup(){
  for(const model of [db.accessReviewItem,db.accessCampaign,db.accessInventory,db.assuranceQuestionnaire,db.assuranceAnswer,db.changeAction,db.changeResponse,db.auditQuestion,db.auditGrant,db.auditRequest,db.auditRoom,db.policyAssignment,db.policyRevision,db.policy,db.vendorReview,db.vendor,db.auditEvent,db.coverageDecision,db.coverageRun,db.libraryApplicability,db.libraryRevision,db.libraryRequirement,db.businessProfile,db.regulatorySnapshot,db.evidence,db.obligation,db.managedControl,db.programmeImport,db.membership] as any[])await model.deleteMany({where:{organizationId:{in:orgIds}}});
  await db.organization.deleteMany({where:{id:{in:orgIds}}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});await db.$disconnect();
 }
 return {users,owner,admin,editor,staff,later,foreign,replacement,a,b,o,ad,ed,st,la,out,re,store,file,cleanup};
}
