import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {transaction,IntelligenceError} from './intelligence-service';
import {allowedEmail} from '../ai/security.mjs';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import type {AuthorizedContext} from './authorization';
import {readPublicHorizon} from './horizon-service';
import {scottishPharmaReason,wholesaleView,type WholesaleView} from '../horizon/watchlists';
import {assessOfficialIndexes} from '../horizon/official-indexes';
import {reportState,type HorizonReport} from '../horizon/model';
import {hashValue} from '../regulatory/intelligence';

const entity='ScottishApplicabilityAssessment',frozen='horizon.assessment_frozen',decided='horizon.assessment_reviewed';
const key=z.string().regex(/^[a-f0-9]{32,64}$/);
const item=z.object({id:key,revision:key,title:z.string().min(1),url:z.url(),publishers:z.array(z.string()),suggested:z.boolean(),feedRevision:key.optional(),collection:z.enum(['FOUND','WRONG_PUBLISHER','MISSING','INDETERMINATE']).optional(),index:z.url().optional(),indexDigest:key.optional()});
const sample=z.object({profile:wholesaleView.optional(),method:z.enum(['INDEX','QUEUE']).optional(),population:z.number().int().positive().optional(),queuePopulation:z.object({shortlisted:z.number().int().positive(),other:z.number().int().positive()}).optional(),scope:z.string().min(15).max(400),snapshot:z.iso.datetime(),release:z.string().nullable(),unavailable:z.array(z.string()),rows:z.array(item).min(2).max(20)});
const judgement=z.object({id:key,verdict:z.enum(['APPLIES','OUTSIDE_SCOPE','UNCERTAIN']),reason:z.string().trim().min(10).max(350)}).strict();
const labels=z.array(judgement).min(2).max(20);
export const assessmentAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('START'),profile:wholesaleView.default('scottish-pharma-wholesale'),requestKey:z.uuid(),method:z.enum(['INDEX','QUEUE']).default('QUEUE'),scope:z.string().trim().min(15).max(400)}).strict(),
 z.object({action:z.literal('FOLLOW_UP'),assessmentId:z.uuid(),sampleHash:key,publicationId:key,ownerId:z.uuid(),dueDate:z.iso.date()}).strict(),
 z.object({action:z.literal('REVIEW'),assessmentId:z.uuid(),sampleHash:z.string().regex(/^[a-f0-9]{64}$/),labels}).strict()
]);
type Tx=Prisma.TransactionClient;
const invalid=(message:string)=>new IntelligenceError(message,409);
const lookup=(org:string,id:string,action:string)=>({organizationId:org,entityType:entity,entityId:id,action});
async function detail(tx:Tx,c:AuthorizedContext,id:string){
 const first=await tx.auditEvent.findFirst({where:lookup(c.organizationId,id,frozen)});
 if(!first)throw new IntelligenceError('Assessment unavailable',404);
 const sealed=z.object({sample,hash:z.string()}).parse(first.details),facts=sealed.sample;
 if(hashValue(facts)!==sealed.hash)throw invalid('The assessment sample failed its integrity check.');
 const event=await tx.auditEvent.findFirst({where:lookup(c.organizationId,id,decided)});
 const review=event?z.object({sampleHash:z.string(),labels,hash:z.string()}).parse(event.details):null;
 if(review&&(review.sampleHash!==sealed.hash||hashValue(review.labels)!==review.hash||event!.actorId===first.actorId))throw invalid('The assessment decision failed its integrity check.');
 return {first,facts,hash:sealed.hash,event,review};
}
type AssessmentState=Awaited<ReturnType<typeof detail>>;
function correction(state:AssessmentState,row:AssessmentState['facts']['rows'][number]){
 const label=state.review?.labels.find(l=>l.id===row.id);
 if(!label)return null;
 const reason=label.verdict==='UNCERTAIN'?'Resolve site applicability':
  label.verdict==='APPLIES'&&!row.suggested?'Investigate missed publication':
  label.verdict==='OUTSIDE_SCOPE'&&row.suggested?'Investigate false alert':
  row.collection==='INDETERMINATE'?'Verify source collection':null;
 if(!reason)return null;
 return {reason,label,key:hashValue(['horizon-assessment-correction',state.facts.scope,state.facts.profile??'scottish-pharma-wholesale',row.url,row.revision,reason])};
}
function visible(state:Awaited<ReturnType<typeof detail>>,userId:string,tasks:Map<string,{id:string;status:string;ownerName:string;dueDate:Date}>){
 const {first,facts,hash,event,review}=state,byId=new Map(review?.labels.map(l=>[l.id,l]));
 const counts={correctAlert:0,falseAlert:0,missed:0,correctExclusion:0,uncertain:0};
 let unavailableComparisons=0,missedAtCollection=0;
 const rows=facts.rows.map(({suggested,collection,index,indexDigest,feedRevision,...row})=>{
  const label=byId.get(row.id);
  if(!label)return {...row,assessment:null,followUp:null};
  if(label.verdict==='UNCERTAIN')counts.uncertain++;
  else if(collection==='INDETERMINATE')unavailableComparisons++;
  else if(suggested){if(label.verdict==='APPLIES')counts.correctAlert++;else counts.falseAlert++;}
  else if(label.verdict==='APPLIES'){counts.missed++;if(collection==='MISSING')missedAtCollection++;}else counts.correctExclusion++;
  const issue=correction(state,{...row,suggested,collection,index,indexDigest});
  const task=issue?tasks.get(issue.key):null;
  const followUp=issue?{reason:issue.reason,task:task?{id:task.id,status:task.status,owner:task.ownerName,dueDate:task.dueDate.toISOString().slice(0,10)}:null}:null;
  return {...row,followUp,assessment:{suggested,collection,index,indexDigest,feedRevision:facts.method==='INDEX'?feedRevision??null:row.revision,verdict:label.verdict,reason:label.reason}};
 });
 const ratio=(part:number,total:number)=>total?part/total:null;
 const population=facts.queuePopulation;
 let queueEstimate=null;
 if(review&&population&&!counts.uncertain){
  const sampledAlerts=counts.correctAlert+counts.falseAlert,sampledOthers=counts.missed+counts.correctExclusion;
  if(sampledAlerts>0&&sampledOthers>0&&sampledAlerts<=population.shortlisted&&sampledOthers<=population.other){
   const applicableAlerts=population.shortlisted*counts.correctAlert/sampledAlerts;
   const missed=population.other*counts.missed/sampledOthers;
   queueEstimate={sampledAlerts,sampledOthers,shortlisted:population.shortlisted,other:population.other,
    precision:ratio(counts.correctAlert,sampledAlerts),recall:ratio(applicableAlerts,applicableAlerts+missed)};
  }
 }
 return {id:first.id,queueEstimate,sampleHash:hash,profile:facts.profile??'scottish-pharma-wholesale',method:facts.method??'QUEUE',population:facts.population??null,coverage:review&&facts.method==='INDEX'?{unavailableComparisons,missedAtCollection}:null,scope:facts.scope,snapshot:facts.snapshot,release:facts.release,unavailable:facts.unavailable,
  createdBy:first.actorId,reviewerId:event?.actorId??null,reviewedAt:event?.createdAt.toISOString()??null,canReview:!review&&first.actorId!==userId,rows,
  score:review?{...counts,precision:ratio(counts.correctAlert,counts.correctAlert+counts.falseAlert),recall:ratio(counts.correctAlert,counts.correctAlert+counts.missed)}:null};
}
export async function applicabilityAssessment(c:AuthorizedContext,id?:string){
 return transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);
  const recent=await tx.auditEvent.findMany({where:{organizationId:c.organizationId,entityType:entity,action:frozen},orderBy:[{createdAt:'desc'},{id:'desc'}],take:12,select:{id:true,createdAt:true}});
  const selected=id??recent[0]?.id;
  const state=selected?await detail(tx,c,selected):null;
  const issueKeys=state?.review?state.facts.rows.flatMap(row=>correction(state,row)?.key??[]):[];
  const tasks=issueKeys.length?await tx.obligation.findMany({where:{organizationId:c.organizationId,automationKey:{in:issueKeys}},select:{id:true,status:true,ownerName:true,dueDate:true,automationKey:true}}):[];
  const members=issueKeys.length?await tx.membership.findMany({where:{organizationId:c.organizationId,role:{in:['OWNER','ADMIN','EDITOR']}},select:{user:{select:{id:true,email:true}}},orderBy:{userId:'asc'},take:100}):[];
  return {recent:recent.map(x=>({id:x.id,at:x.createdAt.toISOString()})),members:members.map(m=>m.user).filter(u=>allowedEmail(u.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)),
   selected:state?visible(state,c.userId,new Map(tasks.map(t=>[t.automationKey!,t]))):null};
 });
}
async function publisherSample(report:HorizonReport,seed:string,profile:WholesaleView,compare:typeof assessOfficialIndexes){
 const comparison=await compare(report);
 const byUrl=new Map(report.items.filter(i=>i.observedAt===report.generatedAt).map(i=>[i.url,i]));
 const distinct=new Map<string,z.infer<typeof item>>();
 for(const index of comparison.indexes){
  if(index.state!=='READ'||!index.result)continue;
  for(const row of index.result.rows){
   if(distinct.has(row.url))continue;
   const stored=byUrl.get(row.url);
   distinct.set(row.url,{id:hashValue(row.url),revision:hashValue([row.url,row.on,row.title]),url:row.url,title:row.title,publishers:[index.publisher],
    suggested:!!stored&&Boolean(scottishPharmaReason(stored,profile)),...(stored?{feedRevision:stored.revision}:{}),collection:row.outcome,index:index.index,indexDigest:index.sha256});
  }
 }
 if(distinct.size<2)throw invalid('The official publisher indexes returned fewer than two eligible records. Try the publisher sample again after the next collection.');
 const ranked=[...distinct.values()].map(row=>({row,order:hashValue([seed,row.id])})).sort((a,b)=>a.order.localeCompare(b.order));
 return {method:'INDEX' as const,population:distinct.size,rows:ranked.slice(0,20).map(r=>r.row),failures:comparison.indexes.filter(i=>i.state!=='READ'||i.unrecognised).map(i=>i.name+' · '+(i.state==='READ'?'unrecognised entries':'index unavailable'))};
}
export async function changeApplicabilityAssessment(c:AuthorizedContext,input:unknown,read=readPublicHorizon,compare=assessOfficialIndexes):Promise<{id:string;taskId?:string}>{
 const action=assessmentAction.parse(input);
 if(action.action==='START'){
  const replay=await transaction(c,async tx=>{
   await requireMember(tx,c,ADMIN);
   const old=await tx.auditEvent.findUnique({where:{id:action.requestKey}});
   if(!old)return null;
   if(old.organizationId!==c.organizationId||old.actorId!==c.userId||old.entityType!==entity||old.action!==frozen)throw invalid('Request reference already used.');
   const existing=await detail(tx,c,old.id);if(existing.facts.scope!==action.scope||(existing.facts.profile??'scottish-pharma-wholesale')!==action.profile||(existing.facts.method??'QUEUE')!==action.method)throw invalid('Request reference already used for another site scope.');
   return {id:old.id};
  });
  if(replay)return replay;
  const report=await read();
  if(reportState(report)==='stale')throw invalid('Collect a fresh regulatory snapshot before starting this assessment.');
  const uk=report.items.filter(i=>i.observedAt===report.generatedAt&&i.publisherIds.some(p=>p!=='us-fda'&&p!=='eu-ema'&&report.feeds.some(f=>f.id===p&&f.state!=='unavailable')));
  const seed=randomUUID();
  const ranked=uk.map(i=>({id:i.id,revision:i.revision,title:i.title,url:i.url,publishers:i.publisherIds,
   suggested:Boolean(scottishPharmaReason(i,action.profile)),order:hashValue([seed,i.id,i.revision])})).sort((a,b)=>a.order.localeCompare(b.order));
  const selected=[...ranked.filter(i=>i.suggested).slice(0,10),...ranked.filter(i=>!i.suggested).slice(0,10)];
  if(action.method==='QUEUE'&&(!selected.some(i=>i.suggested)||!selected.some(i=>!i.suggested)))throw invalid('Both shortlisted and other UK publications are required to measure the review queue.');
  const shortlisted=ranked.filter(i=>i.suggested).length;
  const indexed=action.method==='INDEX'?await publisherSample(report,seed,action.profile,compare):null;
  const facts=sample.parse({profile:action.profile,method:action.method,...(indexed?{population:indexed.population}:{queuePopulation:{shortlisted,other:ranked.length-shortlisted}}),scope:action.scope,snapshot:report.generatedAt,release:report.codeCommit,unavailable:[...report.feeds.filter(f=>f.id!=='us-fda'&&f.id!=='eu-ema'&&f.state!=='available').map(f=>f.id+' · '+f.state),...(indexed?.failures??[])],rows:indexed?.rows??selected.sort((a,b)=>a.order.localeCompare(b.order))});
  return transaction(c,async tx=>{
   await requireMember(tx,c,ADMIN);
   const previous=await tx.auditEvent.findUnique({where:{id:action.requestKey}});
   if(previous){const state=await detail(tx,c,action.requestKey);if(state.first.actorId!==c.userId||state.facts.scope!==action.scope||(state.facts.profile??'scottish-pharma-wholesale')!==action.profile||(state.facts.method??'QUEUE')!==action.method)throw invalid('Request reference already used.');return {id:previous.id};}
   const scope={organizationId:c.organizationId,entityType:entity,action:frozen};
   if(await tx.auditEvent.count({where:scope})>=50)throw new IntelligenceError('This workspace has reached its 50 retained assessments.',429);
   const candidates=await tx.auditEvent.findMany({select:{id:true,details:true},take:50,where:{...scope,AND:[{details:{path:['sample','scope'],equals:facts.scope}},{details:{path:['sample','snapshot'],equals:facts.snapshot}},{details:{path:['sample','method'],equals:action.method}}]}});
   const existing=candidates.find(row=>(sample.parse((row.details as {sample:unknown}).sample).profile??'scottish-pharma-wholesale')===action.profile);
   if(existing)return {id:existing.id};
   await tx.auditEvent.create({data:{...lookup(c.organizationId,action.requestKey,frozen),id:action.requestKey,actorId:c.userId,details:{sample:facts,hash:hashValue(facts)}}});
   return {id:action.requestKey};
  });
 }
 return transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);
  const state=await detail(tx,c,action.assessmentId);
  if(action.action==='FOLLOW_UP'){
   if(!state.review||action.sampleHash!==state.hash)throw invalid('Finish the independent review before recording follow-up.');
   const row=state.facts.rows.find(r=>r.id===action.publicationId),issue=row&&correction(state,row);
   if(!row||!issue)throw invalid('Select a reviewed publication with an unresolved finding.');
   const where={organizationId_automationKey:{organizationId:c.organizationId,automationKey:issue.key}};
   const existing=await tx.obligation.findUnique({where,select:{id:true}});
   if(existing)return {id:state.first.id,taskId:existing.id};
   const today=new Date().toISOString().slice(0,10);
   if(action.dueDate<today||Date.parse(action.dueDate)-Date.parse(today)>365*86400000)throw invalid('Choose a review date within the next year.');
   const owner=await requireMember(tx,{...c,userId:action.ownerId},WRITER);
   const task=await tx.obligation.create({data:{organizationId:c.organizationId,automationKey:issue.key,assigneeId:action.ownerId,ownerName:owner.email,
    dueDate:new Date(action.dueDate+'T00:00:00Z'),title:(issue.reason+' · '+row.title).slice(0,160),category:'Regulatory applicability correction',
    sourceUrl:row.url,notes:[state.facts.scope,issue.label.reason,'Independent assessment '+state.first.id,'Publication revision '+row.revision].join('\n')},select:{id:true}});
   await tx.auditEvent.create({data:{...lookup(c.organizationId,state.first.id,'horizon.assessment_follow_up'),actorId:c.userId,details:{
    sampleHash:state.hash,reviewHash:state.review.hash,publicationId:row.id,revision:row.revision,taskId:task.id,reason:issue.reason,ownerId:action.ownerId,dueDate:action.dueDate}}});
   return {id:state.first.id,taskId:task.id};
  }
  if(c.userId===state.first.actorId)throw new IntelligenceError('A different quality reviewer must classify the publications.',403);
  if(action.sampleHash!==state.hash)throw invalid('Review the same frozen sample before submitting.');
  const byId=new Map(action.labels.map(l=>[l.id,l]));
  if(action.labels.length!==state.facts.rows.length||byId.size!==action.labels.length||state.facts.rows.some(i=>!byId.has(i.id)))throw invalid('Classify every publication in this sample exactly once.');
  const ordered=state.facts.rows.map(i=>byId.get(i.id)!),hash=hashValue(ordered);
  if(state.review){if(state.event?.actorId===c.userId&&state.review.hash===hash)return {id:state.first.id};throw invalid('This assessment already has a final review.');}
  await tx.auditEvent.create({data:{...lookup(c.organizationId,state.first.id,decided),actorId:c.userId,details:{sampleHash:state.hash,labels:ordered,hash}}});
  return {id:state.first.id};
 });
}
