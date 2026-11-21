import {z} from 'zod';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const portalFields=z.object({format:z.literal('regpilot-portal-fields-v1'),origin:z.url({protocol:/^https$/}).max(250).refine(s=>new URL(s).origin===s),pageHash:sha,fields:z.array(z.string().trim().min(3).max(600)).min(1).max(100)}).strict();
export type PortalFields=z.infer<typeof portalFields>;
const normalize=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase();
export type ApprovedField={reference:string;question:string;answer:string;evidence:{filename:string;sha256:string}[];product?:{id:string;name:string}|null};
export function mapPortalFields(capture:PortalFields,questions:ApprovedField[]){
 return capture.fields.map(label=>{
  const matches=questions.filter(q=>normalize(q.question)===normalize(label)),repeated=capture.fields.filter(s=>normalize(s)===normalize(label)).length>1;
  const q=matches[0];
  if(repeated||matches.length!==1||!q.answer.trim()||!q.evidence.length)return {label,match:null,reason:repeated||matches.length>1?'Ambiguous field or product scope':'No exact supported answer'};
  return {label,match:{reference:q.reference,product:q.product?.name??null,answer:q.answer,evidence:q.evidence},reason:null};
 });
}
