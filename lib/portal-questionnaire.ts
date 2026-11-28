import {z} from 'zod';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const portalFields=z.object({format:z.literal('regpilot-portal-fields-v1'),origin:z.url({protocol:/^https$/}).max(250).refine(s=>{try{return new URL(s).origin===s;}catch{return false;}}),pageHash:sha,fields:z.array(z.string().trim().min(3).max(1200)).min(1).max(100)}).strict();
export const portalDestination=portalFields.pick({origin:true,pageHash:true}).strict();
export type PortalDestination=z.infer<typeof portalDestination>;
export async function identifyPortal(address:string):Promise<PortalDestination>{
 const url=new URL(address);
 if(address.length>3000||url.protocol!=='https:'||url.username||url.password)throw Error('Enter an HTTPS buyer portal address without embedded credentials.');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url.href));
 return portalDestination.parse({origin:url.origin,pageHash:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')});
}
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
