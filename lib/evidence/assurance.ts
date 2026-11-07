import {z} from "zod";
import {hashValue} from "../regulatory/intelligence";
import {coverageOf,extractionBlocked,type ExtractedDocument,type DocumentCoverage} from "../documents/coverage";
export const ASSURANCE_ENGINE="evidence-assurance-2.0.0";
export type EvidenceManifest={id:string;sha256:string;reviewVersion:number;reviewStatus:string;uploadedById:string|null;reviewerId:string|null;scanStatus:string;obligationId:string};
export type EvidenceDocument={id:string;filename:string;document:ExtractedDocument};
export type EvidencePassage={key:string;evidenceId:string;page:number;unitKind?:"page"|"block";label?:string;start:number;end:number;quote:string;matchedTerms:string[];negationDetected:boolean};
export type AssuranceResult={engineVersion:string;sourceQuote:string;passages:EvidencePassage[];checks:{criterion:string;sourceQuote:string;verdict:"SUPPORTED"|"CONTRADICTED"|"NOT_FOUND"|"UNASSESSED";explanation:string;passageKeys:string[]}[];documents:({id:string;filename:string}&DocumentCoverage)[];warnings:string[];method:"CONTENT_SEARCH"|"AI";rejectedClaims:number};

const stop=new Set("a an and are as at be been being business businesses by can do for from has have if in is it its must of on or our shall should that the their then there these they this those to under was were which who will with you your".split(" "));
const stem=(s:string)=>s.length>5?s.replace(/ies$/,"y").replace(/(?:ing|ed|s)$/," ").trim():s;
const terms=(s:string)=>[...new Set((s.toLowerCase().match(/[a-z]{3,}/g)||[]).filter(t=>!stop.has(t)).map(stem))];
/** Search signals locate review material. They are deliberately not a sufficiency score. */
export function findEvidencePassages(sourceQuote:string,documents:EvidenceDocument[]):EvidencePassage[]{
  const query=terms(sourceQuote),passages:Array<EvidencePassage&{rank:number}>=[];
  for(const evidence of documents)for(const page of evidence.document.pages){
    for(const found of page.text.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)){
      const quote=found[0].trim();if(quote.length<20||quote.length>1800)continue;
      const words=new Set(terms(quote)),matchedTerms=query.filter(t=>words.has(t));
      if(!matchedTerms.length)continue;
      const start=found.index!+found[0].indexOf(quote),end=start+quote.length;
      passages.push({key:hashValue({evidenceId:evidence.id,page:page.page,start,end,quote}),evidenceId:evidence.id,page:page.page,unitKind:evidence.document.unitKind||"page",label:page.label,start,end,quote,matchedTerms,
        negationDetected:/\b(not|never|no|except|unless|without|incomplete|missing|failed|overdue)\b/i.test(quote),rank:matchedTerms.length/Math.sqrt(Math.max(words.size,1))});
    }
  }
  // Keep representation from each selected document, then rank within the bounded set.
  return documents.flatMap(doc=>passages.filter(p=>p.evidenceId===doc.id).sort((a,b)=>b.rank-a.rank||a.page-b.page||a.start-b.start).slice(0,5)).map(({rank,...p})=>p);
}
export function contentAssessment(sourceQuote:string,documents:EvidenceDocument[]):AssuranceResult{
  const passages=findEvidencePassages(sourceQuote,documents);
  return {engineVersion:ASSURANCE_ENGINE,sourceQuote,passages,method:"CONTENT_SEARCH",rejectedClaims:0,
    checks:[{criterion:"Demonstrate this specific requirement, including its conditions, scope and relevant dates.",sourceQuote,verdict:"UNASSESSED",explanation:passages.length?"Possible passages were located by word overlap. A reviewer must assess their meaning, currency and completeness.":"No related passage was located. Search failure does not prove the evidence is missing.",passageKeys:passages.map(p=>p.key)}],
    documents:documents.map(d=>({id:d.id,filename:d.filename,...coverageOf(d.document)})),
    warnings:[...documents.flatMap(d=>[...(d.document.blockingIssues||[]),...(d.document.warnings||[])]),"Text extraction does not verify authenticity, signatures, tables, reading order, images or real-world implementation. Inspect the original document.",
      "Word overlap and negation cues are search aids, not evidence of support or contradiction.",
      ...(documents.some(d=>extractionBlocked(d.document))?["Some content is unreadable, unsupported or extraction was limited. This assessment cannot be accepted as complete."]:[])]};
}
const citationSchema=z.object({evidenceId:z.string().uuid(),page:z.number().int().min(1).max(500),quote:z.string().min(12).max(1200)}).strict();
export const assuranceSchema=z.object({checks:z.array(z.object({criterion:z.string().min(10).max(350),sourceQuote:z.string().min(12).max(1800),verdict:z.enum(["SUPPORTED","CONTRADICTED","NOT_FOUND","UNASSESSED"]),explanation:z.string().min(20).max(700),citations:z.array(citationSchema).max(4)}).strict()).min(1).max(8),limitations:z.array(z.string().min(8).max(300)).max(6)}).strict();
export function groundedAssessment(raw:unknown,sourceQuote:string,documents:EvidenceDocument[]):AssuranceResult{
  const parsed=assuranceSchema.parse(raw),base=contentAssessment(sourceQuote,documents);base.method="AI";base.checks=[];
  for(const check of parsed.checks){
    const start=sourceQuote.indexOf(check.sourceQuote);
    let valid=start>=0&&sourceQuote.indexOf(check.sourceQuote,start+1)===-1;
    const anchored:EvidencePassage[]=[];
    for(const citation of check.citations){
      const document=documents.find(d=>d.id===citation.evidenceId)?.document;const page=document?.pages.find(p=>p.page===citation.page),offset=page?.text.indexOf(citation.quote)??-1;
      if(!page||offset<0||page.text.indexOf(citation.quote,offset+1)!==-1){valid=false;break;}
      const p={evidenceId:citation.evidenceId,page:citation.page,unitKind:document?.unitKind||"page",label:page.label,start:offset,end:offset+citation.quote.length,quote:citation.quote};
      anchored.push({...p,key:hashValue(p),matchedTerms:[],negationDetected:/\b(not|never|no|except|unless|missing|failed)\b/i.test(p.quote)});
    }
    if(["SUPPORTED","CONTRADICTED"].includes(check.verdict)&&!anchored.length)valid=false;
    if(!valid){base.rejectedClaims++;base.checks.push({criterion:"A model claim could not be grounded",sourceQuote,verdict:"UNASSESSED",explanation:"This claim was withheld because a source or evidence quotation was missing, ambiguous, or referenced the wrong document location.",passageKeys:[]});continue;}
    for(const p of anchored)if(!base.passages.some(old=>old.key===p.key))base.passages.push(p);
    base.checks.push({criterion:check.criterion,sourceQuote:check.sourceQuote,verdict:check.verdict,explanation:check.explanation,passageKeys:anchored.map(p=>p.key)});
  }
  base.warnings.push("AI checks are provisional interpretations of bounded extracted text. Exact citation matches do not validate reasoning or establish exhaustive requirement coverage.",...parsed.limitations);
  return base;
}
export function assertPassages(result:AssuranceResult,documents:EvidenceDocument[],keys:string[]){
  if(!keys.length||keys.length>8||new Set(keys).size!==keys.length)throw new Error("Select one to eight distinct supporting passages");
  for(const key of keys){const p=result.passages.find(p=>p.key===key),text=p&&documents.find(d=>d.id===p.evidenceId)?.document.pages.find(page=>page.page===p.page)?.text;
    if(!p||text?.slice(p.start,p.end)!==p.quote)throw new Error("A selected evidence passage is no longer verifiable");}
}
