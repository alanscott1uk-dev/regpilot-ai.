import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {trialAction,trialStart,trialFinish,trialReview,trialTracks} from '../capability-trials';
import {hashValue} from '../regulatory/intelligence';
import {IntelligenceError,transaction} from './intelligence-service';
import {requireMember,ADMIN} from './workspace-member';
import {reviewedFiles,reviewedFileSchema,assertReviewedFiles,verifyReviewedBytes} from './reviewed-files';
import type {AuthorizedContext} from './authorization';
import type {EvidenceObjectStore} from './evidence-storage';
const entityType='CapabilityTrial';
type Tx=Prisma.TransactionClient;
const data=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
const now=()=>new Date();
const finishData=z.object({input:trialFinish,files:z.array(reviewedFileSchema),elapsedSeconds:z.number().int().nonnegative()});
async function load(tx:Tx,c:AuthorizedContext,id:string){
 const events=await tx.auditEvent.findMany({where:{organizationId:c.organizationId,entityType,entityId:id},orderBy:[{createdAt:'asc'},{id:'asc'}]});
 const start=events.find(e=>e.action==='trial.start'),finish=events.find(e=>e.action==='trial.finish');
 if(!start)throw new IntelligenceError('Trial unavailable in this workspace',404);
 return {start,plan:trialStart.parse(start.details),finish,result:finish?finishData.parse(finish.details):null,reviews:events.filter(e=>e.action==='trial.review')};
}
export async function trialWorkspace(c:AuthorizedContext){
 return transaction(c,async tx=>{
  const m=await requireMember(tx,c);
  const starts=await tx.auditEvent.findMany({where:{organizationId:c.organizationId,entityType,action:'trial.start',...(ADMIN.includes(m.role)?{}:{actorId:c.userId})},orderBy:{createdAt:'desc'},take:51});
  const ids=starts.slice(0,50).map(v=>v.entityId);
  const events=await tx.auditEvent.findMany({where:{organizationId:c.organizationId,entityType,entityId:{in:ids},action:{in:['trial.finish','trial.review']}},select:{entityId:true,actorId:true,action:true,details:true,createdAt:true}});
  const evidence=await tx.evidence.findMany({where:{organizationId:c.organizationId,scanStatus:'CLEAN',reviewStatus:'APPROVED'},select:{id:true,filename:true},orderBy:{reviewedAt:'desc'},take:100});
  const trials=[];
  for(const s of starts.slice(0,50)){
   const plan=trialStart.parse(s.details),finish=events.find(e=>e.entityId===s.entityId&&e.action==='trial.finish'),result=finish?finishData.parse(finish.details):null;
   const reviews=events.filter(e=>e.entityId===s.entityId&&e.action==='trial.review');
   // Independent reviewers cannot see one another's decisions until submitting their own.
   const own=reviews.find(r=>r.actorId===c.userId),required=plan.steps.includes('answer')?2:1;
   let current=!!result;
   if(result){try{await assertReviewedFiles(tx,c.organizationId,result.files);await requireMember(tx,{...c,userId:s.actorId});for(const r of reviews)await requireMember(tx,{...c,userId:r.actorId},ADMIN);}catch(e){if(!(e instanceof IntelligenceError))throw e;current=false;}}
   const concluded=reviews.length>=required,show=concluded||!!own||s.actorId===c.userId;
   const accepted=concluded&&current&&reviews.every(r=>trialReview.parse(r.details).decision==='ACCEPT');
   trials.push({id:s.entityId,track:plan.track,release:plan.release,environment:plan.environment,intendedUse:plan.intendedUse,ukExternal:plan.ukExternal,steps:plan.steps,participantId:s.actorId,startedAt:s.createdAt.toISOString(),elapsedSeconds:result?.elapsedSeconds??null,results:result?.input.results??[],current,reviewCount:reviews.length,required,accepted,reviewDecisions:show?reviews.map(r=>trialReview.parse(r.details).decision):[],canReview:ADMIN.includes(m.role)&&!!result&&current&&s.actorId!==c.userId&&!own&&!concluded,canFinish:!result&&s.actorId===c.userId});
  }
  return {organizationId:c.organizationId,canManage:ADMIN.includes(m.role),trials,evidence,limited:starts.length>50};
 });
}
export async function recordTrial(c:AuthorizedContext,raw:unknown,store?:EvidenceObjectStore){
 const d=trialAction.parse(raw);
 if(d.action==='START')return transaction(c,async tx=>{
  await requireMember(tx,c);
  if(new Set(d.steps).size!==d.steps.length||d.steps.some(step=>!trialTracks[d.track].steps.some(s=>s.id===step))||d.environment==='FIXTURE'&&d.ukExternal)throw new IntelligenceError('Choose distinct tasks in this track and the actual environment',400);
  const prior=await tx.auditEvent.findFirst({where:{organizationId:c.organizationId,entityType,entityId:d.requestKey,action:'trial.start'}});
  if(prior){if(prior.actorId!==c.userId||hashValue(prior.details)!==hashValue(d))throw new IntelligenceError('This trial key is already in use',409);return {id:prior.entityId};}
  if(await tx.auditEvent.count({where:{organizationId:c.organizationId,entityType,action:'trial.start',createdAt:{gt:new Date(Date.now()-86400000)}}})>=60)throw new IntelligenceError('The daily trial limit has been reached',429);
  await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType,entityId:d.requestKey,action:'trial.start',details:data(d)}});return {id:d.requestKey};
 });
 const prepare=async(tx:Tx)=>{
  await requireMember(tx,c,d.action==='REVIEW'?ADMIN:undefined);
  const t=await load(tx,c,d.id);
  if(d.action==='FINISH'){
   if(t.start.actorId!==c.userId)throw new IntelligenceError('Only the participant can finish their trial',403);
   if(t.result){if(hashValue(t.result.input)!==hashValue(d))throw new IntelligenceError('A different result was already submitted',409);return {t,files:t.result.files,exists:true};}
   if(t.plan.steps.length!==d.results.length||t.plan.steps.some(k=>d.results.filter(r=>r.step===k).length!==1)||d.results.some(r=>r.outcome==='PASS'&&!r.evidenceId))throw new IntelligenceError('Record every selected task and attach reviewed evidence to each passing result',400);
   const ids=[...new Set(d.results.flatMap(r=>r.evidenceId?[r.evidenceId]:[]))];return {t,files:await reviewedFiles(tx,c.organizationId,ids),exists:false};
  }
  if(!t.result||t.start.actorId===c.userId)throw new IntelligenceError('A different administrator must review the finished run',403);
  const prior=t.reviews.find(r=>r.actorId===c.userId);
  if(prior){if(hashValue(prior.details)!==hashValue(d))throw new IntelligenceError('An independent decision is already recorded',409);return {t,files:t.result.files,exists:true};}
  if(t.reviews.length>=(t.plan.steps.includes('answer')?2:1))throw new IntelligenceError('The required independent decisions have already been recorded',409);
  if(d.decision==='ACCEPT')await assertReviewedFiles(tx,c.organizationId,t.result.files);
  return {t,files:t.result.files,exists:false};
 }
 const first=await transaction(c,prepare);if(first.exists)return {id:d.id};
 if(d.action==='FINISH'||d.decision==='ACCEPT')await verifyReviewedBytes(c,first.files,store);
 return transaction(c,async tx=>{
  const after=await prepare(tx);if(after.exists)return {id:d.id};if(hashValue(after.files)!==hashValue(first.files))throw new IntelligenceError('The evidence changed during review',409);
  const details=d.action==='FINISH'?{input:d,files:after.files,elapsedSeconds:Math.max(0,Math.floor((now().getTime()-after.t.start.createdAt.getTime())/1000))}:d;
  await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType,entityId:d.id,action:d.action==='FINISH'?'trial.finish':'trial.review',details:data(details)}});return {id:d.id};
 });
}
