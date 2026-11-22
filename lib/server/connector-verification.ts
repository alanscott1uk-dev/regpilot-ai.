import type {EvidenceConnector} from '@prisma/client';
import {hashValue} from '../regulatory/intelligence';
import {verifiedObservation} from './connector-observation';
import {IntelligenceError,transaction} from './intelligence-service';
import {requireMember} from './workspace-member';
import type {AuthorizedContext} from './authorization';
import {decryptConnectorSecret} from './connector-secret';

export function connectorScopeHash(data:Pick<EvidenceConnector,'provider'|'repository'|'branch'|'controlId'>){
 return hashValue({provider:data.provider,repository:data.repository,branch:data.branch,controlId:data.controlId});
}
export function credentialChanged(old:EvidenceConnector|null,token:string|undefined,scopeHash:string){
 if(!old?.encryptedSecret||!token||connectorScopeHash(old)!==scopeHash)return false;
 try{return decryptConnectorSecret(old.encryptedSecret,old.organizationId,old.id)!==token;}
 catch{return false;}
}

export async function verificationReceipt(ctx:AuthorizedContext,id:string){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx);
  const row=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId}});
  if(!row)throw new IntelligenceError('Connection not found',404);
  const scopeHash=connectorScopeHash(row);
  const [settings,captures]=await Promise.all([
   tx.auditEvent.findMany({where:{organizationId:ctx.organizationId,entityType:'EvidenceConnector',entityId:id,action:'connector.configured'},select:{details:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51}),
   tx.connectorRun.findMany({where:{organizationId:ctx.organizationId,connectorId:id},select:{id:true,configVersion:true,result:true,resultHash:true,signalHash:true,outcome:true,capturedAt:true},orderBy:[{capturedAt:'desc'},{id:'desc'}],take:101})
  ]);
  const versions=new Set([row.version]);
  const replacements:Array<{version:number;previousVersion:number}>=[];
  for(const change of settings.slice(0,50)){
   const data=change.details as Record<string,unknown>|null;
   if(data?.scopeHash!==scopeHash||typeof data.version!=='number')continue;
   versions.add(data.version);
   if(data.credentialReplaced===true&&typeof data.previousVersion==='number'){
    versions.add(data.previousVersion);
    replacements.push({version:data.version,previousVersion:data.previousVersion});
   }
  }
  const reads=captures.slice(0,100).filter(run=>versions.has(run.configVersion)&&verifiedObservation(run)).map(run=>({id:run.id,configurationVersion:run.configVersion,at:run.capturedAt.toISOString(),outcome:run.outcome,resultHash:run.resultHash}));
  const latest=reads[0],earliest=reads.at(-1);
  const renewal=replacements.map(change=>({...change,before:reads.find(run=>run.configurationVersion===change.previousVersion)?.id??null,after:reads.find(run=>run.configurationVersion===change.version)?.id??null}));
  return {format:'regpilot-connection-verification-v1',organizationId:row.organizationId,connectorId:id,provider:row.provider,target:row.repository,reference:row.branch,scopeHash,
   enabled:row.enabled,currentVersion:row.version,currentVersionRead:reads.find(run=>run.configurationVersion===row.version)?.id??null,
   verifiedReadsInWindow:reads.length,intervalHours:row.intervalHours,readsAtLeastOneIntervalApart:!!latest&&!!earliest&&Date.parse(latest.at)-Date.parse(earliest.at)>=row.intervalHours*3600000,
   credentialReplacements:renewal,reads,listTruncated:captures.length>100||settings.length>50,generatedAt:new Date().toISOString(),
   scope:'Saved provider responses for this target and control. Each outcome describes the evidence returned. Credential replacement needs successful reads on both adjacent versions. Managed broker renewal has separate hosted authorisation records.'};
 });
}
