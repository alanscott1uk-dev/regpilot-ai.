import type {Prisma} from "@prisma/client";
import {allowedEmail} from "../ai/security.mjs";
import {manifestSchema,evidenceStillShareable,type AuditManifest} from "../auditor-policy";
import {hashValue} from "../regulatory/intelligence";
import {approvedDisclosure} from "./customer-assurance-service";
import {workspaceConfigured} from "./ai-auth";
import {IntelligenceError} from "./intelligence-service";
import {ADMIN} from "./workspace-member";

type Tx=Prisma.TransactionClient;
export const auditApiConfigured=()=>workspaceConfigured()&&process.env.REGPILOT_AUDITOR_API_ENABLED==="true";
export const clearedAuditKey={apiKeyHash:null,apiIssuerId:null,apiExpiresAt:null};
export async function event(tx:Tx,organizationId:string,userId:string,action:string,id:string,details:Prisma.InputJsonValue={}){
 await tx.auditEvent.create({data:{organizationId,actorId:userId,action:"auditor."+action,entityType:"AuditRoom",entityId:id,details}});
}
export async function issuerActive(tx:Tx,room:{organizationId:string;createdById:string}){
 const m=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:room.organizationId,userId:room.createdById}},select:{role:true,user:{select:{email:true}}}});
 return !!m&&ADMIN.includes(m.role)&&allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS);
}
export function manifest(room:{manifest:unknown;manifestHash:string}):AuditManifest{
 const m=manifestSchema.parse(room.manifest);if(hashValue(m)!==room.manifestHash)throw new IntelligenceError("Shared record integrity check failed",409);return m;
}
export async function currentAssurance(tx:Tx,room:{organizationId:string;manifest:unknown;manifestHash:string}){
 const a=manifest(room).assurance;if(!a)return;
 const s=await approvedDisclosure(tx,room.organizationId,a.questionnaireId);
 if(s.row.version!==a.questionnaireVersion||s.row.approvedHash!==a.approvedHash||hashValue({title:s.disclosure.title,scope:s.disclosure.scope,questions:s.disclosure.questions})!==hashValue({title:a.title,scope:a.scope,questions:a.questions}))throw new IntelligenceError("Shared assurance answers changed; prepare a new reviewed share",409);
}
export async function filesWithAvailability(tx:Tx,orgId:string,m:AuditManifest){
 const rows=await tx.evidence.findMany({where:{organizationId:orgId,id:{in:m.files.map(f=>f.id)}}});
 return m.files.map(f=>({...f,available:evidenceStillShareable(f,rows.find(r=>r.id===f.id),orgId)}));
}
export function activeRoom(room:{status:string;expiresAt:Date}){return room.status==="PUBLISHED"&&room.expiresAt>new Date();}
