import {verifiedObservation} from './connector-observation';
import {connectorControlScope} from './connector-scope';
import type {Prisma} from '@prisma/client';
import {connectedEvidenceSchema,type ConnectedEvidence} from '../connected-evidence';
import {hashValue} from '../regulatory/intelligence';
import {observationCurrent,observationOutcome,connectorLabel,type Observation} from '../connectors/observation';
import {connectorProviderEnabled} from './connector-flags';
import {IntelligenceError} from './intelligence-service';
type Tx=Prisma.TransactionClient;
const evidenceMeaning=(p:ConnectedEvidence)=>hashValue({sourceUrl:p.sourceUrl,engine:p.engine,checks:p.checks,limitations:p.limitations,scopeRationale:p.scopeRationale});
/** Only observations attached to this action's control can be offered as evidence. */
export async function changeObservationChoices(tx:Tx,organizationId:string,controlId:string){
 const connectors=await tx.evidenceConnector.findMany({where:{organizationId,...connectorControlScope(controlId),enabled:true,control:{enabled:true}},take:20,
  select:{controlId:true,controlLinks:{where:{controlId,organizationId},select:{id:true,mappedById:true,rationale:true},take:1},id:true,configuredById:true,provider:true,repository:true,branch:true,version:true,enabled:true,failureCode:true,intervalHours:true,runs:{orderBy:[{capturedAt:'desc'},{id:'desc'}],take:1}}});
 return connectors.flatMap(c=>{
  const r=c.runs[0];if(!r||!connectorProviderEnabled(c.provider)||r.outcome!=='OBSERVED'||!observationCurrent(r,c,true)||r.capturedAt>new Date()||!verifiedObservation(r))return [];
  if(!r.result||typeof r.result!=='object'||Array.isArray(r.result))return [];
  const value=r.result as unknown as Observation;
  const parsed=connectedEvidenceSchema.safeParse({id:r.id,...(c.controlId!==controlId?{scopeLinkId:c.controlLinks[0]?.id,scopeMappedById:c.controlLinks[0]?.mappedById,scopeRationale:c.controlLinks[0]?.rationale}:{}),connectorId:c.id,configuredById:c.configuredById,provider:c.provider,label:connectorLabel(c),configVersion:r.configVersion,resultHash:r.resultHash,signalHash:r.signalHash,capturedAt:r.capturedAt.toISOString(),sourceUrl:value.sourceUrl,engine:value.engine,checks:value.checks,limitations:value.limitations});
  if(!parsed.success||observationOutcome(parsed.data)!=='OBSERVED'||hashValue({engine:value.engine,checks:value.checks})!==r.signalHash)return [];
  return [parsed.data];
 });
}
export async function captureChangeObservations(tx:Tx,organizationId:string,controlId:string,ids:string[]){
 if(!ids.length)return [];
 const choices=await changeObservationChoices(tx,organizationId,controlId),selected=choices.filter(c=>ids.includes(c.id)).sort((a,b)=>a.id.localeCompare(b.id));
 if(selected.length!==ids.length)throw new IntelligenceError('Choose current connected evidence for this control. Refresh if collection or connection settings changed.',409);
 return selected;
}
export async function assertChangeObservations(tx:Tx,organizationId:string,controlId:string,proofs:ConnectedEvidence[]){
 if(!proofs.length)return;
 const latest=await changeObservationChoices(tx,organizationId,controlId);
 const originals=await tx.connectorRun.findMany({where:{organizationId,id:{in:proofs.map(p=>p.id)},connector:{organizationId,...connectorControlScope(controlId)}}});
 for(const proof of proofs){
  const original=originals.find(r=>r.id===proof.id),current=latest.find(r=>r.connectorId===proof.connectorId);
  // An unchanged fresh collection maintains validity; a changed signal, revoked
  // connection, failed read or credential/configuration rotation requires review.
  if(!original||original.connectorId!==proof.connectorId||hashValue(original.result)!==proof.resultHash||original.resultHash!==proof.resultHash||original.signalHash!==proof.signalHash||original.configVersion!==proof.configVersion||!current||current.scopeLinkId!==proof.scopeLinkId||current.scopeMappedById!==proof.scopeMappedById||current.configVersion!==proof.configVersion||current.signalHash!==proof.signalHash||evidenceMeaning(current)!==evidenceMeaning(proof))
   throw new IntelligenceError('Connected evidence changed or is no longer current. Refresh the connection and submit the current observation for review.',409);
 }
}
