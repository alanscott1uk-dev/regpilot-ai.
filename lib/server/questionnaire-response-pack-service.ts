import {verifyQuestionnaireOcrOriginals} from './ocr-currentness';
import {completeOriginalWord} from './questionnaire-original-word';
import {Prisma} from '@prisma/client';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN} from './workspace-member';
import {approvedDisclosure} from './customer-assurance-service';
import {downloadEvidence} from './evidence-service';
import {verifyReviewedBytes} from './reviewed-files';
import {writeQuestionnaireCsv,writeQuestionnaireXlsx,writeOriginalSpreadsheet} from './questionnaire-workbook.mjs';
import {RESPONSE_PACK_LIMITS,responsePackEvidenceSize,responsePackFiles,responsePackHash,writeResponsePackZip} from '../questionnaire-response-pack';
import type {AuthorizedContext} from './authorization';
import type {EvidenceObjectStore} from './evidence-storage';

async function current(c:AuthorizedContext,id:string){return transaction(c,async tx=>{await requireMember(tx,c,ADMIN);return approvedDisclosure(tx,c.organizationId,id);});}
async function finish(c:AuthorizedContext,id:string,pre:Awaited<ReturnType<typeof current>>,action:string,details:Prisma.InputJsonValue){
 return transaction(c,async tx=>{await requireMember(tx,c,ADMIN);const post=await approvedDisclosure(tx,c.organizationId,id);if(post.row.version!==pre.row.version||post.contextHash!==pre.contextHash||post.row.approvedHash!==pre.row.approvedHash)throw new IntelligenceError('Disclosure changed during export; refresh and review the current disclosure',409);await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType:'CustomerAssurance',entityId:id,action:'customer_assurance.'+action,details}});});
}
export async function exportQuestionnaireResponsePack(c:AuthorizedContext,id:string,store?:EvidenceObjectStore){
 const pre=await current(c,id);
 await verifyQuestionnaireOcrOriginals(c,pre.questions,store);
 let uniqueBytes:number;try{uniqueBytes=responsePackEvidenceSize(pre.files);}catch{throw new IntelligenceError('Reviewed evidence metadata is inconsistent',409);}
 if(pre.files.length>RESPONSE_PACK_LIMITS.files||uniqueBytes>RESPONSE_PACK_LIMITS.evidenceBytes)throw new IntelligenceError('This response pack exceeds 50 evidence records or 30 MiB of distinct originals. Export the response workbook and review the disclosure file selection.',413);
 const downloaded=[],originals=new Map<string,Uint8Array>();
 for(const file of pre.files){const stored=await downloadEvidence(c,file.id,store);if(stored.sha256!==file.sha256||stored.bytes.byteLength!==file.sizeBytes||responsePackHash(stored.bytes)!==file.sha256)throw new IntelligenceError('Reviewed evidence changed during response export',409);if(!originals.has(file.sha256))originals.set(file.sha256,stored.bytes);downloaded.push({...file,bytes:originals.get(file.sha256)!});}
 const files=responsePackFiles(downloaded),value={...pre.disclosure,approvedHash:pre.row.approvedHash,approvedAt:pre.row.approvedAt};
 const responses=[{name:'responses.csv',bytes:Buffer.from(writeQuestionnaireCsv(value),'utf8')},{name:'responses.xlsx',bytes:writeQuestionnaireXlsx(value)}];
 const manifest={format:'regpilot-questionnaire-response-pack-v1',title:pre.row.title,recipient:pre.row.recipient,scope:pre.row.scope,approvedDisclosureHash:pre.row.approvedHash,approvedAt:pre.row.approvedAt?.toISOString(),instructions:'Responses contain the independently approved disclosure. Source quotations identify customer inputs; OCR review verifies transcription only. Imported responses remain unapproved input. Evidence applies only to the question and product mappings listed here. SHA-256 verifies the bytes included in this archive.',responses:responses.map(file=>({filename:file.name,sha256:responsePackHash(file.bytes),sizeBytes:file.bytes.byteLength})),files:files.entries.map(file=>({filename:file.name,sha256:file.sha256,sizeBytes:file.sizeBytes,originalFilenames:[...new Set(pre.files.filter(record=>record.sha256===file.sha256).map(record=>record.filename))]})),questions:pre.questions.map((q,index)=>({reference:q.reference,question:q.question,...(pre.disclosure.questions[index].product?{product:pre.disclosure.questions[index].product}:{}),...(q.source?{source:q.source}:{}),evidence:q.files.map(file=>({filename:file.filename,sha256:file.sha256,archiveEntry:files.byEvidence.get(file.id)}))}))};
 const entries=[{name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2),'utf8')},...responses,...files.entries];
 if(22+entries.reduce((total,file)=>total+file.bytes.byteLength+76+2*Buffer.byteLength(file.name),0)>RESPONSE_PACK_LIMITS.archiveBytes)throw new IntelligenceError('The completed response pack exceeds 32 MiB',413);
 const bytes=writeResponsePackZip(entries);await finish(c,id,pre,'response_pack_exported',{approvedHash:pre.row.approvedHash,archiveHash:responsePackHash(bytes),evidenceRecords:pre.files.length,evidenceFiles:files.entries.length});return bytes;
}
export async function exportQuestionnaireOriginal(c:AuthorizedContext,id:string,input:{bytes:Uint8Array;filename:string;mappings:unknown;expectedVersion:number},store?:EvidenceObjectStore){
 const pre=await current(c,id);
 if(!Number.isInteger(input.expectedVersion)||input.expectedVersion!==pre.row.version)
   throw new IntelligenceError('Questionnaire changed. Refresh before exporting the original.',409);
 const format=input.filename.split('.').at(-1)?.toLowerCase();
 if(!format||!['csv','xlsx','docx'].includes(format))throw new IntelligenceError('Choose an original CSV, XLSX or DOCX.',415);
 if(format==='docx'&&(!Array.isArray(input.mappings)||input.mappings.length))
   throw new IntelligenceError('Word uses the reviewed question locations. Column mappings are unsupported.',400);
 const bytes=format==='docx'
   ?await completeOriginalWord(input.bytes,input.filename,pre.disclosure.questions)
   :await writeOriginalSpreadsheet(input.bytes,input.filename,pre.disclosure,input.mappings);
 await verifyReviewedBytes(c,pre.files,store);
 await verifyQuestionnaireOcrOriginals(c,pre.questions,store);
 const action=format==='xlsx'?'original_workbook_exported':'original_'+format+'_exported';
 await finish(c,id,pre,action,{approvedHash:pre.row.approvedHash,sourceHash:responsePackHash(input.bytes),exportHash:responsePackHash(bytes),mappings:input.mappings as Prisma.InputJsonValue});
 return bytes;
}
