import {verifyInspectionTemperatures} from './excursion-pilot';
import {temperatureCsv} from '../excursion-history';
import {hashValue} from '../regulatory/intelligence';
import {archiveFilename,makeAuditZip} from '../audit-archive';
import type {AuthorizedContext} from './authorization';
import {IntelligenceError,transaction} from './intelligence-service';
import {downloadEvidence} from './evidence-service';
import type {EvidenceObjectStore} from './evidence-storage';
import {assertReviewedFiles} from './reviewed-files';
import {retainedValidation} from './retained-validation';
import {siteQualification} from './site-qualification-service';
import {ADMIN,requireMember} from './workspace-member';

export async function siteInspectionArchive(ctx:AuthorizedContext,id:string,store?:EvidenceObjectStore){
 const packet=await siteQualification(ctx,id);
 const release=(await retainedValidation(ctx,id)).saved;
 if(!release||!packet.decisions.length)throw new IntelligenceError('Retain the supplier release pack and record the site decision before exporting the inspection ZIP.',409);
 const files=[...new Map([...packet.testFiles,...packet.decisions.flatMap(d=>[...d.files,...(d.excursion?.files??[])])].map(f=>[f.id,f])).values()].sort((a,b)=>a.id.localeCompare(b.id));
 if(files.reduce((s,f)=>s+f.sizeBytes,release.meta.size)>30*1024*1024)throw new IntelligenceError('The selected site evidence exceeds the 30 MiB inspection download limit.',413);
 async function verifyReviewVersions(){
  await transaction(ctx,async tx=>{
   await requireMember(tx,ctx,ADMIN);
   await assertReviewedFiles(tx,ctx.organizationId,packet.testFiles);
   for(const decision of packet.decisions){
    await assertReviewedFiles(tx,ctx.organizationId,decision.files);
    if(decision.excursion){
     await assertReviewedFiles(tx,ctx.organizationId,[...decision.excursion.files].sort((a,b)=>a.id.localeCompare(b.id)));
     await verifyInspectionTemperatures(tx,ctx.organizationId,decision.excursion);
    }
   }
  });
 }
 await verifyReviewVersions();
 const entries=[{name:'supplier-validation.zip',bytes:release.bytes}],sources=[];
 for(const f of files){
  const actual=await downloadEvidence(ctx,f.id,store);
  if(actual.sha256!==f.sha256)throw new IntelligenceError('A signed site record changed during retrieval.',409);
  const name=archiveFilename(sources.length,f.filename);
  entries.push({name,bytes:Buffer.from(actual.bytes)});
  const roles=[...packet.results.filter(r=>r.evidenceId===f.id).map(r=>'executed-test/'+r.step),...packet.decisions.flatMap(d=>[
   ...(d.input.decisionFile===f.id?['signed-'+d.input.decision.toLowerCase()]:[]),...(d.input.authorityFile===f.id?['signatory-authority']:[]),...(d.excursion?.files.some(x=>x.id===f.id)?[f.id===d.excursion.stockEvidenceId?'excursion-stock':f.id===d.excursion.decisionEvidenceId?'excursion-disposition':f.id===d.excursion.authorityEvidenceId?'excursion-authority':'excursion-calibration']:[])])];
  sources.push({entry:name,roles:[...new Set(roles)],...f});
 }
 // Recheck every recorded review version, including earlier approvals and withdrawals.
 await verifyReviewVersions();
 const current=await siteQualification(ctx,id);
 if(current.basisHash!==packet.basisHash||current.status!==packet.status||hashValue(current.decisions)!==hashValue(packet.decisions)||current.supplier?.receiptId!==release.meta.receiptId)
  throw new IntelligenceError('The site decision or supplier archive changed. Retrieve the current dossier.',409);
 const temperatureReadings=[];
 for(const decision of current.decisions){
  const excursion=decision.excursion;
  if(!excursion?.history)continue;
  const entry='temperature-'+excursion.receiptId+'.csv';
  entries.push({name:entry,bytes:Buffer.from(temperatureCsv(excursion.history))});
  temperatureReadings.push({entry,caseId:excursion.caseId,receiptId:excursion.receiptId});
 }
 const manifest={temperatureReadings,format:'regpilot-site-inspection-v1',site:current,supplier:{entry:'supplier-validation.zip',...release.meta},sources};
 return makeAuditZip([{name:'site-inspection.json',bytes:Buffer.from(JSON.stringify(manifest,null,2))},...entries]);
}
