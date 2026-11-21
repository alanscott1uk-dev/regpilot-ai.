import {z} from "zod";
import {Prisma,type Vendor} from "@prisma/client";
import {licenceScope,licenceImport,savedLicence,compareLicence,identityReceipt,type LicenceRecord,type LicenceScope} from "../supplier-licence";
import {reviewedFiles,futureDate} from "./reviewed-files";
import {vendorSignal} from "./vendor-signals";
import {IntelligenceError} from "./intelligence-service";
import type {AuthorizedContext} from "./authorization";
import {requireMember,ADMIN} from "./workspace-member";

type Signal=Awaited<ReturnType<typeof vendorSignal>>|null;
async function corroboratedIdentity(tx:Prisma.TransactionClient,v:Vendor,scope:LicenceScope,primary:Signal){
  const receipts:z.infer<typeof identityReceipt>[]=[],names:string[]=[];
  if(!v.signalConnectorId||!primary?.current||primary.companyNumber!==scope.companyNumber)return {receipts,identity:null};
  const connections=await tx.evidenceConnector.findMany({where:{organizationId:v.organizationId,OR:[
    {provider:"COMPANIES_HOUSE",repository:"companieshouse:"+scope.companyNumber},{provider:"GLEIF",branch:scope.companyNumber}]},
    select:{id:true,provider:true},orderBy:{id:"asc"},take:21});
  for(const provider of ["COMPANIES_HOUSE","GLEIF"] as const){
    const options=connections.filter(c=>c.provider===provider);
    const selected=options.find(c=>c.id===v.signalConnectorId)||(options.length===1?options[0]:null);
    if(!selected)continue;
    let signal:Signal;
    try{signal=selected.id===v.signalConnectorId?primary:await vendorSignal(tx,v.organizationId,selected.id);}
    catch(e){if(e instanceof IntelligenceError)continue;throw e;}
    const snap=signal?.snapshot,name=snap?.observation.checks.find(c=>c.id===(provider==="GLEIF"?"registered-legal-name":"registered-name"));
    const required=provider==="GLEIF"?["uk-entity-match","registered-legal-name","legal-entity-active","lei-issued","issuer-corroboration"]:["registered-name","company-status"];
    if(!signal?.current||!snap||!name||!required.every(id=>snap.observation.checks.some(c=>c.id===id&&c.status==="PASS")))continue;
    names.push(name.observed.replace(/ · [^·]+$/u,"").trim());
    receipts.push({provider,connectorId:selected.id,configVersion:snap.configVersion,runId:snap.runId,signalHash:snap.signalHash,sourceUrl:snap.observation.sourceUrl,capturedAt:snap.capturedAt});
  }
  const same=names.length===2&&names[0].toLowerCase()===names[1].toLowerCase();
  return {receipts,identity:same?{companyNumber:scope.companyNumber,name:names[0]}:null};
}
export async function licenceFinding(tx:Prisma.TransactionClient,v:Vendor,signal:Signal){
  if(!v.licenceScope)return null;
  const scope=licenceScope.parse(v.licenceScope);
  const saved=v.licenceRecord?savedLicence.parse(v.licenceRecord):null;
  const {identity,receipts}=await corroboratedIdentity(tx,v,scope,signal);
  const reasons=compareLicence(scope,saved?.record||null,identity,new Date().toISOString().slice(0,10));
  if(!identity)reasons.push("Confirm matching, current Companies House and GLEIF evidence for the same legal entity.");
  if(saved&&identity&&!receipts.every(r=>saved.identities.some(old=>old.provider===r.provider&&old.connectorId===r.connectorId&&old.configVersion===r.configVersion&&old.signalHash===r.signalHash))){
    reasons.push("The identity evidence has changed since import. Recheck the MHRA source against both registers.");
  }
  if(saved&&saved.record.state!=="UNAVAILABLE"){
    try{
      const [file]=await reviewedFiles(tx,v.organizationId,[saved.record.evidenceId]);
      if(file.sha256!==saved.fileHash||file.reviewVersion!==saved.fileVersion)reasons.push("The source file has changed since import.");
    }catch(e){if(!(e instanceof IntelligenceError))throw e;reasons.push("The source file needs a current independent review.");}
  }
  return {scope,saved,reasons,identities:receipts,registeredName:identity?.name||null};
}
export async function setLicenceScope(tx:Prisma.TransactionClient,c:AuthorizedContext,v:Vendor,scope:LicenceScope){
  await requireMember(tx,{...c,userId:scope.reviewerId},ADMIN);
  await tx.vendor.update({where:{id:v.id},data:{licenceScope:scope,licenceRecord:Prisma.DbNull,version:{increment:1}}});
}
export async function importLicence(tx:Prisma.TransactionClient,c:AuthorizedContext,v:Vendor,input:LicenceRecord){
  const record=licenceImport.parse(input),today=new Date().toISOString().slice(0,10);
  if(!v.licenceScope)throw new IntelligenceError("Set the expected company, premises and activity first",409);
  if(record.checkedOn>today)throw new IntelligenceError("The source check date is in the future");
  const previous=v.licenceRecord?savedLicence.parse(v.licenceRecord):null;
  if(previous&&record.checkedOn<previous.record.checkedOn)throw new IntelligenceError("A newer register check is already recorded",409);
  let fileHash:string|null=null,fileVersion:number|null=null;
  if(record.state!=="UNAVAILABLE"){
    if(record.reviewBy<record.checkedOn)throw new IntelligenceError("The next review cannot precede the source check");
    if(Date.parse(record.reviewBy)-Date.parse(record.checkedOn)>366*86400000)throw new IntelligenceError("Choose a review date within one year of the source check");
    if(record.reviewBy>=today)futureDate(record.reviewBy);
    const [file]=await reviewedFiles(tx,c.organizationId,[record.evidenceId]);fileHash=file.sha256;fileVersion=file.reviewVersion;
  }
  const primary=v.signalConnectorId?await vendorSignal(tx,v.organizationId,v.signalConnectorId):null;
  const {receipts}=await corroboratedIdentity(tx,v,licenceScope.parse(v.licenceScope),primary);
  const snapshot=savedLicence.parse({record,identities:receipts,importedBy:c.userId,importedAt:new Date().toISOString(),fileHash,fileVersion});
  await tx.vendor.update({where:{id:v.id},data:{licenceRecord:snapshot,version:{increment:1}}});
  return snapshot;
}
