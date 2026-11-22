import {excursionReceipt,excursionReceipts} from './excursion-trial';
import {isExcursionTrial,isTimedPilot} from '../capability-trials';
import {trialReading,trialReadings} from './trial-readings';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {trialAction,trialCheckpoint,trialStart,trialFinish,trialReview,allTrialTracks as trialTracks} from '../capability-trials';
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
export function deployedTrialRelease(){
 const sha=process.env.VERCEL_GIT_COMMIT_SHA;
 return sha && /^[a-f0-9]{40}$/.test(sha)?sha:null;
}
const finishData=z.object({caseReceipts:z.array(excursionReceipt).optional(),observedRelease:z.string().regex(/^[a-f0-9]{40}$/).nullable().optional(),input:trialFinish,files:z.array(reviewedFileSchema),readings:z.array(trialReading).optional(),elapsedSeconds:z.number().int().nonnegative()});
export async function loadTrial(tx:Tx,c:AuthorizedContext,id:string){
 const events=await tx.auditEvent.findMany({where:{organizationId:c.organizationId,entityType,entityId:id},orderBy:[{createdAt:'asc'},{id:'asc'}]});
 const start=events.find(e=>e.action==='trial.start'),finish=events.find(e=>e.action==='trial.finish');
 if(!start)throw new IntelligenceError('Trial unavailable in this workspace',404);
 return {checkpoints:events.filter(e=>e.action==='trial.checkpoint'),start,stop:events.find(e=>e.action==='trial.stop'),plan:trialStart.parse(start.details),finish,result:finish?finishData.parse(finish.details):null,reviews:events.filter(e=>e.action==='trial.review')};
}
export async function trialWorkspace(c:AuthorizedContext,filter:{release?:string;before?:string}={}){
 const {release,before}=z.object({release:z.string().regex(/^[a-f0-9]{40}$/).optional(),before:z.uuid().optional()}).parse(filter);
 return transaction(c,async tx=>{
  const m=await requireMember(tx,c);
  const visible={organizationId:c.organizationId,entityType,action:'trial.start',
   ...(ADMIN.includes(m.role)?{}:{actorId:c.userId}),...(release?{details:{path:['release'],equals:release}}:{})};
  const anchor=before?await tx.auditEvent.findFirst({where:{...visible,id:before},select:{id:true,createdAt:true}}):null;
  if(before&&!anchor)throw new IntelligenceError('The trial history cursor is unavailable for this release',400);
  const starts=await tx.auditEvent.findMany({where:{...visible,...(anchor?{OR:[
   {createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}
  ]}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51});
  const ids=starts.slice(0,50).map(v=>v.entityId);
  const events=await tx.auditEvent.findMany({where:{organizationId:c.organizationId,entityType,entityId:{in:ids},action:{in:['trial.stop','trial.finish','trial.review','trial.checkpoint']}},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,entityId:true,actorId:true,action:true,details:true,createdAt:true}});
  const evidence=await tx.evidence.findMany({where:{organizationId:c.organizationId,scanStatus:'CLEAN',reviewStatus:'APPROVED'},select:{id:true,filename:true},orderBy:{reviewedAt:'desc'},take:100});
  const trials=[];
  for(const s of starts.slice(0,50)){
   const plan=trialStart.parse(s.details),finish=events.find(e=>e.entityId===s.entityId&&e.action==='trial.finish'),result=finish?finishData.parse(finish.details):null;
   const reviews=events.filter(e=>e.entityId===s.entityId&&e.action==='trial.review');
   const stoppedAt=events.find(e=>e.entityId===s.entityId&&e.action==='trial.stop')?.createdAt.toISOString()??null;
   // Independent reviewers cannot see one another's decisions until submitting their own.
   const own=reviews.find(r=>r.actorId===c.userId),required=plan.steps.includes('answer')?2:1;
   let current=!!result;
   if(result){try{if(plan.caseId&&hashValue(await excursionReceipts(tx,c.organizationId,plan.caseId,s.actorId,s.createdAt,stoppedAt?new Date(stoppedAt):finish!.createdAt,result.input.results))!==hashValue(result.caseReceipts??[]))throw new IntelligenceError('Case evidence changed',409);if(result.readings?.length&&hashValue(await trialReadings(tx,c.organizationId,s.actorId,s.createdAt,stoppedAt?new Date(stoppedAt):finish!.createdAt,plan.track,result.input.results))!==hashValue(result.readings))throw new IntelligenceError('Trial reading changed',409);await assertReviewedFiles(tx,c.organizationId,result.files);await requireMember(tx,{...c,userId:s.actorId});for(const r of reviews)await requireMember(tx,{...c,userId:r.actorId},ADMIN);}catch(e){if(!(e instanceof IntelligenceError))throw e;current=false;}}
   const concluded=reviews.length>=required,show=concluded||!!own||s.actorId===c.userId;
   const accepted=concluded&&current&&reviews.every(r=>trialReview.parse(r.details).decision==='ACCEPT');
   const checkpoints=events.filter(e=>e.entityId===s.entityId&&e.action==='trial.checkpoint').map(e=>{const p=trialCheckpoint.parse(e.details);return {id:e.id,step:p.step,kind:p.kind,note:p.note,at:e.createdAt.toISOString(),elapsedSeconds:Math.max(0,Math.floor((e.createdAt.getTime()-s.createdAt.getTime())/1000))};});
   trials.push({caseId:plan.caseId,caseReceipts:result?.caseReceipts??[],siteProtocol:plan.siteProtocol,firstTime:plan.firstTime===true,checkpoints,id:s.entityId,stoppedAt,track:plan.track,release:plan.release,environment:plan.environment,intendedUse:plan.intendedUse,ukExternal:plan.ukExternal,steps:plan.steps,participantId:s.actorId,startedAt:s.createdAt.toISOString(),elapsedSeconds:result?.elapsedSeconds??null,results:result?.input.results??[],comparison:result?.input.comparison??null,current,reviewCount:reviews.length,required,accepted,reviewDecisions:show?reviews.map(r=>trialReview.parse(r.details).decision):[],canReview:ADMIN.includes(m.role)&&!!result&&current&&s.actorId!==c.userId&&!own&&!concluded,canFinish:!result&&s.actorId===c.userId});
  }
  const activeControl=await tx.managedControl.findFirst({where:{organizationId:c.organizationId,enabled:true},select:{id:true}});
  return {deployedRelease:deployedTrialRelease(),organizationId:c.organizationId,hasActiveControl:!!activeControl,canManage:ADMIN.includes(m.role),trials,evidence,limited:starts.length>50,nextCursor:starts.length>50?starts[49].id:null};
 });
}
export async function recordTrial(c:AuthorizedContext,raw:unknown,store?:EvidenceObjectStore){
 const d=trialAction.parse(raw);
 if(d.action==='START')return transaction(c,async tx=>{
  await requireMember(tx,c);
  if((d.track==='operator_pilot'||d.track==='excursion_operator')&&d.firstTime!==true)throw new IntelligenceError('The participant must confirm this is their first operator run.',400);
  if(new Set(d.steps).size!==d.steps.length||d.steps.some(step=>!trialTracks[d.track].steps.some(s=>s.id===step))||d.environment==='FIXTURE'&&d.ukExternal)throw new IntelligenceError('Choose distinct tasks in this track and the actual environment',400);
  const prior=await tx.auditEvent.findFirst({where:{organizationId:c.organizationId,entityType,entityId:d.requestKey,action:'trial.start'}});
  if(prior){if(prior.actorId!==c.userId||hashValue(prior.details)!==hashValue(d))throw new IntelligenceError('This trial key is already in use',409);return {id:prior.entityId};}
  if(isExcursionTrial(d.track)!==Boolean(d.caseId))throw new IntelligenceError('Choose the assigned quality case for an excursion trial.',400);
  if(d.caseId){
   const member=await requireMember(tx,c);
   const row=await tx.qualityCase.findFirst({where:{id:d.caseId,organizationId:c.organizationId,kind:'DEVIATION'}});
   if(!row)throw new IntelligenceError('Assigned deviation unavailable in this workspace.',404);
   if(d.track==='excursion_assessor'&&!ADMIN.includes(member.role)||!ADMIN.includes(member.role)&&row.ownerId!==c.userId&&row.createdById!==c.userId)throw new IntelligenceError('Choose a case available to your participant role.',403);
   if(d.track==='excursion_operator'&&await tx.auditEvent.findFirst({where:{organizationId:c.organizationId,entityType,actorId:c.userId,action:'trial.start',details:{path:['track'],equals:'excursion_operator'}}}))throw new IntelligenceError('A first-time excursion trial already exists for this participant.',409);
  }
  if(d.track==='site_qualification'){
   if(!d.siteProtocol || d.siteProtocol.criteria.length!==d.steps.length || !d.steps.every(id=>d.siteProtocol!.criteria.some(criterion=>criterion.step===id)))
    throw new IntelligenceError('Set an acceptance criterion for every selected site test.',400);
   if(!deployedTrialRelease() || d.release!==deployedTrialRelease())throw new IntelligenceError('Start the site protocol on its identified deployed release.',409);
  }else if(d.siteProtocol)throw new IntelligenceError('Choose the site qualification track to attach a site protocol.',400);
  if(await tx.auditEvent.count({where:{organizationId:c.organizationId,entityType,action:'trial.start',createdAt:{gt:new Date(Date.now()-86400000)}}})>=60)throw new IntelligenceError('The daily trial limit has been reached',429);
  await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType,entityId:d.requestKey,action:'trial.start',details:data(d)}});return {id:d.requestKey};
 });
 if(d.action==='CHECKPOINT')return transaction(c,async tx=>{
  await requireMember(tx,c);const t=await loadTrial(tx,c,d.id);
  if(t.start.actorId!==c.userId||!t.plan.steps.includes(d.step))throw new IntelligenceError('Only this participant can log the selected task.',403);
  const duplicate=await tx.auditEvent.findUnique({where:{id:d.key}});
  if(duplicate){if(duplicate.organizationId!==c.organizationId||duplicate.entityType!==entityType||duplicate.entityId!==d.id||duplicate.actorId!==c.userId||duplicate.action!=='trial.checkpoint'||hashValue(duplicate.details)!==hashValue(d))throw new IntelligenceError('Checkpoint reference already used',409);return {id:d.id};}
  if(t.stop||t.finish||t.checkpoints.length>=100)throw new IntelligenceError('The trial timer has stopped or the checkpoint limit has been reached.',409);
  await tx.auditEvent.create({data:{id:d.key,organizationId:c.organizationId,entityType,entityId:d.id,actorId:c.userId,action:'trial.checkpoint',details:data(d)}});return {id:d.id};
 });
 if(d.action==='STOP')return transaction(c,async tx=>{
  await requireMember(tx,c);
  const t=await loadTrial(tx,c,d.id);
  if(t.start.actorId!==c.userId)throw new IntelligenceError('Only the participant can stop the task timer',403);
  if(t.stop)return {id:d.id};
  if(t.finish)throw new IntelligenceError('This trial has already finished',409);
  await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType,entityId:d.id,action:'trial.stop',details:{}}});
  return {id:d.id};
 });
 const prepare=async(tx:Tx)=>{
  await requireMember(tx,c,d.action==='REVIEW'?ADMIN:undefined);
  const t=await loadTrial(tx,c,d.id);
  if(d.action==='FINISH'){
   if(t.start.actorId!==c.userId)throw new IntelligenceError('Only the participant can finish their trial',403);
   if(t.result){if(hashValue(t.result.input)!==hashValue(d))throw new IntelligenceError('A different result was already submitted',409);return {t,files:t.result.files,exists:true};}
   if(t.plan.caseId&&!t.stop)throw new IntelligenceError('Stop the timer before submitting the excursion results.',409);
   if(isTimedPilot(t.plan.track)){
    for(const r of d.results){
     const marks=t.checkpoints.map(e=>trialCheckpoint.parse(e.details)).filter(p=>p.step===r.step);
     if(r.outcome!=='UNOBSERVED'&&!marks.some(p=>p.kind===(r.outcome==='PASS'?'COMPLETED':'BLOCKED')))throw new IntelligenceError('Record a timed completion or blockage for each observed task.',409);
     if(marks.filter(p=>p.kind==='CORRECTION').length>r.edits)throw new IntelligenceError('Include the corrections recorded during this task.',409);
     if(marks.some(p=>p.kind==='HELP')&&!r.assisted)throw new IntelligenceError('Include the help recorded during this task.',409);
    }
   }
   const readings=await trialReadings(tx,c.organizationId,c.userId,t.start.createdAt,t.stop?.createdAt??now(),t.plan.track,d.results);
   const caseReceipts=await excursionReceipts(tx,c.organizationId,t.plan.caseId,c.userId,t.start.createdAt,t.stop?.createdAt??now(),d.results);
   if(t.plan.steps.length!==d.results.length||t.plan.steps.some(k=>d.results.filter(r=>r.step===k).length!==1)||d.results.some(r=>r.outcome==='PASS'&&!r.evidenceId&&!readings.some(x=>x.step===r.step)&&!caseReceipts.some(x=>x.step===r.step)))throw new IntelligenceError('Record every selected task and attach reviewed evidence to each passing result',400);
   if(d.comparison&&!t.stop)throw new IntelligenceError('Stop the task timer before recording a comparison',409);
   const ids=[...new Set([...d.results.flatMap(r=>r.evidenceId?[r.evidenceId]:[]),...(d.comparison?[d.comparison.evidenceId]:[])])];return {t,readings,caseReceipts,files:await reviewedFiles(tx,c.organizationId,ids),exists:false};
  }
  if(!t.result||t.start.actorId===c.userId)throw new IntelligenceError('A different administrator must review the finished run',403);
  const prior=t.reviews.find(r=>r.actorId===c.userId);
  if(prior){if(hashValue(prior.details)!==hashValue(d))throw new IntelligenceError('An independent decision is already recorded',409);return {t,files:t.result.files,exists:true};}
  if(t.reviews.length>=(t.plan.steps.includes('answer')?2:1))throw new IntelligenceError('The required independent decisions have already been recorded',409);
  if(d.decision==='ACCEPT'){
   if(t.plan.caseId&&hashValue(await excursionReceipts(tx,c.organizationId,t.plan.caseId,t.start.actorId,t.start.createdAt,t.stop!.createdAt,t.result.input.results))!==hashValue(t.result.caseReceipts??[]))throw new IntelligenceError('Case evidence changed before assessment',409);
   await assertReviewedFiles(tx,c.organizationId,t.result.files);
   if(t.result.readings?.length&&hashValue(await trialReadings(tx,c.organizationId,t.start.actorId,t.start.createdAt,t.stop?.createdAt??t.finish!.createdAt,t.plan.track,t.result.input.results))!==hashValue(t.result.readings))throw new IntelligenceError('Trial reading changed before assessment',409);
  }
  return {t,files:t.result.files,exists:false};
 }
 const first=await transaction(c,prepare);if(first.exists)return {id:d.id};
 if(d.action==='FINISH'||d.decision==='ACCEPT')await verifyReviewedBytes(c,first.files,store);
 return transaction(c,async tx=>{
  const after=await prepare(tx);if(after.exists)return {id:d.id};if(hashValue([after.files,after.readings??[],after.caseReceipts??[]])!==hashValue([first.files,first.readings??[],first.caseReceipts??[]]))throw new IntelligenceError('The evidence changed during review',409);
  const details=d.action==='FINISH'?{...(after.t.plan.siteProtocol?{observedRelease:deployedTrialRelease()}:{}),input:d,files:after.files,...(after.t.plan.caseId?{caseReceipts:after.caseReceipts??[]}:{}),readings:after.readings??[],elapsedSeconds:Math.max(0,Math.floor(((after.t.stop?.createdAt??now()).getTime()-after.t.start.createdAt.getTime())/1000))}:d;
  await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType,entityId:d.id,action:d.action==='FINISH'?'trial.finish':'trial.review',details:data(details)}});return {id:d.id};
 });
}
