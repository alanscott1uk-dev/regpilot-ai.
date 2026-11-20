import {createHash} from 'node:crypto';
import {documentSelectionsSchema,DOCUMENT_QUESTION_LIMITS,type DocumentQuestionCandidate,type DocumentQuestionnaireInspection} from '../questionnaire-intake';
import {extractDocument} from './document-extraction';
import {extractionBlocked} from '../documents/coverage';
import {QUESTIONNAIRE_FILE_LIMITS,QuestionnaireWorkbookError} from './questionnaire-workbook.mjs';

const sourceReference=(kind:'page'|'block',unit:number,start:number)=>`${kind==='page'?'P':'B'}${unit}-${start+1}`;
function questionWording(quote:string){return quote.replace(/^\s*(?:Q(?:uestion)?\s*)?\d+(?:\.\d+)*[.):\-]?\s+/i,'').trim();}
/** Suggestions are text locations for human selection, never accepted questions or answers. */
export function documentQuestionCandidates(units:DocumentQuestionnaireInspection['units'],unitKind:'page'|'block'){
 const candidates:DocumentQuestionCandidate[]=[];let candidateLimitReached=false;
 for(const unit of units){
  const segments=unit.text.matchAll(/[^\r\n]+/g);
  for(const segment of segments){
   const trimmed=segment[0].trim();if(trimmed.length<10||trimmed.length>1200)continue;
   if(!/[?？]/u.test(trimmed)&&!/^\s*(?:(?:Q(?:uestion)?\s*)?\d+(?:\.\d+)*[.):\-]?\s+)?(?:how|what|when|where|who|why|which|do|does|is|are|can|will|please|describe|explain|provide|confirm|list|detail|specify)\b/i.test(trimmed))continue;
   if(candidates.length>=DOCUMENT_QUESTION_LIMITS.candidates){candidateLimitReached=true;continue;}
   const start=segment.index!+segment[0].indexOf(trimmed),end=start+trimmed.length,question=questionWording(trimmed);
   if(question.length<10)continue;
   candidates.push({id:`${unit.unit}:${start}:${end}`,unit:unit.unit,start,end,reference:sourceReference(unitKind,unit.unit,start),question,quote:trimmed,label:unit.label});
  }
 }
 return {candidates,candidateLimitReached};
}
export async function inspectQuestionnaireDocument(input:Uint8Array,filename:string):Promise<DocumentQuestionnaireInspection>{
 if(typeof filename!=='string'||!filename.trim()||filename.length>180||/[\/\\\u0000-\u001f]/u.test(filename)||! /\.(pdf|docx)$/i.test(filename))throw new QuestionnaireWorkbookError('Choose a text-based PDF or standard DOCX document.',415);
 if(!input.byteLength||input.byteLength>QUESTIONNAIRE_FILE_LIMITS.fileBytes)throw new QuestionnaireWorkbookError('Upload a questionnaire document between 1 byte and 3 MiB.',413);
 const extracted=await extractDocument(input,filename,{allowEmpty:true}),format=/\.pdf$/i.test(filename)?'PDF':'DOCX',unitKind=format==='PDF'?'page':'block';
 const units=extracted.pages.map(page=>({unit:page.page,label:page.label||(unitKind==='page'?'Page ':'Word block ')+page.page,text:page.text}));
 const blockingIssues=[...(extracted.blockingIssues||[]),...(extracted.truncated?['The document exceeds extraction limits. Use a smaller, complete copy.']:[]),...(extracted.skippedPages.length?['Some pages have no readable text. Supply a complete text-based copy; OCR is not enabled.']:[]),...(!extracted.characters?['No readable text was found. Supply a text-based copy; OCR is not enabled.']:[])];
 const canImport=!!extracted.characters&&!extractionBlocked(extracted),found=documentQuestionCandidates(units,unitKind);
 return {version:'questionnaire-document-v1',filename:filename.trim(),format,sha256:createHash('sha256').update(input).digest('hex'),extractionVersion:extracted.version,unitKind,units,...found,canImport,blockingIssues:[...new Set(blockingIssues)],warnings:[...(extracted.warnings||[]),'Check every selected question against the original document. Layout, headings and nearby instructions may change its meaning.',...(found.candidateLimitReached?['Only the first 500 suggestions are shown. You can select another exact passage from the source text.']:[])]};
}
/** Re-extract on import and derive all source metadata here. Caller text cannot forge provenance. */
export function mapQuestionnaireDocument(document:DocumentQuestionnaireInspection,input:unknown){
 if(!document.canImport||document.blockingIssues.length)throw new QuestionnaireWorkbookError('This document cannot be imported completely. Resolve the extraction issues or use a text-based copy.');
 const rows=documentSelectionsSchema.parse(input);
 return rows.map(row=>{
  const unit=document.units.find(unit=>unit.unit===row.unit),quote=unit?.text.slice(row.start,row.end);
  if(!unit||row.end>unit.text.length||!quote||quote.trim().length<10||quote.length>DOCUMENT_QUESTION_LIMITS.sourceCharacters||!quote.isWellFormed())throw new QuestionnaireWorkbookError('A selected question no longer matches its original source passage. Inspect the document again.',409);
  return {reference:row.reference,question:row.question,instructions:row.instructions||'',suppliedAnswer:'',source:{filename:document.filename,sha256:document.sha256,format:document.format,unitKind:document.unitKind,unit:row.unit,start:row.start,end:row.end,quote,extractionVersion:document.extractionVersion,unitLabel:unit.label}};
 });
}
