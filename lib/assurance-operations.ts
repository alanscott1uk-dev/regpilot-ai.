import {z} from "zod";
import {ocrQuestionSourceSchema} from "./ocr";
export const OPS_LIMITS={inventory:200,campaigns:100,answers:300,questions:100,questionnaires:100,history:20} as const;
const notes=z.string().trim().min(40).max(1600),version=z.number().int().positive(),ids=z.array(z.uuid()).min(1).max(10).refine(v=>new Set(v).size===v.length);
export const accessEntrySchema=z.object({account:z.string().trim().min(1).max(254),permission:z.string().trim().min(1).max(160),privileged:z.boolean(),active:z.boolean()});
export const accessEntriesSchema=z.array(accessEntrySchema).max(OPS_LIMITS.inventory).refine(a=>new Set(a.map(accessKey)).size===a.length,"Repeated account/permission rows");
export type AccessEntry=z.infer<typeof accessEntrySchema>;
export function accessKey(e:Pick<AccessEntry,"account"|"permission">){return JSON.stringify([e.account.toLowerCase(),e.permission.toLowerCase()]);}
export function parseCsv(text:string,headers:string[],maxRows=200):Record<string,string>[] {
 if(new TextEncoder().encode(text).byteLength>200000||text.includes("\0"))throw new Error("CSV exceeds the safe import limit");
 text=text.replace(/^\uFEFF/,"");const rows:string[][]=[];let row:string[]=[],cell="",quoted=false,ended=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;ended=true;}}else cell+=c;}
 else if(c==='"'){if(cell||ended)throw new Error("Invalid CSV quotation");quoted=true;}
 else if(c===','||c==='\n'||c==='\r'){row.push(cell);cell="";ended=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==""))rows.push(row);row=[];}}
 else{if(ended)throw new Error("Unexpected text after CSV quotation");cell+=c;}
 if(cell.length>6000||rows.length>maxRows+1)throw new Error("CSV row limit exceeded");}
 if(quoted)throw new Error("Unclosed CSV quotation");row.push(cell);if(row.some(v=>v!==""))rows.push(row);
 const names=rows.shift()?.map(v=>v.trim().toLowerCase());if(!names||names.length!==headers.length||new Set(names).size!==names.length||headers.some(h=>!names.includes(h)))throw new Error("Use these CSV headers: "+headers.join(","));
 if(!rows.length||rows.length>maxRows||rows.some(r=>r.length!==names.length))throw new Error("CSV has no rows, too many rows or inconsistent columns");
 return rows.map(r=>Object.fromEntries(names.map((h,i)=>[h,r[i].trim()])));
}
export function inventoryCsv(text:string){const bool=(v:string)=>{if(!["true","false"].includes(v.toLowerCase()))throw new Error("Use true or false for active and privileged");return v.toLowerCase()==="true";};return accessEntriesSchema.parse(parseCsv(text,["account","permission","privileged","active"]).map(r=>({...r,privileged:bool(r.privileged),active:bool(r.active)})));}
export function safeCsv(rows:string[][]){return rows.map(r=>r.map(c=>'"'+(/^[\s]*[=+@-]/.test(c)?"'"+c:c).replaceAll('"','""')+'"').join(",")).join("\r\n");}
export const inventoryInput=z.object({system:z.string().trim().min(2).max(120),observedAt:z.iso.datetime(),csv:z.string().max(200000),complete:z.literal(true),confirm:z.literal(true)});
export const campaignInput=z.object({inventoryId:z.uuid(),inventoryHash:z.string().length(64),title:z.string().trim().min(3).max(160),reviewerId:z.uuid(),backupReviewerId:z.uuid(),dueDate:z.iso.date(),confirm:z.literal(true)});
export const accessAction=z.discriminatedUnion("action",[
 z.object({action:z.literal("DECIDE"),version,decision:z.enum(["KEEP","REMOVE","CHANGE"]),targetPermission:z.string().trim().max(160).optional(),operatorId:z.uuid().optional(),notes,confirm:z.literal(true)}),
 z.object({action:z.literal("SUBMIT"),version,evidenceIds:ids,notes,confirm:z.literal(true)}),
 z.object({action:z.enum(["VERIFY","RETURN","RESET"]),version,notes,confirm:z.literal(true)}),
 z.object({action:z.literal("ASSIGN"),version,reviewerId:z.uuid(),notes,confirm:z.literal(true)})
]);
export const campaignAction=z.object({action:z.enum(["CLOSE","CANCEL"]),version,contextHash:z.string().length(64).optional(),notes,confirm:z.literal(true)});
export const answerInput=z.object({question:z.string().trim().min(10).max(1200),scope:z.string().trim().min(2).max(120),answer:z.string().trim().min(40).max(6000),evidenceIds:ids,validUntil:z.iso.date(),productId:z.uuid().nullable().optional(),globalForProducts:z.boolean().optional(),requestKey:z.uuid().optional(),confirm:z.literal(true)});
export const answerAction=z.discriminatedUnion("action",[
 answerInput.extend({action:z.literal("REVISE"),version}),
 z.object({action:z.enum(["APPROVE","WITHDRAW"]),version,notes,confirm:z.literal(true)})
]);
const cellReference=z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/);
export const spreadsheetQuestionSourceSchema=z.object({filename:z.string().min(1).max(240),sha256:z.string().regex(/^[a-f0-9]{64}$/),format:z.enum(["CSV","XLSX"]),sheet:z.string().min(1).max(120),row:z.number().int().positive().max(1000000),questionCell:cellReference,referenceCell:cellReference.optional(),answerCell:cellReference.optional(),contextCells:z.array(cellReference).max(40).optional()});
export const documentQuestionSourceSchema=z.object({filename:z.string().min(1).max(240),sha256:z.string().regex(/^[a-f0-9]{64}$/),format:z.enum(["PDF","DOCX"]),unitKind:z.enum(["page","block"]),unit:z.number().int().positive().max(500),start:z.number().int().min(0).max(80000),end:z.number().int().positive().max(80000),quote:z.string().min(10).max(6000),extractionVersion:z.string().min(1).max(80),unitLabel:z.string().min(1).max(240).optional()}).refine(v=>v.end>v.start&&v.end-v.start===v.quote.length&&(v.format==="PDF"?v.unitKind==="page":v.unitKind==="block"),"Document provenance must match its exact source location");
// OCR must be tried first: the legacy PDF object intentionally accepts older extra metadata.
export const questionSourceSchema=z.preprocess((value,ctx)=>{if(value&&typeof value==='object'&&'method' in value&&value.method==='OCR'){const parsed=ocrQuestionSourceSchema.safeParse(value);if(!parsed.success){ctx.addIssue({code:'custom',message:'OCR requires complete independently reviewed region provenance'});return z.NEVER;}return parsed.data;}return value;},z.union([ocrQuestionSourceSchema,spreadsheetQuestionSourceSchema,documentQuestionSourceSchema.refine(s=>s.extractionVersion!=='azure-read-2024-11-30','OCR requires independently reviewed region provenance')]));
export const questionImportRowSchema=z.object({reference:z.string().trim().min(1).max(100),question:z.string().trim().min(10).max(1200),instructions:z.string().trim().max(4000).optional(),suppliedAnswer:z.string().trim().max(6000).optional(),source:questionSourceSchema.optional()});
const questionnaireBase=z.object({title:z.string().trim().min(3).max(160),recipient:z.string().trim().min(2).max(160),scope:z.string().trim().min(2).max(120),ownerId:z.uuid(),productIds:z.array(z.uuid()).max(10).refine(ids=>new Set(ids).size===ids.length).optional(),requestKey:z.uuid().optional(),confirm:z.literal(true)});
export const questionnaireInput=z.union([questionnaireBase.extend({csv:z.string().max(200000)}),questionnaireBase.extend({rows:z.array(questionImportRowSchema).min(1).max(OPS_LIMITS.questions)})]);
export const questionSchema=questionImportRowSchema.extend({id:z.uuid(),productId:z.uuid().optional(),productName:z.string().min(2).max(100).optional(),ownerId:z.uuid(),answerId:z.uuid().nullable(),answerVersion:z.number().int().nullable(),answerHash:z.string().nullable(),status:z.enum(["EMPTY","SUGGESTED","READY"]),changedById:z.uuid().nullable()});
export const questionsSchema=z.array(questionSchema).min(1).max(OPS_LIMITS.questions);
export const questionnaireAction=z.discriminatedUnion("action",[
 z.object({action:z.literal("ANSWER"),version,questionId:z.uuid(),answerId:z.uuid(),confirm:z.literal(true)}),
 z.object({action:z.literal("ASSIGN"),version,questionId:z.uuid(),ownerId:z.uuid()}),
 z.object({action:z.enum(["APPROVE","REOPEN","WITHDRAW","REFRESH_PRODUCTS"]),version,notes,confirm:z.literal(true)})
]);
export function normalQuestion(value:string){return value.trim().toLowerCase().replace(/\s+/g," ");}
export function answerMatches(question:string,answers:Array<{id:string;question:string}>){const q=normalQuestion(question),terms=new Set(q.match(/[\p{L}\p{N}]{3,}/gu)||[]);return answers.map(a=>{const v=normalQuestion(a.question),t=new Set(v.match(/[\p{L}\p{N}]{3,}/gu)||[]);return {...a,exact:q===v,score:q===v?1:[...terms].filter(x=>t.has(x)).length/Math.max(1,new Set([...terms,...t]).size)};}).filter(a=>a.score>=0.2).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,5);}
