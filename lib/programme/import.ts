import {z} from "zod";
import {hashValue,matchControls,CONTROL_THEMES} from "../regulatory/intelligence";
import type {ExtractedPdf} from "../server/pdf-extraction";
export const PROGRAMME_ENGINE="programme-import-1.0.0";
export type ImportDocument={id:string;filename:string;document:ExtractedPdf};
export const proposalSchema=z.object({controls:z.array(z.object({title:z.string().min(8).max(160),description:z.string().min(20).max(1600),testProcedure:z.string().min(20).max(1600),theme:z.string().max(40),citations:z.array(z.object({evidenceId:z.uuid(),page:z.number().int().min(1).max(40),quote:z.string().min(25).max(1200)})).min(1).max(3)})).max(30)});
export type ProposalInput=z.infer<typeof proposalSchema>;
export type ControlProposal=ProposalInput["controls"][number]&{key:string;citations:(ProposalInput["controls"][number]["citations"][number]&{start:number;end:number})[]};
export type ProgrammeResult={engine:string;controls:ControlProposal[];rejected:number;documents:{id:string;filename:string;totalPages:number;extractedPages:number;truncated:boolean;skippedPages:number[]}[];warnings:string[]};
export function groundProgramme(raw:unknown,documents:ImportDocument[]):ProgrammeResult{
 const value=proposalSchema.parse(raw),controls:ControlProposal[]=[];let rejected=0;
 for(const candidate of value.controls){
  if(!CONTROL_THEMES.some(t=>t.id===candidate.theme)){rejected++;continue;}
  const citations=candidate.citations.map(c=>{const page=documents.find(d=>d.id===c.evidenceId)?.document.pages.find(p=>p.page===c.page);const start=page?.text.indexOf(c.quote)??-1;return !page||start<0||page.text.indexOf(c.quote,start+1)!==-1?null:{...c,start,end:start+c.quote.length};});
  if(citations.some(c=>!c)){rejected++;continue;}
  const grounded=citations as ControlProposal["citations"],key=hashValue({title:candidate.title.toLowerCase(),citations:grounded});
  if(controls.some(c=>c.key===key)){rejected++;continue;}
  controls.push({...candidate,citations:grounded,key});
 }
 return {engine:PROGRAMME_ENGINE,controls,rejected,documents:documents.map(d=>({id:d.id,filename:d.filename,totalPages:d.document.totalPages,extractedPages:d.document.pages.length,truncated:d.document.truncated,skippedPages:d.document.skippedPages})),warnings:["Proposals describe what the selected documents say, not whether controls operate effectively.","Review the complete programme, ownership, scope and missing controls. Extraction is not a completeness guarantee.","Internal control themes are not certified framework mappings.",...(rejected?[`${rejected} unsupported, duplicated or unknown-theme proposals were withheld.`]:[])]};
}
export function findProgrammePassages(documents:ImportDocument[]):ProgrammeResult{
 const controls:ProposalInput["controls"]=[];
 for(const d of documents)for(const p of d.document.pages){
  for(const match of p.text.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)){
   const quote=match[0].trim();if(quote.length<25||quote.length>1200||!/(must|shall|review|maintain|retain|ensure|approve|monitor)/i.test(quote)||controls.length>=30)continue;
   const theme=matchControls(quote)[0]?.id;if(!theme)continue;
   controls.push({title:quote.slice(0,150),description:quote,testProcedure:"Review the full policy and identify a dated record demonstrating implementation, its scope and any exceptions.",theme,citations:[{evidenceId:d.id,page:p.page,quote}]});
  }
 }
 const result=groundProgramme({controls},documents);result.warnings.unshift("Pattern search found candidate passages. A reviewer must decide whether each represents a useful operating control.");return result;
}
