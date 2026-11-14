import {z} from "zod";
import {CONTROL_THEMES,hashValue,parseProfile,type Analysis,type BusinessProfile,type Candidate} from "./intelligence";

export const SEMANTIC_ENGINE_VERSION="obligation-semantic-1.0.0";
const quote=z.string().min(8).max(1800);
export const semanticSchema=z.object({
  obligations:z.array(z.object({
    quote:quote.min(20),
    kind:z.enum(["duty","prohibition","recommendation","exemption"]),
    subject:z.string().min(3).max(240),
    action:z.string().min(8).max(500),
    applicabilityReason:z.string().min(12).max(500),
    conditions:z.array(quote).max(4),
    exceptions:z.array(quote).max(4),
    dateQuotes:z.array(quote).max(4),
    controlIds:z.array(z.enum(["records","training","suppliers","incidents","access","licensing","risk","privacy"])).max(3),
    questions:z.array(z.string().min(8).max(240)).max(5)
  }).strict()).max(12),
  limitations:z.array(z.string().min(8).max(300)).max(6)
}).strict();
export type SemanticInput={sourceId:string;text:string;previousText?:string;profile:BusinessProfile};
export type Passage={quote:string;start:number;end:number};
export type Interpretation={kind:"duty"|"prohibition"|"recommendation"|"exemption";subject:string;action:string;conditions:Passage[];exceptions:Passage[];dates:Passage[];context:Passage;meaningVerified:false};

function anchor(text:string,quote:string):Passage {
  const start=text.indexOf(quote);
  if(start<0||text.indexOf(quote,start+1)!==-1)throw new Error("Quotation is missing or ambiguous");
  return {quote,start,end:start+quote.length};
}
/** Exact text grounding is independently checked; model interpretations remain unverified. */
export function groundSemanticOutput(raw:unknown,input:SemanticInput):Analysis {
  parseProfile(input.profile);
  if(input.text.length<80||input.text.length>20000)throw new Error("A bounded source excerpt is required");
  const output=semanticSchema.parse(raw),candidates:Candidate[]=[],seen=new Set<string>();
  let rejected=0;
  for(const proposal of output.obligations){
    try{
      const main=anchor(input.text,proposal.quote),key=hashValue({sourceId:input.sourceId,quote:proposal.quote});
      if(seen.has(key))continue;
      const conditions=proposal.conditions.map(q=>anchor(input.text,q));
      const exceptions=proposal.exceptions.map(q=>anchor(input.text,q));
      const dates=proposal.dateQuotes.map(q=>anchor(input.text,q));
      // Keep neighbouring source text visible so omitted context can be spotted by a reviewer.
      const start=Math.max(0,main.start-400),end=Math.min(input.text.length,main.end+400);
      const change=input.previousText===undefined?"baseline":input.previousText.includes(main.quote)?"existing":"added-or-reworded";
      candidates.push({key,...main,change,
        language:proposal.kind==="prohibition"?"prohibition":proposal.kind==="recommendation"?"recommendation":proposal.kind==="exemption"?"exemption":"mandatory-language",
        applicability:"needs-context",priority:change==="added-or-reworded"?"review-first":"normal",
        reasons:["AI interpretation requiring review: "+proposal.applicabilityReason],
        questions:[...proposal.questions,"Confirm territorial scope, legal status and all conditions against the complete publication."],
        dateMentions:dates.map(d=>d.quote),
        mappings:[...new Set(proposal.controlIds)].map(id=>{const c=CONTROL_THEMES.find(c=>c.id===id)!;return {id,title:c.title,matchedTerms:[],evidenceNeeded:[...c.evidenceNeeded],domains:[...c.domains]};}),
        interpretation:{kind:proposal.kind,subject:proposal.subject,action:proposal.action,conditions,exceptions,dates,context:{quote:input.text.slice(start,end),start,end},meaningVerified:false}
      });
      seen.add(key);
    }catch{rejected++;}
  }
  candidates.sort((a,b)=>Number(b.priority==="review-first")-Number(a.priority==="review-first")||a.start-b.start);
  return {engineVersion:SEMANTIC_ENGINE_VERSION,candidates,examinedCharacters:input.text.length,candidateLimitReached:output.obligations.length===12,
    grounding:{proposed:output.obligations.length,retained:candidates.length,rejected,meaningVerified:false},
    warnings:["AI-generated interpretations, not verified legal obligations. Exact quotations were checked against the saved excerpt; meaning and completeness were not.",
      "Control suggestions are internal themes, not certified cross-framework equivalences. Dates are quoted context, not assigned deadlines.",
      ...(rejected?[`${rejected} proposal(s) withheld because a supporting quotation was missing or ambiguous.`]:[]),
      ...(!candidates.length?["No grounded recommendations remain. This is not evidence that the publication contains no duties."]:[]),
      ...(input.text.length>=12000?["This excerpt may be truncated. Review the full publication."]:[]),...output.limitations]};
}
