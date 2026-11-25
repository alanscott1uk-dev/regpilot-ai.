import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {trialReview} from '../capability-trials';
import {siteExcursion,siteExcursionSchema} from './excursion-pilot';
import {releaseArchive} from './retained-validation';
import {siteDecision} from '../site-qualification';
import {hashValue} from '../regulatory/intelligence';
import type {AuthorizedContext} from './authorization';
import {deployedTrialRelease,loadTrial} from './capability-trial-service';
import {transaction,IntelligenceError} from './intelligence-service';
import {ADMIN,requireMember} from './workspace-member';
import {assertReviewedFiles,reviewedFiles,reviewedFilesSchema,verifyReviewedBytes} from './reviewed-files';
import type {EvidenceObjectStore} from './evidence-storage';

const entityType='SiteQualification';
const decisionRecord=z.object({input:siteDecision,basisHash:z.string(),files:reviewedFilesSchema,excursion:siteExcursionSchema.optional(),supplier:z.object({receiptId:z.uuid(),digest:z.string().regex(/^sha256:[a-f0-9]{64}$/)}).optional(),digest:z.string()});
const iso=(v:Date)=>v.toISOString();

async function inspect(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:string){
 await requireMember(tx,ctx,ADMIN);
 const trial=await loadTrial(tx,ctx,id);
 const scope=trial.plan.siteProtocol;
 if(trial.plan.track!=='site_qualification'||!scope)throw new IntelligenceError('This trial has no site qualification protocol.',404);
 const reviews=trial.reviews.map(event=>{
  const review=trialReview.parse(event.details);
  if(review.id!==id)throw new IntelligenceError('The independent review belongs to a different trial.',409);
  return {id:event.id,actor:event.actorId,at:iso(event.createdAt),decision:review.decision,notes:review.notes};
 });
 const basis={
  organizationId:ctx.organizationId,trialId:id,protocol:{...scope,intendedUse:trial.plan.intendedUse,release:trial.plan.release,environment:trial.plan.environment},
  participant:trial.start.actorId,startedAt:iso(trial.start.createdAt),finishedAt:trial.finish?iso(trial.finish.createdAt):null,
  finishRelease:trial.result?.observedRelease??null,elapsedSeconds:trial.result?.elapsedSeconds??null,
  results:trial.result?.input.results??[],testFiles:trial.result?.files??[],reviews
 };
 const basisHash=hashValue(basis),currentRelease=deployedTrialRelease(),blockers:string[]=[];
 const supplier=(await releaseArchive(tx,ctx.organizationId,trial.plan.release)).saved?.meta??null;
 if(!supplier)blockers.push('Retain the verified supplier validation ZIP for this protocol release.');
 if(trial.plan.environment!=='PROTECTED_PILOT')blockers.push('Use a protected customer pilot for the site decision.');
 if(currentRelease!==trial.plan.release)blockers.push('The deployed build differs from the release in the protocol or cannot be identified.');
 if(!trial.result)blockers.push('Finish the planned site tests.');
 else{
  if(trial.result.observedRelease!==trial.plan.release)blockers.push('The trial finished on a different or unidentified build.');
  if(scope.criteria.some(c=>!basis.results.some(r=>r.step===c.step && r.outcome==='PASS' && r.evidenceId)))blockers.push('Every planned test needs a passing observation with reviewed evidence.');
 }
 if(!reviews.length || reviews.some(r=>r.decision!=='ACCEPT'||r.actor===trial.start.actorId))blockers.push('The trial needs an independent acceptance of the observed results.');
 try{
  await requireMember(tx,{...ctx,userId:trial.start.actorId});
  for(const review of reviews)await requireMember(tx,{...ctx,userId:review.actor},ADMIN);
  await assertReviewedFiles(tx,ctx.organizationId,basis.testFiles);
 }catch(e){if(!(e instanceof IntelligenceError))throw e;blockers.push('The test evidence or the participants’ workspace permissions have changed.');}
 const events=await tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType,entityId:id,action:'site.decision'},orderBy:[{createdAt:'asc'},{id:'asc'}]});
 const decisions=events.map(e=>{
  const {digest,...record}=decisionRecord.parse(e.details);
  const contents={organizationId:ctx.organizationId,trialId:id,actor:e.actorId,...record};
  if(record.input.requestKey!==e.id || hashValue(contents)!==digest)throw new IntelligenceError('A saved site decision failed its integrity check.',409);
  return {id:e.id,at:iso(e.createdAt),...contents,digest};
 });
 const coldChain=scope.criteria.some(r=>r.step==='cold-chain');
 const excursionChoices=coldChain?await tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType:'QualityExcursion',action:'excursion.retrieve',createdAt:{gte:trial.start.createdAt},AND:[
  {details:{path:['body','reading','data','site'],equals:scope.site}},
  {details:{path:['body','qualification','release'],equals:trial.plan.release}},
  {details:{path:['body','qualification','ownership','category'],equals:'CUSTOMER'}}]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50,select:{id:true,entityId:true,createdAt:true}}):[];
 if(coldChain&&!excursionChoices.length)blockers.push('An independent assessor must retrieve a disposition from this site on the protocol release using a confirmed customer logger.');
 const issued=decisions.find(d=>d.input.decision!=='WITHDRAW');
 const withdrawn=decisions.find(d=>d.input.decision==='WITHDRAW');
 if(issued?.input.decision==='APPROVE'&&!withdrawn){
  if(coldChain){
   try{if(!issued.excursion||hashValue(await siteExcursion(tx,ctx,issued.excursion.receiptId,scope.site,trial.plan.release,trial.start.createdAt))!==hashValue(issued.excursion))blockers.push('Reassess the customer excursion supporting this approval.');}
   catch(e){if(!(e instanceof IntelligenceError))throw e;blockers.push(e.message);}
  }
  if(!issued.supplier||issued.supplier.receiptId!==supplier?.receiptId||issued.supplier.digest!==supplier?.digest)blockers.push('This site approval has no matching retained supplier release receipt.');
  if(issued.basisHash!==basisHash)blockers.push('The trial record has changed since site sign-off.');
  try{
   await requireMember(tx,{...ctx,userId:issued.actor},ADMIN);
   await assertReviewedFiles(tx,ctx.organizationId,issued.files);
  }catch(e){if(!(e instanceof IntelligenceError))throw e;blockers.push('The sign-off evidence or the recording administrator’s access has changed.');}
 }
 const status=withdrawn?'WITHDRAWN':issued?.input.decision==='WITHHOLD'?'WITHHELD':issued?blockers.length?'REASSESSMENT_REQUIRED':'APPROVED_FOR_SITE_USE':'AWAITING_DECISION';
 return {format:'regpilot-site-qualification-v1',...basis,basisHash,currentRelease,supplier,excursionChoices:excursionChoices.map(x=>({id:x.id,caseId:x.entityId,at:iso(x.createdAt)})),decisions,status,blockers};
}

export async function siteQualification(ctx:AuthorizedContext,id:string){
 return transaction(ctx,async tx=>({...await inspect(tx,ctx,id),exportedAt:new Date().toISOString()}));
}

export async function recordSiteDecision(ctx:AuthorizedContext,id:string,raw:unknown,store?:EvidenceObjectStore){
 const input=siteDecision.parse(raw);
 async function prepare(tx:Prisma.TransactionClient){
  const packet=await inspect(tx,ctx,id);
  if(ctx.userId===packet.participant)throw new IntelligenceError('A different administrator must record the site decision.',403);
  const prior=packet.decisions.find(d=>d.id===input.requestKey);
  if(prior){
   if(prior.actor!==ctx.userId||hashValue(prior.input)!==hashValue(input))throw new IntelligenceError('This reference already identifies a different decision.',409);
   return {prior:true,packet,files:prior.files,excursion:prior.excursion};
  }
  if(input.basisHash!==packet.basisHash)throw new IntelligenceError('The trial changed. Open the current site dossier before deciding.',409);
  if(await tx.auditEvent.findUnique({where:{id:input.requestKey},select:{id:true}}))throw new IntelligenceError('This request reference is already in use.',409);
  if(input.decision==='WITHDRAW'){
   if(!['APPROVED_FOR_SITE_USE','REASSESSMENT_REQUIRED'].includes(packet.status))throw new IntelligenceError('Choose an existing site approval to withdraw.',409);
  }else{
   if(packet.status!=='AWAITING_DECISION')throw new IntelligenceError('A decision is recorded. Start a new protocol for reassessment.',409);
   if(!packet.finishedAt)throw new IntelligenceError('Finish the trial, recording unavailable tests as unobserved.',409);
   if(input.decision==='APPROVE' && packet.blockers.length)throw new IntelligenceError(packet.blockers[0],409);
  }
  const files=await reviewedFiles(tx,ctx.organizationId,[input.decisionFile,input.authorityFile]);
  const decisionFile=files.find(f=>f.id===input.decisionFile)!;
  if(files[0].sha256===files[1].sha256 || packet.testFiles.some(f=>f.sha256===decisionFile.sha256) ||
     packet.decisions.some(d=>d.files.some(f=>f.id===d.input.decisionFile&&f.sha256===decisionFile.sha256)))
   throw new IntelligenceError('Select a distinct signed record for this decision.',409);
  let excursion;
  if(input.decision==='APPROVE'&&packet.protocol.criteria.some(r=>r.step==='cold-chain')){
   if(!input.excursionReceiptId)throw new IntelligenceError('Select the independently retrieved customer excursion.',409);
   excursion=await siteExcursion(tx,ctx,input.excursionReceiptId,packet.protocol.site,packet.protocol.release,new Date(packet.startedAt));
  }else if(input.excursionReceiptId)throw new IntelligenceError('Attach a customer excursion only to a cold-chain approval.',400);
  return {prior:false,packet,files,excursion};
 }
 const first=await transaction(ctx,prepare);
 if(first.prior)return {id:input.requestKey};
 const reliedOn=input.decision==='APPROVE'?[...first.packet.testFiles,...first.files,...(first.excursion?.files??[])]:first.files;
 await verifyReviewedBytes(ctx,[...new Map(reliedOn.map(file=>[file.id,file])).values()],store);
 return transaction(ctx,async tx=>{
  const current=await prepare(tx);
  if(current.prior)return {id:input.requestKey};
  if(current.packet.basisHash!==first.packet.basisHash||hashValue(first.files)!==hashValue(current.files)||hashValue(first.excursion??null)!==hashValue(current.excursion??null))
   throw new IntelligenceError('The trial or sign-off evidence changed during verification.',409);
  const retained=current.packet.supplier;
  const record={input,files:current.files,...(current.excursion?{excursion:current.excursion}:{}),basisHash:current.packet.basisHash,...(retained?{supplier:{receiptId:retained.receiptId,digest:retained.digest}}:{})};
  const digest=hashValue({organizationId:ctx.organizationId,trialId:id,actor:ctx.userId,...record});
  await tx.auditEvent.create({data:{id:input.requestKey,organizationId:ctx.organizationId,actorId:ctx.userId,entityType,entityId:id,action:'site.decision',
   details:JSON.parse(JSON.stringify({...record,digest})) as Prisma.InputJsonValue}});
  return {id:input.requestKey};
 });
}
