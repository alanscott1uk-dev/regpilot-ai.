import {z} from "zod";
import {hashValue} from "../regulatory/intelligence";
import type {Rule} from "./applicability";
export const COVERAGE_ENGINE="coverage-2";
export type RequirementContent={title:string;quote:string;kind:"DUTY"|"PROHIBITION"|"GUIDANCE"|"STANDARD"|"EXEMPTION";conditions:string[];exceptions:string[];rule:Rule|null};
export type CoverageInput={requirements:Array<{id:string;collection:string;reference:string;content:RequirementContent}>;controls:Array<{id:string;title:string;description:string;testProcedure:string}>;documents:Array<{id:string;unitKind?:"page"|"block";pages:Array<{page:number;text:string;label?:string}>}>};
const mappingSchema=z.object({revisionId:z.uuid(),controlId:z.uuid(),requirementQuote:z.string().min(20).max(3000),controlQuote:z.string().min(15).max(1600),relation:z.enum(["POTENTIAL","PARTIAL","CONFLICT"]),explanation:z.string().min(20).max(1200),limitations:z.array(z.string().min(3).max(500)).max(8),citations:z.array(z.object({evidenceId:z.uuid(),page:z.number().int().positive(),quote:z.string().min(20).max(1500)})).max(4)});
export const coverageSchema=z.object({mappings:z.array(mappingSchema).max(36),limitations:z.array(z.string().min(3).max(500)).max(10)});
export type CoverageMapping=Omit<z.infer<typeof mappingSchema>,"citations">&{key:string;citations:(z.infer<typeof mappingSchema>["citations"][number]&{unitKind?:"page"|"block";label?:string})[]};
export type CoverageResult={engine:string;mappings:CoverageMapping[];unmapped:string[];rejected:number;limitations:string[]};
export function uniqueQuote(text:string,quote:string){const start=text.indexOf(quote);return start>=0&&text.indexOf(quote,start+1)<0;}
export function groundCoverage(raw:unknown,input:CoverageInput):CoverageResult{
 const parsed=coverageSchema.parse(raw),mappings:CoverageMapping[]=[];let rejected=0;const seen=new Set<string>();
 for(const p of parsed.mappings){const r=input.requirements.find(r=>r.id===p.revisionId),c=input.controls.find(c=>c.id===p.controlId),pair=p.revisionId+":"+p.controlId;
  if(!r||!c||seen.has(pair)||!uniqueQuote(r.content.quote,p.requirementQuote)||![c.description,c.testProcedure].some(t=>uniqueQuote(t,p.controlQuote))||p.citations.some(q=>!input.documents.some(d=>d.id===q.evidenceId&&d.pages.some(page=>page.page===q.page&&uniqueQuote(page.text,q.quote))))){rejected++;continue;}
  seen.add(pair);mappings.push({...p,key:hashValue(p),citations:p.citations.map(q=>{const d=input.documents.find(d=>d.id===q.evidenceId)!;return {...q,unitKind:d.unitKind||"page",label:d.pages.find(u=>u.page===q.page)?.label};})});
 }
 return {engine:COVERAGE_ENGINE,mappings,unmapped:input.requirements.filter(r=>!mappings.some(m=>m.revisionId===r.id&&m.relation!=="CONFLICT")).map(r=>r.id),rejected,limitations:[...parsed.limitations,"These are scoped relationship proposals, not proof of compliance or equivalent framework certification. Evidence sufficiency requires its own assessment."]};
}
const stop=new Set("with that this must shall should have from which their there will then where when only into your they them each such been also under these more than other ensure including required relevant appropriate requirement requirements policy policies process processes control controls documented document documents business organisation organization".split(" "));
function words(s:string){return new Set((s.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(w=>!stop.has(w)));}
export function searchCoverage(input:CoverageInput):CoverageResult{
 const mappings:z.infer<typeof mappingSchema>[]=[];
 for(const r of input.requirements){const terms=words(r.content.quote),ranked=input.controls.map(c=>({c,overlap:[...words(c.description+" "+c.testProcedure)].filter(w=>terms.has(w))})).filter(x=>x.overlap.length>=2).sort((a,b)=>b.overlap.length-a.overlap.length||a.c.id.localeCompare(b.c.id)).slice(0,3);
  for(const {c,overlap} of ranked){const controlQuote=(c.description.length>=15?c.description:c.testProcedure).slice(0,1600),citations:z.infer<typeof mappingSchema>["citations"]=[];
   for(const d of input.documents)for(const p of d.pages){const sentences=p.text.match(/[^.!?\n]+[.!?]?/g)||[];for(const s of sentences){const quote=s.trim();if(quote.length>=20&&quote.length<=1500&&[...words(quote)].filter(w=>terms.has(w)).length>=2&&citations.length<2&&uniqueQuote(p.text,quote))citations.push({evidenceId:d.id,page:p.page,quote});}}
   mappings.push({revisionId:r.id,controlId:c.id,requirementQuote:r.content.quote,controlQuote,relation:"POTENTIAL",explanation:"Shared terms: "+overlap.slice(0,10).join(", ")+". Check the original requirement, scope, conditions and exclusions before accepting this relationship.",limitations:["Text overlap cannot establish semantic equivalence, operating effectiveness, absence of contradiction or sufficient evidence."],citations});
  }
 }
 return groundCoverage({mappings,limitations:["Local text retrieval only; no AI service was called. Missing matches do not establish that a control is absent."]},input);
}
