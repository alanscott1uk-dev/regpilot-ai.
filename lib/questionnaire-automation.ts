import {z} from 'zod';
import {normalQuestion} from './assurance-operations';
import {answerMatchesProduct} from './product-scope';

export const QUESTIONNAIRE_AUTOMATION_VERSION='approved-answer-reuse-v1' as const;
export const automationInput=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('PREVIEW'),version:z.number().int().positive()}),
 z.object({operation:z.literal('APPLY'),version:z.number().int().positive(),previewToken:z.string().regex(/^[a-f0-9]{64}$/),requestKey:z.uuid(),selections:z.array(z.object({questionId:z.uuid(),answerId:z.uuid()})).min(1).max(100).refine(rows=>new Set(rows.map(row=>row.questionId)).size===rows.length,'Select an answer at most once for each question'),confirm:z.literal(true)})
]);
export type AutomationInput=z.infer<typeof automationInput>;
export type Classification='SUPPORTED'|'AMBIGUOUS'|'UNANSWERED'|'CONFLICTING'|'EXPIRED';
export type KnowledgeAnswer={productId?:string|null;productContext?:unknown;id:string;question:string;scope:string;answer:string;version:number;contentHash:string;validUntil:string;status:string;current:boolean;reason:string};
export type Match<T extends KnowledgeAnswer>=T&{relevance:number;matchKind:'EXACT'|'RELATED';selectable:boolean};
const STOP_WORDS=new Set('the and are for that this with your you how what does have has all our can which please provide describe explain about from into their there when will would should could these those any its also each only through within company business organisation organization'.split(' '));
const terms=(value:string)=>new Set((normalQuestion(value).match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(term=>!STOP_WORDS.has(term)));
const overlap=(left:Set<string>,right:Set<string>)=>[...left].filter(term=>right.has(term)).length/Math.max(1,left.size);

/** A deterministic retrieval score, never a probability or factual/AI confidence. */
export function rankApprovedKnowledge<T extends KnowledgeAnswer>(question:{question:string;instructions?:string;productId?:string|null},answers:T[],limit=5):Match<T>[] {
 const prompt=terms(question.question),context=terms(question.instructions||'');
 return answers.filter(answer=>answerMatchesProduct(question,answer)).map(answer=>{
  const exact=normalQuestion(question.question)===normalQuestion(answer.question),wording=terms(answer.question),body=terms(answer.answer);
  const questionFit=overlap(prompt,wording),bodyFit=overlap(prompt,body),contextFit=context.size?overlap(context,new Set([...wording,...body])):0;
  const score=exact?1:Math.min(.99,questionFit*.7+bodyFit*.2+contextFit*.1);
  return {...answer,relevance:Math.round(score*1000)/1000,matchKind:exact?'EXACT' as const:'RELATED' as const,selectable:answer.current};
 }).filter(answer=>answer.matchKind==='EXACT'||answer.relevance>=.25)
  .sort((a,b)=>Number(b.current)-Number(a.current)||b.relevance-a.relevance||a.id.localeCompare(b.id)).slice(0,Math.max(1,Math.min(300,limit)));
}

export function classifyQuestion<T extends KnowledgeAnswer>(question:{question:string;instructions?:string;productId?:string|null;answerId?:string|null;preferredAnswerId?:string|null},answers:T[]):{classification:Classification;reason:string;recommendedAnswerId:string|null;candidates:Match<T>[]} {
 const ranked=rankApprovedKnowledge(question,answers,300),current=ranked.filter(answer=>answer.current),exact=current.filter(answer=>answer.matchKind==='EXACT');
 const conflicting=exact.length>1&&new Set(exact.map(answer=>normalQuestion(answer.answer))).size>1;
 const preferred=ranked.find(answer=>answer.id===question.preferredAnswerId&&answer.current),selected=ranked.find(answer=>answer.id===question.answerId),different=conflicting?exact.find(answer=>normalQuestion(answer.answer)!==normalQuestion(exact[0].answer)):undefined,expired=!current.length?ranked.find(answer=>answer.status==='APPROVED'&&answer.reason==='Answer has expired'):undefined;
 // Summaries consider the whole bounded library. A conflicting alternative or the saved
 // selection must not disappear merely because it sorts beyond the visible five.
 const candidates=[...new Map([...(preferred?[preferred]:[]),...(selected?[selected]:[]),...(conflicting?[exact[0],different!]:[]),...(expired?[expired]:[]),...ranked].map(answer=>[answer.id,answer])).values()].slice(0,5);
 if(conflicting)return {classification:'CONFLICTING',reason:'Different approved responses exist for this exact question. Compare their wording and evidence before choosing.',recommendedAnswerId:null,candidates};
 if(exact.length===1&&!question.instructions?.trim())return {classification:'SUPPORTED',reason:'One current, independently approved answer has the same question wording. The assigned colleague must still confirm its applicability.',recommendedAnswerId:exact[0].id,candidates};
 if(current.length)return {classification:'AMBIGUOUS',reason:question.instructions?.trim()?'Review the supplied instructions alongside the full answer and evidence. Word relevance does not establish that every instruction is answered.':'Related or multiple approved answers need a colleague to choose the applicable response.',recommendedAnswerId:null,candidates};
 if(expired)return {classification:'EXPIRED',reason:'Matching approved knowledge has passed its review date. Revise and independently approve it before reuse.',recommendedAnswerId:null,candidates};
 return {classification:'UNANSWERED',reason:candidates.length?'Matching knowledge is not currently approved or its evidence or reviewers need attention.':'No matching current approved answer was found. Prepare a supported answer before confirming this question.',recommendedAnswerId:null,candidates};
}

export function knowledgeHealth(answers:KnowledgeAnswer[]){return {
 total:answers.length,current:answers.filter(answer=>answer.current).length,
 expired:answers.filter(answer=>answer.status==='APPROVED'&&answer.reason==='Answer has expired').length,
 stale:answers.filter(answer=>answer.status==='APPROVED'&&!answer.current&&answer.reason!=='Answer has expired').length,
 draft:answers.filter(answer=>answer.status==='DRAFT').length,
 withdrawn:answers.filter(answer=>answer.status==='WITHDRAWN').length
};}

export function questionnaireCoverageByProduct(rows: readonly {
  productId?: string | null;
  productName?: string;
  status: string;
  classification: Classification;
}[]) {
  const groups = new Map<string, {
    id: string;
    name: string;
    total: number;
    supported: number;
    ambiguous: number;
    conflicting: number;
    unanswered: number;
    expired: number;
    confirmed: number;
    unresolved: number;
  }>();
  for (const row of rows) {
    const id = row.productId ?? '';
    const group = groups.get(id) ?? {
      id, name: row.productName || (id ? 'Unnamed product' : 'Company-wide'),
      total: 0, supported: 0, ambiguous: 0, conflicting: 0,
      unanswered: 0, expired: 0, confirmed: 0, unresolved: 0,
    };
    group.total++;
    switch (row.classification) {
      case 'SUPPORTED': group.supported++; break;
      case 'AMBIGUOUS': group.ambiguous++; break;
      case 'CONFLICTING': group.conflicting++; break;
      case 'UNANSWERED': group.unanswered++; break;
      case 'EXPIRED': group.expired++; break;
    }
    if (row.status === 'READY') group.confirmed++;
    else if (row.classification !== 'SUPPORTED') group.unresolved++;
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) =>
    b.unresolved - a.unresolved || a.name.localeCompare(b.name, 'en-GB') || a.id.localeCompare(b.id));
}
