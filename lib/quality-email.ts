import {z} from 'zod';

const singleLine=(max:number)=>z.string().trim().min(1).max(max).regex(/^[^\r\n\u0000]+$/);
export const emailSourceSchema=z.object({
 messageId:singleLine(512),
 sender:z.email().max(254),
 subject:singleLine(300),
 createdAt:z.iso.datetime(),
 excerpt:z.string().max(3000).refine(s=>!s.includes('\u0000'))
}).strict();
export const emailAttachmentSchema=z.object({
 id:z.uuid(),filename:z.string().min(1).max(160),sha256:z.string().regex(/^[0-9a-f]{64}$/)
}).strict();
export const emailSnapshotSchema=z.object({
 source:emailSourceSchema,taskId:z.uuid().nullable(),files:z.array(emailAttachmentSchema).max(3)
}).strict();
export type CaseEmailSnapshot=z.infer<typeof emailSnapshotSchema>;
export type CaseEmailRecord=CaseEmailSnapshot & {key:string;actor:string;at:string;cycle:number};
const transferFile=z.object({
 name:z.string().min(1).max(160).regex(/\.(pdf|docx)$/i),
 base64:z.string().min(4).max(2_796_204).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(s=>s.length%4===0)
}).strict();
export const transferSchema=z.object({
 format:z.literal('regpilot-outlook-v1'),source:emailSourceSchema,files:z.array(transferFile).max(3)
}).strict().refine(x=>x.files.reduce((n,f)=>n+f.base64.length/4*3-(f.base64.match(/=+$/)?.[0].length??0),0)<=2*1024*1024,
 'Select files totalling up to 2 MiB.');
export type OutlookTransfer=z.infer<typeof transferSchema>;
