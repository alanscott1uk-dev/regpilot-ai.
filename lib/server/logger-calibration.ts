import type {EvidenceConnector,Prisma} from '@prisma/client';
import {z} from 'zod';
import type {AuthorizedContext} from './authorization';
import {ADMIN,requireMember} from './workspace-member';
import {IntelligenceError,transaction} from './intelligence-service';
import {isTemperatureLogger,loggerProviders} from '../connectors/record-catalogue';
import {readRecordKeys} from '../connectors/operational-records';
import type {Observation} from '../connectors/observation';
import {hashValue} from '../regulatory/intelligence';

type Logger=Pick<EvidenceConnector,'id'|'organizationId'|'provider'|'repository'|'branch'|'controlId'|'configuredById'>;
async function calibration(tx:Prisma.TransactionClient,logger:Logger){
 if(!isTemperatureLogger(logger.provider))throw new IntelligenceError('Choose a supported temperature logger',409);
 const {scope:channel,record:serial,reference}=readRecordKeys(logger.provider,logger.repository,logger.branch);
 const [id,version,from,until,low,high,minutes]=reference!.split('/');
 const file=await tx.evidence.findFirst({where:{id,organizationId:logger.organizationId,reviewVersion:Number(version),reviewStatus:'APPROVED',scanStatus:'CLEAN'},select:{sha256:true,uploadedById:true,reviewerId:true,reviewedAt:true}});
 if(!file?.reviewedAt||!file.reviewerId||!file.uploadedById||file.reviewerId===file.uploadedById)return null;
 const facts={channel,serial,field:logger.provider==='UBIBOT'?'field1':'T&D channel '+channel,unit:'Celsius',fileId:id,reviewVersion:Number(version),sha256:file.sha256,from,until,low,high,minutes,controlId:logger.controlId};
 return {uploader:file.uploadedById,facts,basis:hashValue({organizationId:logger.organizationId,connectorId:logger.id,...facts})};
}
const action='logger.calibration-approved';
function approvalWhere(logger:Logger,basis:string){
 return {organizationId:logger.organizationId,entityType:'EvidenceConnector',entityId:logger.id,action,details:{path:['basis'],equals:basis}};
}
export async function approveLoggerCalibration(ctx:AuthorizedContext,id:string,version:number,confirm:unknown){
 if(!Number.isSafeInteger(version)||version<1||confirm!==true)throw new IntelligenceError('Confirm the instrument, certificate and operating limits');
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const logger=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId,provider:{in:[...loggerProviders]},enabled:true,version}});
  if(!logger)throw new IntelligenceError('Logger configuration changed or is unavailable',409);
  const current=await calibration(tx,logger);
  if(!current)throw new IntelligenceError('Select the current independently reviewed and clean calibration certificate',409);
  if([logger.configuredById,current.uploader].includes(ctx.userId))throw new IntelligenceError('A separate administrator must check the physical instrument against the certificate',403);
  const where=approvalWhere(logger,current.basis);
  const previous=await tx.auditEvent.findFirst({where:{...where,actorId:ctx.userId},select:{id:true}});
  if(previous)return previous;
  return tx.auditEvent.create({data:{organizationId:ctx.organizationId,entityType:'EvidenceConnector',entityId:id,action,actorId:ctx.userId,details:{basis:current.basis,...current.facts}},select:{id:true}});
 });
}

/** Evaluate after the provider read, within the same transaction as the observation receipt. */
export async function applyLoggerCalibration(tx:Prisma.TransactionClient,logger:Logger,reading:Observation):Promise<Observation>{
 const current=await calibration(tx,logger);
 const sample=reading.checks.find(check=>check.id==='logger-fresh')?.observed;
 const date=z.iso.datetime().safeParse(sample);
 const approval=current?await tx.auditEvent.findFirst({where:{...approvalWhere(logger,current.basis),actorId:{notIn:[logger.configuredById,current.uploader]}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,actorId:true}}):null;
 let authorised=false;
 if(approval?.actorId){
  try{await requireMember(tx,{organizationId:logger.organizationId,userId:approval.actorId,role:'ADMIN'},ADMIN);authorised=true;}
  catch(error){if(!(error instanceof IntelligenceError)||error.status!==403)throw error;}
 }
 const status=!current||!authorised||!date.success?'UNKNOWN':current.facts.from<=date.data.slice(0,10)&&date.data.slice(0,10)<current.facts.until?'PASS':'FAIL';
 const observed=current&&authorised&&approval?current.facts.fileId+' v'+current.facts.reviewVersion+' · '+current.facts.sha256+' · '+current.facts.from+' to '+current.facts.until+' · instrument review '+approval.id:'Instrument and certificate need a current independent review';
 const checks=reading.checks.filter(check=>check.id!=='logger-calibration');
 checks.push({id:'logger-calibration',label:'Independent instrument review and certificate cover the reading',observed,status,nextStep:'Check the physical serial, channel, Celsius field, limits and dates against the certificate in Operations.'});
 return {...reading,checks};
}

export async function calibrationStillCurrent(tx:Prisma.TransactionClient,logger:Logger,observation:Observation|null){
 if(!observation)return false;
 const current=await applyLoggerCalibration(tx,logger,observation);
 return hashValue(current.checks)===hashValue(observation.checks);
}

export function loggerSampleCurrent(logger:Logger,observation:Observation|null,now=Date.now()){
 if(!observation||!isTemperatureLogger(logger.provider))return false;
 const sample=observation.checks.find(check=>check.id==='logger-fresh'&&check.status==='PASS');
 if(!sample||!observation.checks.some(check=>check.id==='logger-calibration'&&check.status==='PASS')||
    !observation.checks.some(check=>check.id==='logger-temperature'&&check.status!=='UNKNOWN'))return false;
 const {reference}=readRecordKeys(logger.provider,logger.repository,logger.branch);
 const [,,from,until,,,minutes]=reference!.split('/');
 const age=now-Date.parse(sample.observed),today=new Date(now).toISOString().slice(0,10);
 return age>=0&&age<=Number(minutes)*60000&&from<=today&&today<until;
}

export async function loggerReadingCurrent(tx:Prisma.TransactionClient,logger:Logger,observation:Observation|null,now=Date.now()){
 return loggerSampleCurrent(logger,observation,now)&&await calibrationStillCurrent(tx,logger,observation);
}
