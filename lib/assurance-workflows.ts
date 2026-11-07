import {z} from "zod";
export const WORKFLOW_LIMITS={policies:100,revisions:50,audience:100,vendors:200,reviews:50,files:10} as const;
const ids=z.array(z.uuid()).min(1).max(100).refine(v=>new Set(v).size===v.length,"Choose each person once");
export const policyDraftSchema=z.object({title:z.string().trim().min(3).max(160),summary:z.string().trim().min(20).max(1200),evidenceId:z.uuid()});
export const policyActionSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("REVISE"),version:z.number().int().positive(),summary:z.string().trim().min(20).max(1200),evidenceId:z.uuid()}),
 z.object({action:z.literal("WITHDRAW"),version:z.number().int().positive()}),
 z.object({action:z.literal("PUBLISH"),version:z.number().int().positive(),revisionId:z.uuid(),revisionVersion:z.number().int().positive(),notes:z.string().trim().min(40).max(1200),userIds:ids,dueDate:z.iso.date(),confirm:z.literal(true)}),
 z.object({action:z.literal("ASSIGN"),version:z.number().int().positive(),userIds:ids,dueDate:z.iso.date()})
]);
export const acknowledgementSchema=z.object({version:z.number().int().positive(),fileHash:z.string().regex(/^[a-f0-9]{64}$/),readAndUnderstood:z.literal(true)});
export const vendorSchema=z.object({name:z.string().trim().min(3).max(160),service:z.string().trim().min(20).max(1200),ownerId:z.uuid(),criticality:z.enum(["LOW","MEDIUM","HIGH"]),dataAccess:z.enum(["NONE","BUSINESS","PERSONAL","SENSITIVE"]),systemAccess:z.boolean(),nextReview:z.iso.date()});
export const VENDOR_CRITERIA=[
 {id:"service",label:"Service and responsibilities",help:"Is the service scope and ownership clear?"},
 {id:"security",label:"Security assurance",help:"Is suitable security evidence available for this service?"},
 {id:"privacy",label:"Information handling",help:"Are data flows, processing arrangements and retention understood?"},
 {id:"access",label:"Access and offboarding",help:"Is access limited, reviewed and removable?"},
 {id:"continuity",label:"Continuity and exit",help:"Can the business recover or move away if this supplier fails?"},
 {id:"incidents",label:"Incident communication",help:"Are incident contacts and notification arrangements agreed?"}
] as const;
export const criterionSchema=z.object({id:z.enum(["service","security","privacy","access","continuity","incidents"]),outcome:z.enum(["SUPPORTED","GAP","NOT_APPLICABLE"]),rationale:z.string().trim().min(20).max(1000),evidenceIds:z.array(z.uuid()).max(10).refine(v=>new Set(v).size===v.length)});
export const assessmentSchema=z.array(criterionSchema).length(6).refine(v=>new Set(v.map(c=>c.id)).size===6,"Assess every criterion once");
export const vendorReviewSchema=z.object({signalRunId:z.uuid().optional(),signalReviewed:z.literal(true).optional(),version:z.number().int().positive(),evidenceIds:z.array(z.uuid()).max(WORKFLOW_LIMITS.files).refine(v=>new Set(v).size===v.length),assessment:assessmentSchema,recommendation:z.enum(["APPROVE","CONDITIONAL","REJECT"]),rationale:z.string().trim().min(40).max(2000),followUpDue:z.iso.date(),validUntil:z.iso.date()});
export const vendorActionSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("LINK_SIGNAL"),version:z.number().int().positive(),connectorId:z.uuid().nullable(),notes:z.string().trim().min(40).max(1600),confirm:z.literal(true)}),
 z.object({action:z.literal("UPDATE"),version:z.number().int().positive(),vendor:vendorSchema}),
 z.object({action:z.literal("ARCHIVE"),version:z.number().int().positive()}),
 z.object({action:z.literal("ACCEPT"),reviewId:z.uuid(),version:z.number().int().positive(),notes:z.string().trim().min(40).max(2000),confirm:z.literal(true)}),
 z.object({action:z.literal("RETURN"),reviewId:z.uuid(),version:z.number().int().positive(),notes:z.string().trim().min(20).max(2000)})
]);
export function requiredVendorCriteria(v:{criticality:string;dataAccess:string;systemAccess:boolean}){
 const required=new Set<string>(["service","incidents"]);
 if(v.dataAccess!=="NONE"||v.systemAccess||v.criticality==="HIGH")required.add("security");
 if(v.dataAccess!=="NONE")required.add("privacy");
 if(v.systemAccess)required.add("access");
 if(v.criticality!=="LOW")required.add("continuity");
 return required;
}
export function vendorAssessmentIssues(v:{criticality:string;dataAccess:string;systemAccess:boolean},d:z.infer<typeof vendorReviewSchema>){
 const issues:string[]=[],required=requiredVendorCriteria(v);
 for(const c of d.assessment){
  if(c.outcome==="NOT_APPLICABLE"&&required.has(c.id))issues.push(c.id+": this criterion requires assessment for the recorded vendor scope");
  if(c.outcome==="SUPPORTED"&&c.evidenceIds.length===0)issues.push(c.id+": supported findings need evidence references");
  if(c.evidenceIds.some(id=>!d.evidenceIds.includes(id)))issues.push(c.id+": reference only selected evidence");
 }
 if(d.recommendation==="APPROVE"&&d.assessment.some(c=>c.outcome==="GAP"))issues.push("Resolve gaps or choose a conditional/reject recommendation");
 return issues;
}
