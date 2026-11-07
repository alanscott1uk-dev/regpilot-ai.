import {z} from "zod";
export const CHANGE_LIMITS={requirements:100,decisions:500,controls:30,files:150,dependencies:100,responses:100,history:10} as const;
export const affectedRequirementSchema=z.object({requirementId:z.uuid(),revisionId:z.uuid(),decisionId:z.uuid(),reference:z.string().max(100),collection:z.string().max(100)});
export type AffectedRequirement=z.infer<typeof affectedRequirementSchema>;
export const linkedEvidenceSchema=z.array(z.object({id:z.uuid(),filename:z.string(),reviewStatus:z.string(),scanStatus:z.string(),fingerprint:z.string()})).max(CHANGE_LIMITS.files);
export const changePlanSchema=z.object({
 version:z.literal(1),source:z.object({id:z.uuid(),sourceId:z.string(),title:z.string(),url:z.string(),contentHash:z.string(),version:z.number(),previousId:z.uuid(),previousHash:z.string()}),
 groups:z.array(z.object({controlId:z.uuid(),controlTitle:z.string(),controlVersion:z.number(),ownerId:z.uuid(),ownerName:z.string(),requirements:z.array(affectedRequirementSchema).min(1).max(100)})).max(CHANGE_LIMITS.controls),
 replaces:z.array(z.object({id:z.uuid(),version:z.number().int(),openActions:z.number().int()})).max(100),
 evidenceIds:z.array(z.uuid()).max(CHANGE_LIMITS.files),evidence:linkedEvidenceSchema,dependencies:z.object({policies:z.array(z.object({id:z.uuid(),title:z.string(),fingerprint:z.string()})),suppliers:z.array(z.object({id:z.uuid(),title:z.string(),fingerprint:z.string()})),audits:z.array(z.object({id:z.uuid(),title:z.string(),fingerprint:z.string()}))})
});
export type ChangePlan=z.infer<typeof changePlanSchema>;
export const createChangeSchema=z.object({snapshotId:z.uuid(),previewHash:z.string().regex(/^[a-f0-9]{64}$/),dueDate:z.iso.date(),confirm:z.literal(true)});
export const changeActionSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("SUBMIT"),version:z.number().int().positive(),notes:z.string().trim().min(60).max(1600),evidenceIds:z.array(z.uuid()).min(1).max(10).refine(v=>new Set(v).size===v.length),confirm:z.literal(true)}),
 z.object({action:z.enum(["ACCEPT","RETURN"]),version:z.number().int().positive(),notes:z.string().trim().min(60).max(1600),confirm:z.literal(true)})
]);
export const closeChangeSchema=z.object({version:z.number().int().positive(),contextHash:z.string().regex(/^[a-f0-9]{64}$/),notes:z.string().trim().min(60).max(1600),dependenciesReviewed:z.literal(true),confirm:z.literal(true)});
export const reopenChangeSchema=z.object({action:z.literal("REOPEN"),version:z.number().int().positive(),notes:z.string().trim().min(60).max(1600),confirm:z.literal(true)});
/** One action per shared control, with all affected requirement identities retained. */
export function groupChangeWork(rows:Array<AffectedRequirement&{controlId:string;controlTitle:string;controlVersion:number;ownerId:string;ownerName:string}>){
 const groups=new Map<string,ChangePlan["groups"][number]>();
 for(const row of rows){let g=groups.get(row.controlId);if(!g){g={controlId:row.controlId,controlTitle:row.controlTitle,controlVersion:row.controlVersion,ownerId:row.ownerId,ownerName:row.ownerName,requirements:[]};groups.set(row.controlId,g);}
  if(!g.requirements.some(r=>r.requirementId===row.requirementId))g.requirements.push(affectedRequirementSchema.parse(row));
 }
 return [...groups.values()].map(g=>({...g,requirements:g.requirements.sort((a,b)=>a.requirementId.localeCompare(b.requirementId))})).sort((a,b)=>a.controlId.localeCompare(b.controlId));
}
