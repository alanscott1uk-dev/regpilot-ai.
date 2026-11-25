import {z} from 'zod';
import {temperatureHistory,temperatureCsv} from '../excursion-history';
import {captureTemperatureHistory,verifyTemperatureHistory} from './excursion-history';
import {Prisma,type QualityCase} from '@prisma/client';
import type {AuthorizedContext} from './authorization';
import {ADMIN,WRITER,requireMember} from './workspace-member';
import {transaction,IntelligenceError} from './intelligence-service';
import {hashValue} from '../regulatory/intelligence';
import {verifiedObservation} from './connector-observation';
import {calibrationStillCurrent} from './logger-calibration';
import {isTemperatureLogger,loggerProviders} from '../connectors/record-catalogue';
import {readRecordKeys} from '../connectors/operational-records';
import {reviewedFiles,reviewedFilesSchema,assertReviewedFiles,verifyReviewedBytes} from './reviewed-files';
import {archiveFilename,makeAuditZip} from '../audit-archive';
import {sourceOwnership} from './customer-source-proof';
import {deployedTrialRelease} from './capability-trial-service';
import {downloadEvidence} from './evidence-service';
import type {ReviewedFile} from './reviewed-files';
import type {EvidenceObjectStore} from './evidence-storage';

const text=z.string().trim().min(2).max(140);
const base={requestKey:z.uuid(),version:z.number().int().positive()};
const link=z.object({...base,action:z.literal('LINK'),runId:z.uuid(),site:text,stock:z.array(text).min(1).max(50).refine(a=>new Set(a).size===a.length),stockEvidenceId:z.uuid()}).strict();
const decide=z.object({...base,action:z.literal('DECIDE'),disposition:z.enum(['QUARANTINE','RETURN','REJECT','RELEASE']),sourceRef:text,signatory:text,
 decidedAt:z.iso.datetime(),rationale:z.string().trim().min(20).max(1500),decisionEvidenceId:z.uuid(),authorityEvidenceId:z.uuid(),confirmed:z.literal(true)}).strict();
const retrieve=z.object({...base,action:z.literal('RETRIEVE')}).strict();
export const excursionInput=z.discriminatedUnion('action',[link,decide,retrieve]);
const entityType='QualityExcursion';
const pack=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
type Tx=Prisma.TransactionClient;
const problem=(message:string)=>new IntelligenceError(message,409);
const basis=(r:QualityCase)=>({caseId:r.id,cycle:r.cycle,occurredOn:r.occurredAt.toISOString().slice(0,10),impact:r.impact,containment:r.containment,investigation:r.investigationNotes,rootCause:r.rootCause});
const attachment=z.object({runId:z.uuid(),connectorId:z.uuid(),resultHash:z.string(),signalHash:z.string(),provider:z.enum(loggerProviders).optional(),channel:z.string(),serial:z.string(),sampleAt:z.iso.datetime(),temperature:z.string(),
 calibration:z.string(),calibrationApprovalId:z.uuid().optional(),calibrationApproverId:z.uuid().optional(),site:text,stock:z.array(text),stockEvidenceId:z.uuid(),files:reviewedFilesSchema});
const decision=z.object({disposition:decide.shape.disposition,sourceRef:text,signatory:text,decidedAt:z.iso.datetime(),rationale:z.string(),decisionEvidenceId:z.uuid(),authorityEvidenceId:z.uuid(),
 files:reviewedFilesSchema,history:temperatureHistory.optional(),basisHash:z.string(),attachmentHash:z.string(),investigation:z.string(),rootCause:z.string()});
const envelope=z.object({cycle:z.number(),requestHash:z.string(),body:z.unknown(),digest:z.string()});
async function caseRow(tx:Tx,c:AuthorizedContext,id:string){
 const row=await tx.qualityCase.findFirst({where:{organizationId:c.organizationId,id}});
 if(!row)throw new IntelligenceError('Quality case unavailable',404);
 return row;
}
async function records(tx:Tx,row:QualityCase){
 const where={organizationId:row.organizationId,entityType,entityId:row.id,details:{path:['cycle'],equals:row.cycle}};
 const events=await tx.auditEvent.findMany({where,orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,action:true,actorId:true,createdAt:true,details:true},take:103});
 function validated<S extends z.ZodType>(name:string,schema:S){
  const e=events.find(e=>e.action===name);if(!e)return null;
  const p=envelope.safeParse(e.details);if(!p.success||p.data.digest!==hashValue(p.data.body))throw problem('Stored excursion evidence failed its integrity check.');
  return {id:e.id,actorId:e.actorId,at:e.createdAt.toISOString(),hash:p.data.digest,data:schema.parse(p.data.body) as z.infer<S>};
 }
 return {reading:validated('excursion.link',attachment),disposition:validated('excursion.decide',decision),
  retrieved:events.filter(e=>e.action==='excursion.retrieve').map(e=>({id:e.id,actorId:e.actorId,at:e.createdAt.toISOString()}))};
}
async function checkSource(tx:Tx,row:QualityCase,reading:z.infer<typeof attachment>){
 const run=await tx.connectorRun.findFirst({where:{organizationId:row.organizationId,connectorId:reading.connectorId,id:reading.runId}});
 if(!run||run.resultHash!==reading.resultHash||run.signalHash!==reading.signalHash||!verifiedObservation(run))throw problem('The linked logger reading could not be verified.');
 await assertReviewedFiles(tx,row.organizationId,reading.files);
}
type LoggerRun=Prisma.ConnectorRunGetPayload<{include:{connector:true}}>;
const londonDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
async function qualifiedReading(tx:Tx,row:QualityCase,run:LoggerRun|null){
 const observation=verifiedObservation(run);
 const sample=observation?.checks.find(check=>check.id==='logger-fresh'&&check.status==='PASS');
 const temperature=observation?.checks.find(check=>check.id==='logger-temperature'&&check.status==='FAIL');
 const certificate=observation?.checks.find(check=>check.id==='logger-calibration'&&check.status==='PASS');
 if(!run||!isTemperatureLogger(run.connector.provider)||!observation||!sample||!temperature||!certificate||run.configVersion!==run.connector.version)
  throw problem('Select an out-of-range reading with a verified instrument and reviewed calibration.');
 const time=new Date(sample.observed);
 if(!Number.isFinite(time.getTime())||londonDay.format(time)!==basis(row).occurredOn)
  throw problem('Choose a reading from the UK occurrence date recorded on this deviation.');
 if(!await calibrationStillCurrent(tx,run.connector,observation))throw problem('Review the current instrument calibration.');
 const keys=readRecordKeys(run.connector.provider,run.connector.repository,run.connector.branch);
 const approval=z.uuid().safeParse(certificate.observed.split(' · instrument review ').at(-1));
 const reviewer=approval.success?await tx.auditEvent.findFirst({where:{id:approval.data,organizationId:row.organizationId,entityType:'EvidenceConnector',entityId:run.connectorId,action:'logger.calibration-approved'},select:{actorId:true}}):null;
 if(!approval.success||!reviewer?.actorId)throw problem('A verified instrument review is required for this reading.');
 return {runId:run.id,connectorId:run.connectorId,resultHash:run.resultHash,signalHash:run.signalHash,provider:run.connector.provider,channel:keys.scope,serial:keys.record,
  sampleAt:sample.observed,temperature:temperature.observed,calibration:certificate.observed,certificateId:keys.reference!.split('/')[0],calibrationApprovalId:approval.data,calibrationApproverId:reviewer.actorId};
}
async function matchingReadings(tx:Tx,row:QualityCase){
 const day=row.occurredAt.getTime(),hour=3600000;
 // The longest accepted logger freshness window is one day. Include the UK midnight offset.
 const runs=await tx.connectorRun.findMany({where:{organizationId:row.organizationId,connector:{provider:{in:[...loggerProviders]}},outcome:'FOLLOW_UP',
  capturedAt:{gte:new Date(day-2*hour),lt:new Date(day+49*hour)}},orderBy:[{capturedAt:'desc'},{id:'desc'}],take:41,include:{connector:true}});
 const readings=[];
 for(const run of runs.slice(0,40)){
  try{const {runId,provider,serial,channel,sampleAt,temperature}=await qualifiedReading(tx,row,run);readings.push({runId,provider,serial,channel,sampleAt,temperature});}
  catch(err){if(!(err instanceof IntelligenceError)||err.status!==409)throw err;}
 }
 return {readings,limited:runs.length>40};
}
export async function excursionWorkspace(c:AuthorizedContext,id:string){
 return transaction(c,async tx=>{
  const actor=await requireMember(tx,c),row=await caseRow(tx,c,id);
  if(!ADMIN.includes(actor.role)&&row.ownerId!==c.userId&&row.createdById!==c.userId)throw new IntelligenceError('Excursion evidence is restricted to the case team.',403);
  const chain=await records(tx,row);
  let issue:string|null=null;
  try{if(chain.reading)await checkSource(tx,row,chain.reading.data);
   if(chain.disposition){
    if(chain.reading&&chain.disposition.data.history)await verifyTemperatureHistory(tx,c.organizationId,chain.reading.data,chain.disposition.data.history);
    await assertReviewedFiles(tx,c.organizationId,chain.disposition.data.files);
    if(chain.disposition.data.attachmentHash!==chain.reading?.hash||chain.disposition.data.basisHash!==hashValue(basis(row)))throw problem('The investigation has changed since disposition. Review the signed source record.');}
  }catch(e){if(!(e instanceof IntelligenceError))throw e;issue=e.message;}
  const candidates=WRITER.includes(actor.role)&&row.kind==='DEVIATION'&&row.status!=='CLOSED'&&!chain.reading?await matchingReadings(tx,row):{readings:[],limited:false};
  return {caseId:id,version:row.version,cycle:row.cycle,...chain,issue,candidates};
 });
}
async function processExcursion(c:AuthorizedContext,id:string,raw:unknown,store?:EvidenceObjectStore,collect?: (files:ReviewedFile[])=>Promise<void>){
 const d=excursionInput.parse(raw),action='excursion.'+d.action.toLowerCase(),requestHash=hashValue({id,input:d});
 const prepare=async(tx:Tx)=>{
  const member=await requireMember(tx,c,d.action==='LINK'?WRITER:ADMIN),row=await caseRow(tx,c,id);
  if(!ADMIN.includes(member.role)&&row.ownerId!==c.userId&&row.createdById!==c.userId)throw new IntelligenceError('The investigator must link this reading.',403);
  const prior=await tx.auditEvent.findUnique({where:{id:d.requestKey}});
  if(prior&&(prior.organizationId!==c.organizationId||prior.actorId!==c.userId||prior.entityType!==entityType||prior.entityId!==id||prior.action!==action||envelope.safeParse(prior.details).data?.requestHash!==requestHash))throw problem('This request reference is already in use.');
  if(!prior&&row.version!==d.version)throw problem('The investigation changed. Refresh this case.');
  const chain=await records(tx,row);
  if(row.kind!=='DEVIATION'||(d.action!=='RETRIEVE'&&row.status==='CLOSED'&&!prior))throw problem('Select an open deviation for this investigation.');
  if(d.action==='LINK'){
   if(prior&&chain.reading?.id===prior.id)return {row,prior,body:chain.reading.data,files:chain.reading.data.files};
   if(chain.reading||prior)throw problem('An excursion has already been linked in this investigation cycle.');
   const run=await tx.connectorRun.findFirst({where:{id:d.runId,organizationId:c.organizationId,connector:{provider:{in:[...loggerProviders]}}},include:{connector:true}});
   const reading=await qualifiedReading(tx,row,run);
   if(reading.certificateId===d.stockEvidenceId)throw problem('Select separate evidence identifying the affected stock.');
   const {certificateId,...measurement}=reading;
   const files=await reviewedFiles(tx,c.organizationId,[certificateId,d.stockEvidenceId]);
   const body=attachment.parse({...measurement,site:d.site,stock:d.stock,stockEvidenceId:d.stockEvidenceId,files});
   return {row,prior,body,files};
  }
  if(!chain.reading)throw problem('Link the calibrated reading and affected stock first.');
  await checkSource(tx,row,chain.reading.data);
  if(d.action==='DECIDE'){
   if(prior&&chain.disposition?.id===prior.id)return {row,prior,body:chain.disposition.data,files:chain.disposition.data.files};
   if(chain.disposition||prior)throw problem('This cycle already has a disposition.');
   if(chain.reading.actorId===c.userId||!row.investigationNotes.trim()||!row.rootCause.trim())throw problem('Complete the investigation and have a separate quality administrator verify the authorised disposition.');
   if(Date.parse(d.decidedAt)<Date.parse(chain.reading.data.sampleAt)||Date.parse(d.decidedAt)>Date.now())throw problem('The signed decision time must fall between the reading and now.');
   const docIds=[d.decisionEvidenceId,d.authorityEvidenceId];if(new Set([...docIds,...chain.reading.data.files.map(f=>f.id)]).size!==docIds.length+chain.reading.data.files.length)throw problem('Choose separate signed decision and delegation records.');
   const files=await reviewedFiles(tx,c.organizationId,docIds);
   const history=await captureTemperatureHistory(tx,c.organizationId,chain.reading.data,d.decidedAt);
   const body=decision.parse({...d,files,history,basisHash:hashValue(basis(row)),attachmentHash:chain.reading.hash,investigation:row.investigationNotes,rootCause:row.rootCause});
   return {row,prior,body,files:[...chain.reading.data.files,...files]};
  }
  const decided=chain.disposition;
  if(!decided||decided.data.basisHash!==hashValue(basis(row))||decided.data.attachmentHash!==chain.reading.hash)throw problem('A current, verified disposition is required for independent retrieval.');
  if(!chain.reading.data.calibrationApproverId)throw problem('The independent instrument reviewer is missing from this record.');
  if([row.createdById,row.ownerId,decided.actorId,chain.reading.actorId,chain.reading.data.calibrationApproverId,...chain.reading.data.files.flatMap(f=>[f.uploadedById,f.reviewerId]),...decided.data.files.flatMap(f=>[f.uploadedById,f.reviewerId])].includes(c.userId))throw new IntelligenceError('A separate assessor must retrieve the investigation.',403);
  await assertReviewedFiles(tx,c.organizationId,decided.data.files);
  if(decided.data.history)await verifyTemperatureHistory(tx,c.organizationId,chain.reading.data,decided.data.history);
  const core={reading:chain.reading,disposition:decided,investigation:basis(row)};
  // Preserve the original build and source declaration for an exact replay.
  const existing=prior?envelope.parse(prior.details):null;
  const source=await tx.connectorRun.findFirst({where:{id:chain.reading.data.runId,organizationId:c.organizationId},include:{connector:true}});
  const ownership=source&&source.configVersion===source.connector.version?await sourceOwnership(tx,c,source.connector):null;
  const priorProof=existing?z.object({qualification:z.unknown().optional()}).parse(existing.body).qualification:undefined;
  const qualification=existing?priorProof:{release:deployedTrialRelease(),ownership};
  const body={...core,...(qualification===undefined?{}:{qualification})};
  if(existing&&hashValue(body)!==existing.digest)throw problem('The independently retrieved case has changed.');
  return {row,prior,body,files:[...chain.reading.data.files,...decided.data.files]};
 };
 const first=await transaction(c,prepare);
 if(collect)await collect(first.files);else await verifyReviewedBytes(c,first.files,store);
 return transaction(c,async tx=>{
  const checked=await prepare(tx);
  if(hashValue(checked.body)!==hashValue(first.body))throw problem('The evidence changed during verification.');
  const digest=hashValue(checked.body);
  if(!checked.prior){
   if(d.action==='RETRIEVE'){
    const existing=await tx.auditEvent.findFirst({where:{organizationId:c.organizationId,entityType,entityId:id,actorId:c.userId,action,details:{path:['digest'],equals:digest}},select:{id:true}});
    if(existing)return {receiptId:existing.id,caseId:id,cycle:checked.row.cycle,digest,record:checked.body};
   }else{
    const saved=await tx.qualityCase.updateMany({where:{organizationId:c.organizationId,id,version:d.version},data:{version:{increment:1}}});
    if(saved.count!==1)throw problem('Refresh the investigation before recording this change.');
    await tx.qualityEffectiveness.updateMany({where:{organizationId:c.organizationId,caseId:id,status:'PENDING'},data:{status:'SUPERSEDED',version:{increment:1}}});
   }
   await tx.auditEvent.create({data:{id:d.requestKey,organizationId:c.organizationId,entityId:id,entityType,actorId:c.userId,action,details:pack({requestHash,cycle:checked.row.cycle,digest,body:checked.body})}});
  }
  return {receiptId:d.requestKey,caseId:id,cycle:checked.row.cycle,digest,record:checked.body};
 });
}

const qualifiedContext=z.object({release:z.string().regex(/^[a-f0-9]{40}$/),ownership:z.object({id:z.uuid(),actor:z.uuid(),category:z.literal('CUSTOMER'),scopeHash:z.string(),version:z.number().int().positive()})});
export const siteExcursionSchema=z.object({receiptId:z.uuid(),caseId:z.uuid(),digest:z.string(),assessorId:z.uuid(),at:z.iso.datetime(),site:text,provider:z.enum(loggerProviders).optional(),channel:z.string().optional(),serial:z.string(),temperature:z.string(),sampleAt:z.iso.datetime(),stock:z.array(text),disposition:decide.shape.disposition,sourceRef:text,stockEvidenceId:z.uuid(),decisionEvidenceId:z.uuid(),authorityEvidenceId:z.uuid(),history:temperatureHistory.optional(),qualification:qualifiedContext,files:reviewedFilesSchema});
export async function siteExcursion(tx:Tx,c:AuthorizedContext,receiptId:string,site:string,release:string,since:Date){
 const event=await tx.auditEvent.findFirst({where:{id:receiptId,organizationId:c.organizationId,entityType,action:'excursion.retrieve',createdAt:{gte:since}}});
 if(!event?.actorId)throw problem('Select an independent excursion retrieval for this site protocol.');
 const p=envelope.parse(event.details),row=await caseRow(tx,c,event.entityId);
 const {reading,disposition}=await records(tx,row);
 const proof=qualifiedContext.safeParse(z.object({qualification:z.unknown().optional()}).parse(p.body).qualification);
 if(!proof.success||proof.data.release!==release||!reading||!disposition||p.cycle!==row.cycle||reading.data.site!==site||
    hashValue({reading,disposition,investigation:basis(row),qualification:proof.data})!==p.digest||hashValue(p.body)!==p.digest)
  throw problem('The retrieval must match this site, release, independently confirmed customer logger and current investigation.');
 await checkSource(tx,row,reading.data);await assertReviewedFiles(tx,c.organizationId,disposition.data.files);
 if(disposition.data.history)await verifyTemperatureHistory(tx,c.organizationId,reading.data,disposition.data.history);
 return siteExcursionSchema.parse({...(disposition.data.history?{history:disposition.data.history}:{}),receiptId,caseId:row.id,digest:p.digest,assessorId:event.actorId,at:event.createdAt.toISOString(),site,...(reading.data.provider?{provider:reading.data.provider,channel:reading.data.channel}:{}),serial:reading.data.serial,temperature:reading.data.temperature,sampleAt:reading.data.sampleAt,stock:reading.data.stock,disposition:disposition.data.disposition,sourceRef:disposition.data.sourceRef,stockEvidenceId:reading.data.stockEvidenceId,decisionEvidenceId:disposition.data.decisionEvidenceId,authorityEvidenceId:disposition.data.authorityEvidenceId,qualification:proof.data,files:[...reading.data.files,...disposition.data.files]});
}
export async function verifyInspectionTemperatures(tx:Tx,org:string,excursion:z.infer<typeof siteExcursionSchema>){
 if(!excursion.history)return;
 const event=await tx.auditEvent.findFirst({where:{id:excursion.receiptId,organizationId:org,entityType,entityId:excursion.caseId,action:'excursion.retrieve'},select:{details:true}});
 const stored=envelope.safeParse(event?.details);
 if(!stored.success||stored.data.digest!==excursion.digest||hashValue(stored.data.body)!==excursion.digest)throw problem('The source excursion receipt failed its integrity check.');
 const record=z.object({reading:z.object({data:attachment}),disposition:z.object({data:decision})}).parse(stored.data.body);
 if(!record.disposition.data.history||hashValue(record.disposition.data.history)!==hashValue(excursion.history))throw problem('The site temperature history differs from the disposition.');
 await verifyTemperatureHistory(tx,org,record.reading.data,excursion.history);
}

export function excursionCommand(c:AuthorizedContext,id:string,raw:unknown,store?:EvidenceObjectStore){
 return processExcursion(c,id,raw,store);
}
export async function excursionArchive(c:AuthorizedContext,id:string,raw:unknown,store?:EvidenceObjectStore){
 const request=retrieve.parse(raw),entries:{name:string;bytes:Uint8Array}[]=[],files:{name:string;file:ReviewedFile}[]=[];
 const receipt=await processExcursion(c,id,request,store,async refs=>{
  if(refs.reduce((total,file)=>total+file.sizeBytes,0)>31*1024*1024)throw new IntelligenceError('The four source records exceed the inspection ZIP size limit of 31 MiB.',413);
  for(const file of refs){
   const actual=await downloadEvidence(c,file.id,store);
   if(actual.sha256!==file.sha256)throw problem('A source record changed during inspection.');
   const name=archiveFilename(files.length,file.filename);
   files.push({name,file});entries.push({name,bytes:actual.bytes});
  }
 });
 const record=z.object({reading:z.object({data:attachment}),disposition:z.object({data:decision})}).parse(receipt.record);
 const stock=record.reading.data.stockEvidenceId,decided=record.disposition.data;
 const sources=files.map(({name,file})=>({role:file.id===stock?'affected-stock':file.id===decided.decisionEvidenceId?'signed-decision':file.id===decided.authorityEvidenceId?'signatory-authority':'calibration',entry:name,...file}));
 const history=decided.history;
 if(history)entries.push({name:'temperature-readings.csv',bytes:Buffer.from(temperatureCsv(history))});
 const manifest={...(history?{temperatureReadings:'temperature-readings.csv'}:{}),format:'regpilot-excursion-inspection-v1',...receipt,sources};
 return makeAuditZip([{name:'inspection.json',bytes:Buffer.from(JSON.stringify(manifest,null,2))},...entries]);
}
