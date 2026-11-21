import {z} from "zod";
import type {Prisma} from "@prisma/client";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError} from "./intelligence-service";
import {hashValue} from "../regulatory/intelligence";
import {downloadEvidence} from "./evidence-service";
import type {EvidenceObjectStore} from "./evidence-storage";
export const reviewedFileSchema=z.object({id:z.uuid(),filename:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),reviewVersion:z.number().int().positive(),contentType:z.string(),sizeBytes:z.number().int().positive(),uploadedById:z.uuid(),reviewerId:z.uuid()});
export const reviewedFilesSchema=z.array(reviewedFileSchema).max(10);
export type ReviewedFile=z.infer<typeof reviewedFileSchema>;
export async function reviewedFiles(tx:Prisma.TransactionClient,org:string,ids:string[]):Promise<ReviewedFile[]>{
 const rows=await tx.evidence.findMany({where:{organizationId:org,id:{in:ids}},orderBy:{id:"asc"}});
 if(rows.length!==ids.length||rows.some(r=>r.scanStatus!=="CLEAN"||r.reviewStatus!=="APPROVED"||!r.reviewedAt||!r.uploadedById||!r.reviewerId||r.uploadedById===r.reviewerId))throw new IntelligenceError("Select current, independently approved evidence from this organisation",409);
 return rows.map(r=>reviewedFileSchema.parse({id:r.id,filename:r.filename,sha256:r.sha256,reviewVersion:r.reviewVersion,contentType:r.contentType,sizeBytes:r.sizeBytes,uploadedById:r.uploadedById,reviewerId:r.reviewerId}));
}
export async function assertReviewedFiles(tx:Prisma.TransactionClient,org:string,files:ReviewedFile[]){
 const current=await reviewedFiles(tx,org,files.map(f=>f.id));
 if(hashValue(current)!==hashValue(files))throw new IntelligenceError("Evidence changed. Prepare a new version or review",409);
}
export async function verifyReviewedBytes(ctx:AuthorizedContext,files:ReviewedFile[],store?:EvidenceObjectStore){
 for(const f of files){const actual=await downloadEvidence(ctx,f.id,store);if(actual.sha256!==f.sha256)throw new IntelligenceError("Evidence changed during verification",409);}
}
export function futureDate(value:string,maxDays=366){
 const d=new Date(value+"T00:00:00.000Z"),today=new Date().toISOString().slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==value||value<today||d.getTime()>Date.now()+maxDays*86400000)throw new IntelligenceError("Choose today or a date within the next "+maxDays+" days");return d;
}
