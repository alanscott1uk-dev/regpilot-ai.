import {z} from "zod";
import {normalisePublicationText} from "./regulatory/publication-query.mjs";

export const sopNations = ["England","Scotland","Wales","Northern Ireland"] as const;
export const sopStarterNames = {
  general: "General procedure",
  mapping: "Medicines temperature mapping",
  leaver: "Staff offboarding",
  supplier: "Supplier qualification",
  food: "Food allergen information handover",
} as const;
export type SopStarter = keyof typeof sopStarterNames;
const field = (limit: number) => z.string().max(limit).refine(value =>
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value),
  "Remove the unreadable control character.");
const step = z.object({role:field(120),action:field(900),record:field(360),citationId:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export const sopReceiptSchema = z.object({
  id:z.string().regex(/^[a-f0-9]{64}$/),sourceId:z.string().min(1).max(100),
  documentHash:z.string().regex(/^[a-f0-9]{64}$/),start:z.number().int().min(0).max(60000),
  end:z.number().int().positive().max(60000),quote:field(480).refine(value=>value.length>0),
}).strict();
export const sopDraftSchema = z.object({
  format:z.literal("regpilot-sop-v1"),starter:z.enum(["general","mapping","leaver","supplier","food"]),
  title:field(160),reference:field(80),revision:field(40),nation:z.union([z.enum(sopNations),z.literal("")]),
  owner:field(120),scope:field(800),purpose:field(750),exceptions:field(1000),localChecks:field(1200),
  steps:z.array(step).min(1).max(24),sources:z.array(sopReceiptSchema).max(5),
}).strict().refine(d=>new Set(d.sources.map(s=>s.id)).size===d.sources.length,"Duplicate source passage.").refine(d=>d.steps.every(s=>!s.citationId||d.sources.some(p=>p.id===s.citationId)),"A step links to a missing source passage.");
export type SopDraft=z.infer<typeof sopDraftSchema>;
export type SopReceipt=z.infer<typeof sopReceiptSchema>;

const starterContent:Record<SopStarter,{purpose:string;actions:[string,string][];checks:string}> = {
  general:{purpose:"",actions:[["Confirm the request and check that this procedure applies.","Request or work order"],["Carry out the agreed activity and record the result.","Activity record"],["Review the outcome and record any follow-up.","Review record"]],checks:"Define the start and end of the process, local instructions and acceptance criteria."},
  mapping:{purpose:"Plan, record and review a mapping exercise for the identified medicines storage area.",actions:[["Define the area, operating conditions and the question the mapping exercise must answer.","Approved site plan and mapping protocol"],["Check logger identity and calibration status against the approved protocol.","Equipment register and calibration evidence"],["Record device positions, observations and changes in operating conditions during the agreed study.","Location plan and original time-stamped readings"],["Review the results against the approved site criteria and investigate exceptions.","Mapping report, exception record and review decision"]],checks:"Confirm the area, load conditions, sampling interval, study duration, limits, logger locations and remapping triggers with the site quality lead."},
  leaver:{purpose:"Remove or transfer access when a staff member leaves and retain evidence of the outcome.",actions:[["Verify the departure notice, affected identity and authorised effective time.","Authorised HR notification"],["Identify systems, privileged accounts, shared assets and accountable system owners.","Access inventory"],["Ask authorised owners to remove access and transfer records or assets as applicable.","Change tickets and asset return record"],["Independently check the resulting account state and follow up on unresolved access.","Dated verification and exceptions"]],checks:"Confirm timing, identity aliases, systems in scope, evidence retention and who can verify closure."},
  supplier:{purpose:"Review whether a supplier is suitable for the proposed goods, service and site.",actions:[["Identify the exact legal entity and the location or activity being assessed.","Registered identity and site details"],["Collect evidence relevant to the proposed relationship and verify its scope and date.","Evidence checklist and source references"],["Record gaps, restrictions and the owner of each follow-up.","Assessment and outstanding actions"],["Obtain an authorised independent decision and record when it must be reviewed.","Supplier decision and next review"]],checks:"Define qualification criteria, required permissions, the business owner, review triggers and permitted exceptions."},
  food:{purpose:"Pass current allergen information between the people responsible for a product or menu item.",actions:[["Confirm the product, recipe revision and ingredient information in scope.","Current specification and recipe"],["Check changes with the designated food safety lead and record any uncertainty.","Change record and reviewed information"],["Issue the reviewed information to the teams who use it and retire superseded copies.","Distribution and acknowledgement record"]],checks:"Confirm the relevant business activity, jurisdiction, source specifications, responsible roles and escalation procedure."},
};

export function inferSopStarter(topic:string):SopStarter {
  const q=normalisePublicationText(topic);
  if(/\btemperature mapping\b/.test(q))return "mapping";
  if(/\boff[ -]?boarding\b|\bleavers?\b/.test(q))return "leaver";
  if(/\b(supplier|vendor) (qualification|approval|assessment|onboarding)\b/.test(q))return "supplier";
  if(/\ballergens?\b/.test(q))return "food";
  return "general";
}
export function sopIntent(topic:string){
  return /\bsop\b/.test(normalisePublicationText(topic)) || inferSopStarter(topic)!=="general";
}
export function sopHref(topic="",nation=""){
  const params=new URLSearchParams();
  if(topic.trim())params.set("q",topic.trim().slice(0,160));
  if(sopNations.some(n=>n===nation))params.set("nation",nation);
  return "/sop-builder"+(params.size?"#"+params:"");
}
export function newSopDraft(topic:string,starter=inferSopStarter(topic),nation:SopDraft["nation"]=""):SopDraft{
  const seed=starterContent[starter], trimmed=topic.trim().slice(0,160);
  const title=starter==="general" ? (normalisePublicationText(trimmed)==="sop"?"":trimmed) : sopStarterNames[starter];
  return {format:"regpilot-sop-v1",starter,title,reference:"",revision:"",nation,owner:"",scope:"",purpose:seed.purpose,exceptions:"",localChecks:seed.checks,
    steps:seed.actions.map(([action,record])=>({role:"",action,record})),sources:[]};
}
export function sopOpenItems(d:SopDraft){
  const items: string[]=[];
  for(const [label,value] of [["Procedure title",d.title],["Document reference",d.reference],["Draft revision",d.revision],["Accountable owner",d.owner],["Scope and site",d.scope],["Purpose",d.purpose],["Exception and escalation route",d.exceptions]]) {
    if(!value.trim()) items.push(label);
  }
  d.steps.forEach((s,i)=>{
    if(!s.role.trim())items.push(`Step ${i+1} responsible role`);
    if(!s.action.trim())items.push(`Step ${i+1} instruction`);
    if(!s.record.trim())items.push(`Step ${i+1} evidence record`);
  });
  return items;
}
