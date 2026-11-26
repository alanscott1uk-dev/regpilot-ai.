import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {getProfile,frameworkPage,controlIds,getAuditControl,release,scfAttribution,type AuditControl,type Profile} from '../audit-catalogue/catalogue';
import {allowedEmail} from '../ai/security.mjs';
import {csvEscape} from '../obligations.mjs';
import {hashValue} from '../regulatory/intelligence';
import {transaction,IntelligenceError} from './intelligence-service';
import type {AuthorizedContext} from './authorization';
import {requireMember,ADMIN,WRITER} from './workspace-member';

type Tx=Prisma.TransactionClient;
const programme='PublishedFrameworkAudit',scoping='PublishedFrameworkControl';
const archiveRead={entityId:true,actorId:true,createdAt:true,details:true} as const;
const id=z.string().min(1).max(140),hash=z.string().regex(/^[a-f0-9]{64}$/);
const decision=z.enum(['APPLIES','EXCLUDED','REVIEW_NEEDED']);
const boundary=z.string().trim().min(8).max(600);
const adoption=z.object({framework:id,edition:z.literal(release),digest:hash,scope:boundary}).strict();
const record=z.object({controlId:id,decision,reason:z.string(),version:z.number().int().positive(),requestHash:hash,taskId:z.uuid().nullable(),digest:hash}).strict();
const enable=z.object({operation:z.literal('enable'),framework:id,digest:hash,scope:boundary}).strict();
const assess=z.object({operation:z.literal('assess'),framework:id,digest:hash,controlId:id,decision,reason:z.string().trim().min(8).max(1000),
  version:z.number().int().min(0),existingTaskId:z.uuid().optional(),ownerId:z.uuid().optional(),dueDate:z.iso.date().optional()}).strict();
const command=z.discriminatedUnion('operation',[enable,assess]);
type Assessment=z.infer<typeof record>;
type Adopted=z.infer<typeof adoption>;
const auditKey=(p:Profile)=>p.id+'@'+release;
const decisionPrefix=(p:Profile)=>auditKey(p)+'/';
function lookup(id:string){
  const p=getProfile(id);if(!p)throw new IntelligenceError('Framework unavailable',404);return p;
}
function readEnabled(p:Profile,details:Prisma.JsonValue){
  const a=adoption.safeParse(details);
  if(!a.success||a.data.framework!==p.id||a.data.digest!==p.digest)throw new IntelligenceError('Saved audit and published revision differ.',409);
  return a.data;
}
async function findEnabled(tx:Tx,c:AuthorizedContext,p:Profile){
  const event=await tx.auditEvent.findFirst({where:{organizationId:c.organizationId,entityType:programme,entityId:auditKey(p),action:'framework.enabled'}});
  return event?readEnabled(p,event.details):null;
}
function taskKey(p:Profile,scope:string,controlId:string){
  return hashValue({kind:'framework-evidence-task',scope,edition:release,digest:p.digest,control:p.source==='scf'?controlId:p.id+'/'+controlId});
}
const taskFields={id:true,title:true,status:true,assigneeId:true,ownerName:true,dueDate:true,automationKey:true} as const;
async function scopeDecisions(tx:Tx,c:AuthorizedContext,p:Profile){
  const rows=await tx.$queryRaw<{entityId:string;actorId:string;createdAt:Date;details:Prisma.JsonValue}[]>`
    SELECT DISTINCT ON ("entityId") "entityId","actorId","createdAt",details FROM "AuditEvent"
    WHERE "organizationId"=${c.organizationId}::uuid AND "entityType"=${scoping} AND action='framework.assessed'
      AND left("entityId", length(${decisionPrefix(p)}::text))=${decisionPrefix(p)}
    ORDER BY "entityId","createdAt" DESC,id DESC`;
  return new Map(rows.map(row=>{
    const d=record.parse(row.details);
    if(d.digest!==p.digest||row.entityId!==decisionPrefix(p)+d.controlId)throw new IntelligenceError('Saved control decision differs from its published revision.',409);
    return [d.controlId,{...d,by:row.actorId,at:row.createdAt.toISOString()}] as const;
  }));
}
export async function changeFrameworkAudit(c:AuthorizedContext,raw:unknown){
  const parsed=command.safeParse(raw);if(!parsed.success)throw new IntelligenceError('Check the framework, scope, owner, date and review decision.');
  const d=parsed.data,p=lookup(d.framework);
  if(d.digest!==p.digest)throw new IntelligenceError('Refresh to use the published framework revision.',409);
  return transaction(c,async tx=>{
    await requireMember(tx,c,ADMIN);
    const active=await findEnabled(tx,c,p);
    if(d.operation==='enable'){
      if(active&&active.scope!==d.scope)throw new IntelligenceError('This framework already has an audit with a different recorded scope.',409);
      if(!active)await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType:programme,entityId:auditKey(p),
        action:'framework.enabled',details:{framework:p.id,edition:release,digest:p.digest,scope:d.scope}}});
      return {framework:p.id,enabled:true};
    }
    if(!active)throw new IntelligenceError('Start the framework audit first.',409);
    const control=getAuditControl(p,d.controlId);if(!control)throw new IntelligenceError('Control is outside the selected framework.',400);
    const where={organizationId:c.organizationId,entityType:scoping,entityId:decisionPrefix(p)+d.controlId,action:'framework.assessed'};
    const previous=await tx.auditEvent.findFirst({where,orderBy:[{createdAt:'desc'},{id:'desc'}],select:archiveRead});
    const prior=previous?record.parse(previous.details):null,requestHash=hashValue(d);
    if(prior&&prior.requestHash===requestHash&&previous?.actorId===c.userId)return {framework:p.id,version:prior.version,taskId:prior.taskId};
    if(d.version!==(prior?.version??0))throw new IntelligenceError('Another reviewer changed this control. Reload its decision.',409);
    let taskId:string|null=null;
    if(d.decision==='APPLIES'){
      const automationKey=taskKey(p,active.scope,d.controlId);
      const existing=await tx.obligation.findFirst({where:{organizationId:c.organizationId,automationKey},select:taskFields});
      if(existing){
        if(existing.id!==d.existingTaskId)throw new IntelligenceError('A shared evidence task is available. Refresh before linking it.',409);
        taskId=existing.id;
      }else{
        if(d.existingTaskId||!d.ownerId||!d.dueDate||d.dueDate<new Date().toISOString().slice(0,10))throw new IntelligenceError('Choose a current owner and a working due date.');
        const owner=await requireMember(tx,{...c,userId:d.ownerId},WRITER);
        const task=await tx.obligation.create({data:{organizationId:c.organizationId,category:'Framework audit',title:control.name,
          ownerName:owner.email,assigneeId:d.ownerId,dueDate:new Date(d.dueDate+'T00:00:00Z'),automationKey,sourceUrl:control.url,
          notes:[active.scope,control.description,control.sourcePassage,control.suggestedEvidence?'Suggested evidence request':'',...control.evidence.map(e=>[e.id,e.name,e.description].filter(Boolean).join('\n')),
            p.source==='scf'?'Secure Controls Framework® (SCF) '+scfAttribution.edition+' · © '+scfAttribution.publisher+' · '+scfAttribution.license:'RegPilot regulatory audit · '+control.reference].filter(Boolean).join('\n\n')},select:{id:true}});
        taskId=task.id;
        await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType:'Obligation',entityId:taskId,action:'obligation.created',details:{via:'framework_audit',framework:p.id,controlId:d.controlId}}});
      }
    }
    const details:Assessment={controlId:d.controlId,version:d.version+1,decision:d.decision,reason:d.reason,digest:p.digest,taskId,requestHash};
    await tx.auditEvent.create({data:{...where,actorId:c.userId,details}});
    return {framework:p.id,version:details.version,taskId};
  });
}
async function withEvidence(tx:Tx,c:AuthorizedContext,p:Profile,active:Adopted,controls:AuditControl[],decisions:Awaited<ReturnType<typeof scopeDecisions>>,includeEvidenceIds:boolean){
  const keyMap=new Map(controls.map(ctrl=>[ctrl.id,taskKey(p,active.scope,ctrl.id)]));
  const tasks=await tx.obligation.findMany({where:{organizationId:c.organizationId,automationKey:{in:[...keyMap.values()]}},select:taskFields});
  const byKey=new Map(tasks.map(t=>[t.automationKey,t]));
  const files=tasks.length?await tx.evidence.findMany({where:{organizationId:c.organizationId,obligationId:{in:tasks.map(t=>t.id)},scanStatus:'CLEAN',reviewStatus:'APPROVED',reviewedAt:{not:null}},
    select:{id:true,obligationId:true,sha256:true,uploadedById:true,reviewerId:true,reviewVersion:true},orderBy:{id:'asc'}}):[];
  const byTask=new Map<string,{id:string;sha256:string;version:number}[]>();
  for(const f of files){
    if(!f.uploadedById||!f.reviewerId||f.uploadedById===f.reviewerId||!hash.safeParse(f.sha256).success)continue;
    const list=byTask.get(f.obligationId)??[];list.push({id:f.id,sha256:f.sha256!,version:f.reviewVersion});byTask.set(f.obligationId,list);
  }
  return controls.map(control=>{
    const saved=decisions.get(control.id),task=byKey.get(keyMap.get(control.id)!),approved=task?byTask.get(task.id)??[]:[];
    if(saved?.taskId&&task?.id!==saved.taskId)throw new IntelligenceError('The linked audit task cannot be verified in this workspace.',409);
    return {control,decision:saved?.decision??'UNASSESSED',version:saved?.version??0,reason:saved?.reason??'',reviewer:saved?.by??'',reviewedAt:saved?.at??'',
      task:task?{id:task.id,owner:task.ownerName,due:task.dueDate.toISOString().slice(0,10),status:task.status}:null,
      reviewedEvidence:saved?.decision==='APPLIES'?approved.length:0,evidence:includeEvidenceIds&&saved?.decision==='APPLIES'?approved:[]};
  });
}
export async function frameworkWorkspace(c:AuthorizedContext,framework:string,query='',page=1,exportAll=false){
  return transaction(c,async tx=>{
    const actor=await requireMember(tx,c),canEdit=ADMIN.includes(actor.role);
    if(exportAll&&!canEdit)throw new IntelligenceError('An administrator must export the audit evidence.',403);
    const events=await tx.auditEvent.findMany({where:{organizationId:c.organizationId,entityType:programme,entityId:{endsWith:'@'+release},action:'framework.enabled'},orderBy:{createdAt:'asc'},select:archiveRead});
    const audits=events.map(e=>{
      const data=adoption.safeParse(e.details);
      if(!data.success)throw new IntelligenceError('The recorded framework audit cannot be verified.',409);
      const p=lookup(data.data.framework);
      if(e.entityId!==auditKey(p))throw new IntelligenceError('The recorded framework identity cannot be verified.',409);
      return {framework:p.id,name:p.name,scope:readEnabled(p,e.details).scope};
    });
    const owners=canEdit&&framework?await tx.membership.findMany({where:{organizationId:c.organizationId,role:{in:['OWNER','ADMIN','EDITOR']}},select:{userId:true,user:{select:{email:true}}},orderBy:{userId:'asc'}}):[];
    const base={organizationId:c.organizationId,canEdit,audits,owners:owners.filter(o=>allowedEmail(o.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)).map(o=>({id:o.userId,email:o.user.email}))};
    if(!framework)return {...base,selected:null};
    const p=lookup(framework),active=audits.find(a=>a.framework===p.id);
    if(exportAll&&!active)throw new IntelligenceError('Start the audit before exporting its evidence.',409);
    const view=frameworkPage(p,query,page),source=active?await findEnabled(tx,c,p):null;
    const items=exportAll?controlIds(p).map(id=>getAuditControl(p,id)!):view.rows;
    const decisions=source?await scopeDecisions(tx,c,p):new Map();
    const rows=source?await withEvidence(tx,c,p,source,items,decisions,canEdit):[];
    return {...base,selected:{profile:p,active:!!source,scope:source?.scope??'',assessed:decisions.size,page:view.page,pages:view.pages,total:view.total,rows}};
  });
}
export function frameworkCsv(result:Awaited<ReturnType<typeof frameworkWorkspace>>){
  if(!result.selected?.active)throw new IntelligenceError('Audit unavailable.',404);
  const {profile,scope,rows}=result.selected;
  const credit=profile.source==='scf'?'Secure Controls Framework® (SCF) '+scfAttribution.edition+' © '+scfAttribution.publisher+' '+scfAttribution.license:'RegPilot evidence samples. '+(profile.source==='uk'?'UK public sector information, Open Government Licence v3.0.':'Source: Official Journal of the European Union.');
  const header=['Framework','Source digest','Scope','Control ID','Control','Published reference','Source URL','Opening passage','Assessment objectives','Evidence request','Request type','Applicability','Rationale','Reviewer','Reviewed UTC','Task ID','Owner','Due','Task status','Reviewed evidence IDs and SHA-256','Source attribution'];
  return [header,...rows.map(r=>[profile.name,profile.digest,scope,r.control.id,r.control.name,r.control.reference,r.control.url,r.control.sourcePassage??'',
    r.control.objectives.map(o=>o.id+' '+o.text).join('\n'),r.control.evidence.map(e=>[e.id,e.name,e.description].filter(Boolean).join('\n')).join('\n'),
    !r.control.evidence.length?'':r.control.suggestedEvidence?'Suggested working sample':profile.source==='scf'?'Publisher evidence request':'RegPilot prepared sample',
    r.decision,r.reason,r.reviewer,r.reviewedAt,r.task?.id??'',r.task?.owner??'',r.task?.due??'',r.task?.status??'',
    r.evidence.map(f=>f.id+' @ '+f.sha256+' v'+f.version).join(' | '),credit])].map(row=>row.map(csvEscape).join(',')).join('\r\n');
}
