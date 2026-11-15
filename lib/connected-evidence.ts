import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const connectedEvidenceSchema=z.object({
 id:z.uuid(),connectorId:z.uuid(),configuredById:z.uuid(),provider:z.string(),label:z.string(),
 configVersion:z.number().int().positive(),resultHash:hash,signalHash:hash,capturedAt:z.iso.datetime(),
 sourceUrl:z.url().refine(v=>new URL(v).protocol==='https:'),engine:z.string(),
 checks:z.array(z.object({id:z.string(),label:z.string(),status:z.enum(['PASS','FAIL','UNKNOWN']),observed:z.string(),nextStep:z.string()})).max(200),
 limitations:z.array(z.string()).max(100)
});
export type ConnectedEvidence=z.infer<typeof connectedEvidenceSchema>;
