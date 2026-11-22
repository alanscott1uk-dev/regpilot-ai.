import {z} from 'zod';

const description=z.string().trim().min(3).max(240);
export const siteTests=[
 {id:'stock-count',row:25,title:'Reconcile controlled stock with the physical count and trace the independent review.'},
 {id:'cold-chain',row:25,title:'Trace a calibrated excursion through the investigation to the authorised stock decision.'},
 {id:'sop-control',row:14,title:'Retrieve the effective procedure, its approval and the affected staff training records.'},
 {id:'site-access',row:27,title:'Exercise the configured access permissions and retrieve the required inspection records.'},
 {id:'site-recovery',row:27,title:'Restore a representative record and compare it with its approved original.'}
];
const criteria=z.array(z.object({step:z.string().refine(id=>siteTests.some(test=>test.id===id)),expected:z.string().trim().min(15).max(500)}).strict())
 .min(1).max(siteTests.length).refine(items=>new Set(items.map(item=>item.step)).size===items.length);
export const protocolTemplate=z.object({
 format:z.literal('regpilot-site-protocol-v1'),intendedUse:z.string().trim().min(15).max(360),criteria
}).strict();
export type ProtocolTemplate=z.infer<typeof protocolTemplate>;
export const siteProtocol=z.object({
 operator:description, site:description, licence:description, configuration:description,
 criteria
}).strict();

export const siteDecision=z.object({
 requestKey:z.uuid(),basisHash:z.string().regex(/^[a-f0-9]{64}$/), decision:z.enum(['APPROVE','WITHHOLD','WITHDRAW']), signatory:description,
 role:description, rationale:z.string().trim().min(20).max(800), decisionFile:z.uuid(), authorityFile:z.uuid(),
 confirmed:z.literal(true)
}).strict().refine(d=>d.decisionFile!==d.authorityFile,'Use separate decision and delegation records.');

export type SiteProtocol=z.infer<typeof siteProtocol>;
