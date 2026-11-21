import {z} from 'zod';
import type {AuditGrant,AuditRoom,Prisma} from '@prisma/client';
import {manifest,filesWithAvailability} from './audit-disclosure';
import {hashValue} from '../regulatory/intelligence';
import {IntelligenceError} from './intelligence-service';
import {sampleFindingInput as sampleInput} from '../auditor-policy';
type Tx=Prisma.TransactionClient;
const stored=sampleInput.extend({grantId:z.uuid(),manifestHash:z.string().length(64),fileHash:z.string().length(64),fileVersion:z.number(),controlId:z.uuid(),controlVersion:z.number(),controlHash:z.string().length(64),title:z.string(),scope:z.object({from:z.string(),to:z.string()})});
export async function recordSampleFinding(tx:Tx,room:AuditRoom,g:AuditGrant,userId:string,input:z.infer<typeof sampleInput>){
 const m=manifest(room),r=m.requests?.find(q=>q.id===input.requestId);
 if(!r||!r.fileIds.includes(input.evidenceId))throw new IntelligenceError('This file is outside the selected published sample',404);
 if(await tx.membership.findUnique({where:{organizationId_userId:{organizationId:room.organizationId,userId}}}))throw new IntelligenceError('An independent named guest must make the sample decision',403);
 const basis=await tx.auditRequest.findFirst({where:{id:r.id,roomId:room.id,organizationId:room.organizationId,status:'ACCEPTED'},include:{control:true}});
 const f=(await filesWithAvailability(tx,room.organizationId,m)).find(f=>f.id===input.evidenceId);
 if(!f?.available||!basis||basis.control.version!==r.controlVersion||hashValue(basis.controlSnapshot)!==basis.controlHash)throw new IntelligenceError('The sampled file or control revision changed',409);
 const details=stored.parse({...input,grantId:g.id,manifestHash:room.manifestHash,fileHash:f.sha256,fileVersion:f.reviewVersion,controlId:basis.controlId,controlVersion:r.controlVersion,controlHash:basis.controlHash,title:r.title,scope:r.coverage});
 const where={organizationId:room.organizationId,entityType:'AuditSampleFinding',entityId:room.id,actorId:userId,action:'audit.sample_decided'};
 const old=await tx.auditEvent.findUnique({where:{id:input.requestKey}});
 if(old){if(old.organizationId!==room.organizationId||old.actorId!==userId||old.action!==where.action||hashValue(old.details)!==hashValue(details))throw new IntelligenceError('Sample decision key is already in use',409);return {saved:true};}
 if(await tx.auditEvent.count({where})>=100)throw new IntelligenceError('The guest sample decision limit has been reached',429);
 await tx.auditEvent.create({data:{...where,id:input.requestKey,details}});return {saved:true};
}
export async function sampleFindings(tx:Tx,org:string,roomId:string,grantId?:string){
 const rows=await tx.auditEvent.findMany({where:{organizationId:org,entityType:'AuditSampleFinding',entityId:roomId,action:'audit.sample_decided',...(grantId?{details:{path:['grantId'],equals:grantId}}:{})},orderBy:{createdAt:'desc'},take:100});
 return rows.map(row=>{const d=stored.parse(row.details);return {id:row.id,requestId:d.requestId,decision:d.decision,notes:d.notes,title:d.title,scope:d.scope,fileHash:d.fileHash,fileVersion:d.fileVersion,controlVersion:d.controlVersion,manifestHash:d.manifestHash,recordedAt:row.createdAt.toISOString()};});
}
