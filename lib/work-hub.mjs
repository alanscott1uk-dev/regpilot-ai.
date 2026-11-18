/** Shared work-hub input rules. No credentials, network calls or compliance verdicts. */
export const WORK_VIEWS = Object.freeze({ open:'Open work', mine:'Assigned to me', overdue:'Overdue', unassigned:'Needs an assignee', review:'Evidence to review', complete:'Completed' });
export const WORK_PAGE_SIZE = 25;
export class WorkInputError extends Error { constructor(message, status=400) { super(message); this.name='WorkInputError'; this.status=status; } }
export const workUuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function workDate(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WorkInputError('Choose a valid date.');
 const date=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||value<'2000-01-01'||value>'2100-12-31') throw new WorkInputError('Choose a valid date between 2000 and 2100.');
 return value;
}
export function parseWorkQuery(params) {
 const view=params.get('view')||'open',q=(params.get('q')||'').trim(),page=params.get('page')||'1';
 if(!Object.hasOwn(WORK_VIEWS,view)) throw new WorkInputError('Choose a recognised work view.');
 if(q.length>120||/[\u0000-\u001f]/.test(q)) throw new WorkInputError('Search must contain at most 120 characters.');
 if(!/^[1-9]\d{0,5}$/.test(page)) throw new WorkInputError('Choose a valid results page.');
 return {view,q,page:Number(page)};
}
export function parseWorkPlan(input) {
 if(!input||typeof input!=='object'||Array.isArray(input)) throw new WorkInputError('A planning request is required.');
 if(Object.keys(input).some(k=>!['items','changes','reason','token'].includes(k))) throw new WorkInputError('Unsupported planning field.');
 if(!Array.isArray(input.items)||input.items.length<1||input.items.length>25) throw new WorkInputError('Select between 1 and 25 tasks.');
 const items=input.items.map(item=>{
  if(!item||Object.keys(item).some(k=>!['id','updatedAt'].includes(k))||!workUuid(item.id)||typeof item.updatedAt!=='string') throw new WorkInputError('Invalid selected task.');
  const date=new Date(item.updatedAt);
  if(!Number.isFinite(date.getTime())||date.toISOString()!==item.updatedAt) throw new WorkInputError('Refresh the task list before planning.');
  return {id:item.id.toLowerCase(),updatedAt:item.updatedAt};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 if(new Set(items.map(x=>x.id)).size!==items.length) throw new WorkInputError('Each selected task must be unique.');
 const source=input.changes;
 if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).some(k=>!['assigneeId','dueDate'].includes(k))) throw new WorkInputError('Only an assignee and a due date can be changed here.');
 const changes={};
 if(Object.hasOwn(source,'assigneeId')) {
  if(source.assigneeId!==null&&!workUuid(source.assigneeId)) throw new WorkInputError('Choose a workspace assignee.');
  changes.assigneeId=source.assigneeId===null?null:source.assigneeId.toLowerCase();
 }
 if(Object.hasOwn(source,'dueDate')) changes.dueDate=workDate(source.dueDate);
 if(!Object.keys(changes).length) throw new WorkInputError('Choose at least one planning change.');
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 if(reason.length<20||reason.length>500) throw new WorkInputError('Explain the change in 20 to 500 characters.');
 if(input.token!==undefined&&(typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token))) throw new WorkInputError('Refresh the change preview.');
 return {items,changes,reason,...(input.token?{token:input.token}:{})};
}
export function planningBlock(task) {
 if(task.status==='COMPLETE') return 'Completed tasks retain their recorded plan.';
 if(task.changeAction||task.auditRequest||task.accessItem) return 'Manage the owner and deadline in the linked review workflow.';
 return null;
}
export function taskWorkflow(task,organizationId) {
 const query='?organizationId='+encodeURIComponent(organizationId);
 if(task.changeAction) return {label:'Open change response',href:'/team/changes'+query+'&responseId='+encodeURIComponent(task.changeAction.responseId)};
 if(task.auditRequest) return {label:'Open audit request',href:'/team/audit-requests'+query};
 if(task.accessItem) return {label:'Open access review',href:'/team/access-reviews'+query};
 if(task.originKey) return {label:'Assess supporting evidence',href:'/team/assurance'+query+'&taskId='+encodeURIComponent(task.id)};
 return {label:'Review supporting evidence',href:'/team/evidence'+query+'&taskId='+encodeURIComponent(task.id)};
}
export function safeWorkSource(value) {
 try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}

/** Start is deliberately separate from approval and completion. */
export function parseWorkStart(input) {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['id','updatedAt'].includes(k))||!workUuid(input.id)||typeof input.updatedAt!=='string') throw new WorkInputError('Choose a task from the current work list.');
 const date=new Date(input.updatedAt);
 if(!Number.isFinite(date.getTime())||date.toISOString()!==input.updatedAt) throw new WorkInputError('Refresh the task before starting it.');
 return {id:input.id.toLowerCase(),updatedAt:input.updatedAt};
}

export async function readWorkJson(request) {
 const reader=request.body?.getReader();
 if(!reader)throw new WorkInputError('A JSON request is required.');
 const chunks=[];let length=0;
 try {
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16000){await reader.cancel().catch(()=>{});throw new WorkInputError('Planning request too large',413);}chunks.push(value);}
 } finally {reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new WorkInputError('Invalid UTF-8 JSON request.');}
 return JSON.parse(text);
}

export function parseWorkCreate(input) {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['title','category','notes','dueDate','assigneeId'].includes(k)))throw new WorkInputError('Invalid new task.');
 const title=typeof input.title==='string'?input.title.trim():'',category=typeof input.category==='string'?input.category.trim():'Internal',notes=typeof input.notes==='string'?input.notes.trim():'';
 if(!title||title.length>160||!category||category.length>80||notes.length>500)throw new WorkInputError('Use a title up to 160 characters, category up to 80 and notes up to 500.');
 if(!workUuid(input.assigneeId))throw new WorkInputError('Choose a workspace assignee.');
 return {title,category,notes,dueDate:workDate(input.dueDate),assigneeId:input.assigneeId.toLowerCase()};
}
