import type {Prisma,OcrRun,OcrReview} from '@prisma/client';
import {z} from 'zod';
import {hashValue} from '../regulatory/intelligence';
import {OCR_LIMITS,ocrRawResultSchema,ocrReviewedResultSchema,reviewOcrText,ocrQuestionSourceSchema,ocrSourceForSelection,type OcrFormat} from '../ocr';
import {IntelligenceError,transaction} from './intelligence-service';
import {ADMIN,requireMember} from './workspace-member';
import {completionParticipants} from './work-completion-service';
import {evidenceHash} from '../evidence/file-guard.mjs';
import {privateEvidenceStore,type EvidenceObjectStore} from './evidence-storage';
import type {AuthorizedContext} from './authorization';

export function ocrRunIntegrity(run:OcrRun){
 const sourceMeta=z.object({version:z.literal('ocr-upload-v1'),width:z.number().int().min(50).max(10000).optional(),height:z.number().int().min(50).max(10000).optional()}).strict().safeParse(run.sourceMeta);
 const format=run.format as OcrFormat,contentType=format==='PDF'?'application/pdf':format==='PNG'?'image/png':'image/jpeg';
 if(!['PDF','PNG','JPEG'].includes(format)||run.contentType!==contentType||!sourceMeta.success||run.sizeBytes<1||run.sizeBytes>OCR_LIMITS.fileBytes||run.pageCount<1||run.pageCount>OCR_LIMITS.pages||format!=='PDF'&&run.pageCount!==1||!run.storageKey.startsWith(run.organizationId+'/')||!/^[a-f0-9-]{36}\.(pdf|png|jpg)$/.test(run.storageKey.slice(run.organizationId.length+1)))throw new IntelligenceError('OCR original metadata failed its integrity check',409);
 const descriptor={filename:run.filename,format,contentType,sha256:run.sha256,sizeBytes:run.sizeBytes,pageCount:run.pageCount,sourceMeta:sourceMeta.data};
 if(hashValue({...descriptor,createdById:run.createdById})!==run.requestHash)throw new IntelligenceError('OCR original metadata changed',409);
 return descriptor;
}
export function ocrRawIntegrity(run:OcrRun){
 ocrRunIntegrity(run);const parsed=ocrRawResultSchema.safeParse(run.rawResult);
 if(!parsed.success||hashValue(parsed.data)!==run.rawHash||parsed.data.pages.length!==run.pageCount)throw new IntelligenceError('OCR recognition provenance failed its integrity check',409);
 if(run.format!=='PDF'){
  const meta=run.sourceMeta as {width:number;height:number};
  if(parsed.data.pages[0].unit!=='pixel'||parsed.data.pages[0].width!==meta.width||parsed.data.pages[0].height!==meta.height)throw new IntelligenceError('OCR image dimensions do not match the original',409);
 }else if(parsed.data.pages.some(p=>p.unit!=='inch'))throw new IntelligenceError('OCR PDF page units are invalid',409);
 return parsed.data;
}
export function ocrReviewIntegrity(run:OcrRun,review:OcrReview){
 const raw=ocrRawIntegrity(run),parsed=ocrReviewedResultSchema.safeParse(review.result);
 if(review.organizationId!==run.organizationId||review.runId!==run.id||review.sourceHash!==run.sha256||review.rawHash!==run.rawHash||!parsed.success||hashValue(parsed.data)!==review.resultHash||hashValue({id:run.id,rawHash:run.rawHash,resultHash:review.resultHash,preparedById:review.preparedById})!==review.requestHash)throw new IntelligenceError('OCR transcription history failed its integrity check',409);
 let rebuilt;try{rebuilt=reviewOcrText(raw,parsed.data.pages.flatMap(p=>p.lines.map(l=>({id:l.id,text:l.text}))));}catch{throw new IntelligenceError('OCR transcription no longer matches its recognized source',409);}
 if(hashValue(rebuilt)!==review.resultHash)throw new IntelligenceError('OCR transcription or source offsets changed',409);return {raw,result:parsed.data};
}
export async function assertOcrPeople(tx:Prisma.TransactionClient,run:OcrRun,review?:OcrReview,reviewerId?:string){
 const ids=[run.createdById,run.startedById,...(review?[review.preparedById,review.reviewedById]:[]),reviewerId||null].filter((id):id is string=>!!id),people=await completionParticipants(tx,{organizationId:run.organizationId,userId:'',role:'ADMIN'},ids);
 if(ids.some(id=>!people.some(p=>p.id===id&&p.approved&&ADMIN.includes(p.role))))throw new IntelligenceError('OCR source author, operator or independent reviewer no longer has current company permission',409);
 const reviewer=reviewerId||review?.reviewedById;
 if(reviewer&&(reviewer===run.createdById||reviewer===review?.preparedById))throw new IntelligenceError('A different administrator from the uploader and transcription preparer must approve OCR text',403);
}
/** One bounded read serves every OCR passage and product response in a questionnaire. */
export async function assertQuestionnaireOcrSourcesCurrent(tx:Prisma.TransactionClient,organizationId:string,questions:readonly {source?:unknown}[]){
 const sources=questions.map(q=>q.source).filter((s):s is Record<string,unknown>=>!!s&&typeof s==='object'&&(s as {method?:string}).method==='OCR');
 if(!sources.length)return;
 if(sources.length>100)throw new IntelligenceError('OCR source selection exceeds the questionnaire limit',409);
 const parsed=sources.map(s=>{const p=ocrQuestionSourceSchema.safeParse(s);if(!p.success)throw new IntelligenceError('OCR source provenance is invalid',409);return p.data;}),ids=[...new Set(parsed.map(s=>s.ocrRunId))];
 if(ids.length>10)throw new IntelligenceError('A questionnaire can reference at most ten OCR originals',409);
 const runs=await tx.ocrRun.findMany({where:{organizationId,id:{in:ids}},include:{currentReview:true}}),map=new Map(runs.map(r=>[r.id,r]));
 const people=await completionParticipants(tx,{organizationId,userId:'',role:'ADMIN'},runs.flatMap(r=>[r.createdById,r.startedById,r.currentReview?.preparedById||null,r.currentReview?.reviewedById||null]));
 const checked=new Map<string,{run:OcrRun;review:OcrReview;raw:ReturnType<typeof ocrRawIntegrity>;result:ReturnType<typeof ocrReviewIntegrity>['result']}>();
 for(const source of parsed){
  let current=checked.get(source.ocrRunId);
  if(!current){const run=map.get(source.ocrRunId),review=run?.currentReview;if(!run||run.status!=='REVIEWED'||!review||review.status!=='APPROVED'||!review.reviewedById||!review.approvedAt||review.reviewedById===run.createdById||review.reviewedById===review.preparedById)throw new IntelligenceError('OCR question source is withdrawn, changed or awaiting independent review',409);
   const ids=[run.createdById,run.startedById,review.preparedById,review.reviewedById];if(ids.some(id=>!id||!people.some(p=>p.id===id&&p.approved&&ADMIN.includes(p.role))))throw new IntelligenceError('OCR source review permissions are no longer current',409);
   current={run,review,...ocrReviewIntegrity(run,review)};checked.set(run.id,current);
  }
  if(current.review.id!==source.ocrReviewId||current.review.resultHash!==source.ocrReviewHash)throw new IntelligenceError('OCR transcription changed after this questionnaire was imported; import the reviewed revision',409);
  let expected;try{expected=ocrSourceForSelection({...current.run,format:current.run.format as OcrFormat,rawHash:current.run.rawHash!},{...current.review,result:current.result},current.raw,{unit:source.unit,start:source.start,end:source.end});}catch{throw new IntelligenceError('OCR question source no longer matches its reviewed page',409);}
  if(hashValue(expected)!==hashValue(source))throw new IntelligenceError('OCR question provenance changed',409);
 }
}
/** Approval and exports verify current private original bytes outside the database transaction. */
export async function verifyQuestionnaireOcrOriginals(c:AuthorizedContext,questions:readonly {source?:unknown}[],storage?:EvidenceObjectStore){
 const sources=questions.map(q=>q.source).filter((s):s is Record<string,unknown>=>!!s&&typeof s==='object'&&(s as {method?:string}).method==='OCR');if(!sources.length)return;
 const ids=[...new Set(sources.map(s=>ocrQuestionSourceSchema.parse(s).ocrRunId))];
 const pre=await transaction(c,async tx=>{await requireMember(tx,c,ADMIN);await assertQuestionnaireOcrSourcesCurrent(tx,c.organizationId,questions);return tx.ocrRun.findMany({where:{organizationId:c.organizationId,id:{in:ids}},orderBy:{id:'asc'}});});
 const store=storage||await privateEvidenceStore();for(const file of pre){const bytes=await store.get(file.storageKey);if(bytes.byteLength!==file.sizeBytes||evidenceHash(bytes)!==file.sha256)throw new IntelligenceError('An OCR question original failed byte integrity verification',409);}
 await transaction(c,async tx=>{await requireMember(tx,c,ADMIN);await assertQuestionnaireOcrSourcesCurrent(tx,c.organizationId,questions);const current=await tx.ocrRun.findMany({where:{organizationId:c.organizationId,id:{in:ids}},orderBy:{id:'asc'}});if(hashValue(current.map(r=>[r.id,r.version,r.requestHash,r.currentReviewId]))!==hashValue(pre.map(r=>[r.id,r.version,r.requestHash,r.currentReviewId])))throw new IntelligenceError('An OCR question source changed during original retrieval',409);});
}
