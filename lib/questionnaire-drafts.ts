import {z} from "zod";
import {hashValue} from "./regulatory/intelligence";
import {findEvidencePassages,type EvidenceDocument} from "./evidence/assurance";
import {extractionBlocked} from "./documents/coverage";

export const QUESTIONNAIRE_DRAFT_ENGINE="questionnaire-draft-1.0.0";
export const QUESTIONNAIRE_DRAFT_LIMITS={files:3,daily:20,attempts:3,history:100,characters:90000,modelTimeoutMs:45000,processingTimeoutMs:120000} as const;
export const prepareQuestionnaireDraftInput=z.object({questionId:z.uuid(),questionnaireVersion:z.number().int().positive(),evidenceIds:z.array(z.uuid()).min(1).max(3).refine(ids=>new Set(ids).size===ids.length),method:z.enum(["CONTENT_SEARCH","AI"]),requestKey:z.uuid(),retryOfId:z.uuid().optional(),confirm:z.literal(true)}).strict();
export const saveQuestionnaireDraftInput=z.object({action:z.literal("SAVE_ANSWER"),version:z.number().int().positive(),answer:z.string().trim().min(40).max(6000),validUntil:z.iso.date(),reviewedSupport:z.literal(true),confirm:z.literal(true)}).strict();
const modelCitation=z.object({evidenceId:z.uuid(),unit:z.number().int().min(1).max(500),quote:z.string().min(12).max(1200)}).strict();
export const questionnaireModelSchema=z.object({paragraphs:z.array(z.object({text:z.string().trim().min(20).max(1400),citations:z.array(modelCitation).min(1).max(4)}).strict()).max(4),gaps:z.array(z.string().min(8).max(400)).max(8),limitations:z.array(z.string().min(8).max(400)).max(8)}).strict();
export const draftCitationSchema=z.object({key:z.string().regex(/^[a-f0-9]{64}$/),evidenceId:z.uuid(),filename:z.string().max(300),unit:z.number().int().positive(),unitKind:z.enum(["page","block"]),quote:z.string().min(12).max(1800),start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict();
export const questionnaireDraftResultSchema=z.object({answer:z.string().max(6000),status:z.enum(["DRAFT","INSUFFICIENT_SUPPORT"]),citations:z.array(draftCitationSchema).max(16),gaps:z.array(z.string().max(500)).max(16),warnings:z.array(z.string().max(1000)).max(30),rejectedParagraphs:z.number().int().nonnegative()}).strict();
export type QuestionnaireDraftResult=z.infer<typeof questionnaireDraftResultSchema>;
export type DraftCitation=z.infer<typeof draftCitationSchema>;
const baseWarnings=["Inspect the original documents: text extraction cannot verify authenticity, signatures, images, reading order or implementation.","Exact quotations establish traceability. They do not establish that a proposed answer is correct, complete or applicable to this customer."];
export function assertDraftDocuments(documents:EvidenceDocument[]){
 if(documents.length<1||documents.length>3||documents.some(d=>extractionBlocked(d.document)))throw new Error("Selected documents have incomplete or unsupported extraction. Use complete readable evidence.");
 if(documents.reduce((n,d)=>n+d.document.pages.reduce((p,u)=>p+u.text.length,0),0)>QUESTIONNAIRE_DRAFT_LIMITS.characters)throw new Error("Selected document text exceeds the bounded drafting allowance. Choose fewer or shorter documents.");
}
export function searchedQuestionnaireDraft(query:string,documents:EvidenceDocument[]):QuestionnaireDraftResult{
 assertDraftDocuments(documents);
 const citations=findEvidencePassages(query,documents).slice(0,12).map(p=>({key:p.key,evidenceId:p.evidenceId,filename:documents.find(d=>d.id===p.evidenceId)!.filename,unit:p.page,unitKind:p.unitKind||"page" as const,quote:p.quote,start:p.start,end:p.end}));
 return questionnaireDraftResultSchema.parse({answer:"",status:"INSUFFICIENT_SUPPORT",citations,gaps:[citations.length?"Related passages were located by word overlap. Compose a response only after checking their meaning, scope, dates and all parts of the question.":"No related passage was located in the selected text. This does not prove the business lacks the control."],warnings:[...baseWarnings,"Content search locates passages; it does not generate an answer or assess whether the question is satisfied.",...documents.flatMap(d=>d.document.warnings||[])].slice(0,30),rejectedParagraphs:0});
}
/** Every retained paragraph has exact, unique anchors in the supplied private bytes. Human review still determines entailment. */
export function groundedQuestionnaireDraft(raw:unknown,documents:EvidenceDocument[]):QuestionnaireDraftResult{
 assertDraftDocuments(documents);
 const parsed=questionnaireModelSchema.parse(raw),paragraphs:string[]=[],citations:DraftCitation[]=[],gaps=[...parsed.gaps];let rejectedParagraphs=0;
 for(const paragraph of parsed.paragraphs){
  const anchors:DraftCitation[]=[];let valid=true;
  for(const citation of paragraph.citations){
   const evidence=documents.find(d=>d.id===citation.evidenceId),unit=evidence?.document.pages.find(p=>p.page===citation.unit),start=unit?.text.indexOf(citation.quote)??-1;
   if(!evidence||!unit||start<0||unit.text.indexOf(citation.quote,start+1)!==-1){valid=false;break;}
   const anchor={evidenceId:evidence.id,filename:evidence.filename,unit:unit.page,unitKind:evidence.document.unitKind||"page" as const,quote:citation.quote,start,end:start+citation.quote.length};
   anchors.push({...anchor,key:hashValue({evidenceId:anchor.evidenceId,page:anchor.unit,start:anchor.start,end:anchor.end,quote:anchor.quote})});
  }
  if(!valid||!anchors.length){rejectedParagraphs++;continue;}
  for(const anchor of anchors)if(!citations.some(c=>c.key===anchor.key))citations.push(anchor);
  paragraphs.push(paragraph.text);
 }
 if(rejectedParagraphs)gaps.push(`${rejectedParagraphs} proposed paragraph(s) were withheld because their quotations were missing, ambiguous or referenced the wrong location.`);
 if(!paragraphs.length)gaps.push("No response could be grounded in the selected evidence. Add appropriate evidence or write a supported answer for independent review.");
 return questionnaireDraftResultSchema.parse({answer:paragraphs.join("\n\n"),status:paragraphs.length?"DRAFT":"INSUFFICIENT_SUPPORT",citations,gaps,warnings:[...baseWarnings,...parsed.limitations,...documents.flatMap(d=>d.document.warnings||[])].slice(0,30),rejectedParagraphs});
}
export function verifyDraftCitations(result:QuestionnaireDraftResult,documents:EvidenceDocument[]){
 assertDraftDocuments(documents);
 if(!result.citations.length)throw new Error("Select supporting evidence and locate verifiable passages before saving a response.");
 for(const c of result.citations){
  const evidence=documents.find(d=>d.id===c.evidenceId),unit=evidence?.document.pages.find(p=>p.page===c.unit);
  if(!unit||evidence?.filename!==c.filename||(evidence.document.unitKind||"page")!==c.unitKind||unit.text.slice(c.start,c.end)!==c.quote||c.end!==c.start+c.quote.length||hashValue({evidenceId:c.evidenceId,page:c.unit,start:c.start,end:c.end,quote:c.quote})!==c.key)throw new Error("A supporting quotation changed. Prepare a new draft.");
 }
}
