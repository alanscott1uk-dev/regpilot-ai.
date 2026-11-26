import {randomUUID} from 'node:crypto';
import type {MyCsfConnection,Prisma} from '@prisma/client';
import {z} from 'zod';
import {apiCredentials,uploadParts,maturityLevels,myCsfApi,remoteId,uid,type ApiCredentials,type MaturityLevel,type Snapshot,type Statement} from '../mycsf/api';
import {hitrustTiers,type HitrustTier} from '../audit-catalogue/hitrust';
import {db} from './db';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN} from './workspace-member';
import {encryptConnectorSecret,decryptConnectorSecret} from './connector-secret';
import {downloadEvidence} from './evidence-service';
import type {EvidenceObjectStore} from './evidence-storage';
import type {AuthorizedContext} from './authorization';

type Tx=Prisma.TransactionClient;
const tier=z.enum(hitrustTiers),version=z.number().int().positive(),uuid=z.uuid();
const connect=z.object({op:z.literal('connect'),subscriber:remoteId,assessment:remoteId,tier,credentials:apiCredentials,version:z.number().int().nonnegative()}).strict();
const discover=z.object({op:z.literal('discover'),subscriber:remoteId,credentials:apiCredentials}).strict();
const sync=z.object({op:z.literal('sync'),connection:uuid,version}).strict();
const disconnect=z.object({op:z.literal('disconnect'),connection:uuid,version}).strict();
const map=z.object({op:z.literal('map'),connection:uuid,version,buid:uid,evidence:uuid,levels:z.array(z.enum(maturityLevels)).min(1).max(5),reason:z.string().trim().min(8).max(1000),mappingVersion:z.number().int().nonnegative()}).strict();
const approve=z.object({op:z.literal('approve'),connection:uuid,version,mapping:uuid,mappingVersion:version}).strict();
const send=z.object({op:z.literal('export'),connection:uuid,version,mapping:uuid,mappingVersion:version,documentType:remoteId,typeName:z.string().trim().min(1).max(100),existingDocument:remoteId.optional(),confirm:z.literal(true)}).strict();
const cmd=z.discriminatedUnion('op',[connect,discover,sync,disconnect,map,approve,send]);
export function myCsfOrganisations(){return (process.env.REGPILOT_MYCSF_AUTHORISED_ORGANISATIONS??'').split(',').map(v=>v.trim().toLowerCase()).filter(v=>uuid.safeParse(v).success);}
const permitted=(org:string)=>myCsfOrganisations().includes(org);
function licence(org:string){if(!permitted(org))throw new IntelligenceError('Live MyCSF exchange requires HITRUST integration permission for this workspace.',403);}
function conflict(message:string):never{throw new IntelligenceError(message,409);}
function rows(c:MyCsfConnection){return c.requirements as unknown as Statement[];}
function credential(c:MyCsfConnection){return apiCredentials.parse(JSON.parse(decryptConnectorSecret(c.encryptedSecret,c.organizationId,'mycsf:'+c.id))) as ApiCredentials;}
function scopeData(s:Snapshot){const now=new Date();return {name:s.name,scopeHash:s.hash,requirements:s.rows as unknown as Prisma.InputJsonValue,syncedAt:now,nextSyncAt:new Date(now.getTime()+3600000),failure:null};}
function currentStatement(c:MyCsfConnection,buid:string){const s=rows(c).find(r=>r.buid===buid);if(!s)conflict('This requirement is outside the current MyCSF scope.');return s;}
const hasLease=(c:MyCsfConnection)=>!!c.leaseId&&!!c.leaseUntil&&c.leaseUntil>new Date();
async function invalidateChangedMappings(tx:Tx,a:MyCsfConnection,s:Snapshot){
 if(a.scopeHash===s.hash)return;
 const fresh=new Map(s.rows.map(r=>[r.buid,r.hash]));
 const changed=rows(a).filter(r=>fresh.get(r.buid)!==r.hash).map(r=>r.buid);
 if(changed.length)await tx.myCsfMapping.updateMany({where:{connectionId:a.id,organizationId:a.organizationId,buid:{in:changed}},data:{approvedAt:null,approvedBy:null,exportedAt:null,remoteDocumentId:null,version:{increment:1}}});
}
async function account(tx:Tx,c:AuthorizedContext,id:string,revision?:number){
 const a=await tx.myCsfConnection.findFirst({where:{id,organizationId:c.organizationId}});
 if(!a)throw new IntelligenceError('MyCSF assessment not found in this workspace.',404);
 if(revision!==undefined&&a.version!==revision)conflict('The MyCSF scope or credential changed. Refresh the assessment.');return a;
}
const audit=(tx:Tx,c:AuthorizedContext,id:string,action:string,details:Prisma.InputJsonObject)=>tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType:'MyCsfAssessment',entityId:id,action,details}});
async function checkedFile(tx:Tx,c:AuthorizedContext,id:string){
 const f=await tx.evidence.findFirst({where:{id,organizationId:c.organizationId},select:{id:true,filename:true,reviewVersion:true,reviewStatus:true,scanStatus:true,sha256:true,reviewedAt:true,reviewerId:true,uploadedById:true}});
 if(!f||f.scanStatus!=='CLEAN'||f.reviewStatus!=='APPROVED'||!f.reviewedAt||!f.reviewerId||!f.uploadedById||f.reviewerId===f.uploadedById||!/^[a-f0-9]{64}$/.test(f.sha256))conflict('Choose a clean evidence file independently approved in this workspace.');return f;
}
async function checkedMapping(tx:Tx,c:AuthorizedContext,a:MyCsfConnection,id:string,v:number){
 const m=await tx.myCsfMapping.findFirst({where:{id,organizationId:c.organizationId,connectionId:a.id}});if(!m)throw new IntelligenceError('Evidence mapping not found.',404);
 const f=await checkedFile(tx,c,m.evidenceId),s=currentStatement(a,m.buid);
 if(m.version!==v||m.requirementHash!==s.hash||m.evidenceVersion!==f.reviewVersion||m.sha256!==f.sha256)conflict('The mapping, scope or evidence revision changed. Review and map the current versions.');return {m,f};
}
function summary(c:Pick<MyCsfConnection,'id'|'name'|'tier'|'subscriberId'|'assessmentId'|'version'|'syncedAt'|'failure'>){return {id:c.id,name:c.name,tier:c.tier,subscriber:c.subscriberId,assessment:c.assessmentId,version:c.version,syncedAt:c.syncedAt.toISOString(),failure:c.failure};}
export async function myCsfWorkspace(c:AuthorizedContext,kind:HitrustTier,id='',q='',page=1,evidenceQuery=''){
 return transaction(c,async tx=>{
  const actor=await requireMember(tx,c),canEdit=ADMIN.includes(actor.role),licensed=permitted(c.organizationId);
  const connections=await tx.myCsfConnection.findMany({where:{organizationId:c.organizationId,tier:kind},select:{id:true,name:true,tier:true,subscriberId:true,assessmentId:true,version:true,syncedAt:true,failure:true},orderBy:{name:'asc'}});
  const base={organizationId:c.organizationId,licensed,canEdit,connections:licensed?connections.map(summary):canEdit?connections.map(x=>({...summary(x),name:'Disconnected licence access'})):[]};
  if(!id||!licensed)return {...base,selected:null};
  const a=await account(tx,c,id);if(a.tier!==kind)throw new IntelligenceError('Select the matching assessment type.',404);
  const needle=q.toLowerCase(),all=rows(a),filtered=all.filter(r=>[r.buid,r.reference,r.domain,r.text].join(' ').toLowerCase().includes(needle));
  const pages=Math.max(1,Math.ceil(filtered.length/15)),current=Math.max(1,Math.min(pages,page)),shown=filtered.slice((current-1)*15,current*15);
  const mappings=await tx.myCsfMapping.findMany({where:{connectionId:a.id,organizationId:c.organizationId},include:{evidence:{select:{filename:true,reviewVersion:true,reviewStatus:true,reviewerId:true,uploadedById:true,scanStatus:true,sha256:true}}},orderBy:{id:'asc'}});
  const hashes=new Map(all.map(x=>[x.buid,x.hash]));
  const projected=mappings.map(m=>({id:m.id,buid:m.buid,version:m.version,evidenceId:m.evidenceId,filename:m.evidence.filename,levels:m.levels,reason:m.reason,mappedBy:m.mappedBy,approved:!!m.approvedBy,exported:!!m.exportedAt,remoteDocument:m.remoteDocumentId,
   stale:hashes.get(m.buid)!==m.requirementHash||m.evidence.sha256!==m.sha256||m.evidence.reviewVersion!==m.evidenceVersion||m.evidence.reviewStatus!=='APPROVED'||m.evidence.scanStatus!=='CLEAN'||!m.evidence.reviewerId||m.evidence.reviewerId===m.evidence.uploadedById}));
  const earlier=canEdit&&shown.length?await tx.myCsfMapping.findMany({where:{organizationId:c.organizationId,connectionId:{not:a.id},approvedBy:{not:null},buid:{in:shown.map(r=>r.buid)},requirementHash:{in:shown.map(r=>r.hash)}},
   select:{buid:true,requirementHash:true,evidenceId:true,evidenceVersion:true,sha256:true,connection:{select:{name:true,tier:true}},evidence:{select:{filename:true,reviewVersion:true,reviewerId:true,uploadedById:true,reviewStatus:true,scanStatus:true,sha256:true}}},orderBy:{approvedAt:'desc'},take:150}):[];
  const reuse=earlier.filter(m=>hashes.get(m.buid)===m.requirementHash&&m.evidence.reviewVersion===m.evidenceVersion&&m.evidence.sha256===m.sha256&&m.evidence.reviewStatus==='APPROVED'&&m.evidence.scanStatus==='CLEAN'&&m.evidence.reviewerId&&m.evidence.uploadedById&&m.evidence.reviewerId!==m.evidence.uploadedById)
   .map(m=>({buid:m.buid,id:m.evidenceId,filename:m.evidence.filename,assessment:m.connection.name,tier:m.connection.tier}));
  const available=canEdit?await tx.evidence.findMany({where:{organizationId:c.organizationId,scanStatus:'CLEAN',reviewStatus:'APPROVED',reviewedAt:{not:null},...(evidenceQuery?{OR:[{filename:{contains:evidenceQuery,mode:'insensitive'}},{obligation:{title:{contains:evidenceQuery,mode:'insensitive'}}}]}:{})},select:{id:true,filename:true,reviewerId:true,uploadedById:true,obligation:{select:{title:true}}},orderBy:{reviewedAt:'desc'},take:100}):[];
  return {...base,selected:{...summary(a),total:all.length,matches:filtered.length,page:current,pages,rows:shown,reuse,mappings:projected.filter(m=>shown.some(r=>r.buid===m.buid)),staleCount:projected.filter(m=>m.stale).length,mapped:projected.filter(m=>!m.stale).length,
   evidence:available.filter(f=>f.reviewerId&&f.uploadedById&&f.reviewerId!==f.uploadedById).map(f=>({id:f.id,name:f.filename,task:f.obligation.title}))}};
 });
}
async function refresh(c:AuthorizedContext,id:string,v:number,fetcher:typeof fetch){
 const a=await transaction(c,async tx=>{await requireMember(tx,c,ADMIN);return account(tx,c,id,v);});
 if(hasLease(a))conflict('An evidence export is in progress.');licence(c.organizationId);
 try{
  const s=await myCsfApi(credential(a),fetcher).snapshot(a.subscriberId,a.assessmentId,a.tier as HitrustTier);
  return await transaction(c,async tx=>{await requireMember(tx,c,ADMIN);licence(c.organizationId);const old=await account(tx,c,id,v);if(hasLease(old))conflict('An export started while refreshing scope.');
   const changed=old.scopeHash!==s.hash;
   await invalidateChangedMappings(tx,old,s);
   if(changed)await audit(tx,c,id,'mycsf.scope_changed',{from:old.scopeHash,to:s.hash,count:s.rows.length});
   return summary(await tx.myCsfConnection.update({where:{id},data:{...scopeData(s),...(changed?{version:{increment:1}}:{})}}));});
 }catch(e){await db.myCsfConnection.updateMany({where:{id,organizationId:c.organizationId,version:v,leaseId:null},data:{failure:e instanceof IntelligenceError&&e.status===403?'CHECK_CREDENTIAL':'REFRESH_REQUIRED',nextSyncAt:new Date(Date.now()+900000)}});throw e;}
}
export async function runDueMyCsf(deadline:number){
 const orgs=myCsfOrganisations();if(!orgs.length)return {processed:0,disabled:true};
 const now=new Date(),leaseUntil=new Date(now.getTime()+90000);
 const due=await db.myCsfConnection.findMany({where:{organizationId:{in:orgs},nextSyncAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},orderBy:{nextSyncAt:'asc'},take:4,select:{id:true,organizationId:true,configuredById:true,version:true,nextSyncAt:true}});
 let processed=0,attention=0;
 for(const a of due){if(Date.now()+18000>deadline)break;const reserved=await db.myCsfConnection.updateMany({where:{id:a.id,version:a.version,nextSyncAt:a.nextSyncAt},data:{nextSyncAt:leaseUntil}});if(!reserved.count)continue;
  try{await refresh({organizationId:a.organizationId,userId:a.configuredById,role:'ADMIN'},a.id,a.version,fetch);}catch{attention++;}processed++;
 }
 return {processed,attention};
}
export async function changeMyCsf(c:AuthorizedContext,input:unknown,deps:{fetcher?:typeof fetch;storage?:EvidenceObjectStore}={}){
 const result=cmd.safeParse(input);if(!result.success)throw new IntelligenceError('Check the assessment, revision, evidence and MyCSF fields.');const d=result.data,fetcher=deps.fetcher??fetch;
 await transaction(c,async tx=>{await requireMember(tx,c,ADMIN);});
 if(d.op==='disconnect')return transaction(c,async tx=>{await requireMember(tx,c,ADMIN);const a=await account(tx,c,d.connection,d.version);if(hasLease(a))conflict('Wait for the current export to finish before disconnecting.');await tx.myCsfConnection.delete({where:{id:a.id}});await audit(tx,c,a.id,'mycsf.disconnected',{});return {disconnected:true};});
 licence(c.organizationId);
 if(d.op==='discover')return {assessments:await myCsfApi(d.credentials,fetcher).assessments(d.subscriber)};
 if(d.op==='connect'){
  const snapshot=await myCsfApi(d.credentials,fetcher).snapshot(d.subscriber,d.assessment,d.tier);
  return transaction(c,async tx=>{await requireMember(tx,c,ADMIN);licence(c.organizationId);
   const prior=await tx.myCsfConnection.findFirst({where:{organizationId:c.organizationId,subscriberId:d.subscriber,assessmentId:d.assessment}});
   if((prior?.version??0)!==d.version||prior&&(prior.tier!==d.tier||hasLease(prior)))conflict('Refresh before connecting or replacing this assessment credential.');
   const id=prior?.id??randomUUID(),encryptedSecret=encryptConnectorSecret(JSON.stringify(d.credentials),c.organizationId,'mycsf:'+id);
   const data={...scopeData(snapshot),configuredById:c.userId,encryptedSecret};
   if(prior)await invalidateChangedMappings(tx,prior,snapshot);
   const a=prior?await tx.myCsfConnection.update({where:{id},data:{...data,version:{increment:1}}}):await tx.myCsfConnection.create({data:{...data,id,organizationId:c.organizationId,subscriberId:d.subscriber,assessmentId:d.assessment,tier:d.tier}});
   await audit(tx,c,id,prior?'mycsf.credential_replaced':'mycsf.connected',{scopeHash:a.scopeHash,count:snapshot.rows.length});return summary(a);
  });
 }
 if(d.op==='sync')return refresh(c,d.connection,d.version,fetcher);
 if(d.op==='export')return exportMapping(c,d,fetcher,deps.storage);
 return transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);licence(c.organizationId);const a=await account(tx,c,d.connection,d.version);
  if(hasLease(a))conflict('An evidence export is in progress.');
  if(d.op==='approve'){
   const {m,f}=await checkedMapping(tx,c,a,d.mapping,d.mappingVersion);
   if(m.mappedBy===c.userId||f.uploadedById===c.userId)throw new IntelligenceError('An independent administrator must approve this evidence mapping.',403);
   if(m.approvedBy)return {id:m.id,version:m.version};
   const saved=await tx.myCsfMapping.update({where:{id:m.id},data:{approvedBy:c.userId,approvedAt:new Date(),version:{increment:1}}});await audit(tx,c,a.id,'mycsf.mapping_approved',{mapping:m.id,sha256:m.sha256});return {id:saved.id,version:saved.version};
  }
  if(a.tier!=='r2'&&d.levels.some(level=>level!=='IMPLEMENTED'))throw new IntelligenceError('Use Implemented for this assessment type.');
  const s=currentStatement(a,d.buid),f=await checkedFile(tx,c,d.evidence),levels=[...new Set(d.levels)].sort();
  const where={connectionId_buid_evidenceId:{connectionId:a.id,buid:d.buid,evidenceId:f.id}},old=await tx.myCsfMapping.findUnique({where});
  if((old?.version??0)!==d.mappingVersion)conflict('The evidence mapping changed. Refresh before saving.');
  const data={requirementHash:s.hash,evidenceVersion:f.reviewVersion,sha256:f.sha256,reason:d.reason,levels,mappedBy:c.userId,approvedBy:null,approvedAt:null,exportedAt:null,remoteDocumentId:null};
  const m=await tx.myCsfMapping.upsert({where,create:{...data,organizationId:c.organizationId,connectionId:a.id,buid:s.buid,evidenceId:f.id},update:{...data,version:{increment:1}}});
  await audit(tx,c,a.id,'mycsf.evidence_mapped',{mapping:m.id,buid:s.buid,requirementHash:s.hash,evidenceHash:f.sha256});return {id:m.id,version:m.version};
 });
}

async function exportMapping(c:AuthorizedContext,d:z.infer<typeof send>,fetcher:typeof fetch,storage?:EvidenceObjectStore){
 const lease=randomUUID();
 const prepared=await transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);licence(c.organizationId);const a=await account(tx,c,d.connection,d.version);
  const {m,f}=await checkedMapping(tx,c,a,d.mapping,d.mappingVersion);if(!m.approvedBy||m.approvedBy===m.mappedBy)conflict('This evidence mapping needs independent approval.');
  if(!m.exportedAt){if(hasLease(a))conflict('Another export is in progress.');await tx.myCsfConnection.update({where:{id:a.id},data:{leaseId:lease,leaseUntil:new Date(Date.now()+150000)}});}
  return {a,m,f};
 });
 const {a,m,f}=prepared;if(m.exportedAt)return {document:m.remoteDocumentId,reused:true};
 const api=myCsfApi(credential(a),fetcher),marker=a.id+'/'+m.sha256;
 async function validate(tx:Tx){
  await requireMember(tx,c,ADMIN);licence(c.organizationId);const live=await account(tx,c,a.id,d.version);
  if(live.leaseId!==lease||!hasLease(live))conflict('Export reservation expired. Reconcile before continuing.');
  const checked=await checkedMapping(tx,c,live,m.id,d.mappingVersion);if(!checked.m.approvedBy)conflict('The mapping approval changed.');
 }
 try{
  const fresh=await api.snapshot(a.subscriberId,a.assessmentId,a.tier as HitrustTier);
  if(fresh.hash!==a.scopeHash){await transaction(c,async tx=>{await validate(tx);await invalidateChangedMappings(tx,a,fresh);await tx.myCsfConnection.update({where:{id:a.id},data:{...scopeData(fresh),version:{increment:1}}});await audit(tx,c,a.id,'mycsf.scope_changed',{from:a.scopeHash,to:fresh.hash,count:fresh.rows.length});});conflict('MyCSF scope changed. Review the latest assessment before exporting.');}
  const file=await downloadEvidence(c,f.id,storage);
  const filename='RegPilot-'+m.sha256+(file.filename.includes('.')?'.'+file.filename.split('.').pop()!.replace(/[^A-Za-z0-9]/g,'').slice(0,8):'');
  const documents=async()=> (await api.documents(a.assessmentId,d.documentType)).filter(doc=>doc.assessment===a.assessmentId&&doc.type===d.documentType);
  let docs=await documents();let matching=docs.filter(doc=>d.existingDocument?doc.id===d.existingDocument:doc.filename===filename||doc.name===filename);
  if(matching.length>1)conflict('Several MyCSF documents matched. Select the correct remote document ID.');
  let remote=matching[0];
  if(!remote){
   if(d.existingDocument)conflict('That document is outside the selected assessment or document type.');
   if(!uploadParts())conflict('The MyCSF upload format awaits vendor confirmation. Choose an existing remote document to verify and link.');
   await transaction(c,async tx=>{
    await validate(tx);const prior=await tx.auditEvent.findFirst({where:{organizationId:c.organizationId,entityType:'MyCsfUpload',entityId:marker,action:'mycsf.upload_reserved'}});
    if(prior)conflict('An earlier upload may have reached MyCSF. Supply its remote document ID or wait for the document listing to update.');
    await tx.auditEvent.create({data:{organizationId:c.organizationId,actorId:c.userId,entityType:'MyCsfUpload',entityId:marker,action:'mycsf.upload_reserved',details:{assessment:a.assessmentId,sha256:m.sha256,documentType:d.documentType}}});
   });
   const id=await api.upload(a.assessmentId,filename,file.bytes,file.contentType,d.typeName);docs=await documents();remote=docs.find(doc=>doc.id===id)!;
   if(!remote)conflict('Upload acknowledged. Refresh the remote document listing to reconcile its attachment.');
  }
  await api.verifyDocument(remote.id,remote.attachment,m.sha256);
  await transaction(c,validate);
  await api.link(a.assessmentId,m.buid,remote.id,m.levels as MaturityLevel[]);
  await transaction(c,async tx=>{await validate(tx);await tx.myCsfMapping.update({where:{id:m.id},data:{remoteDocumentId:remote.id,exportedAt:new Date()}});await audit(tx,c,a.id,'mycsf.document_linked',{mapping:m.id,buid:m.buid,document:remote.id,sha256:m.sha256,scopeHash:a.scopeHash,levels:m.levels});});
  return {document:remote.id,reused:false};
 }finally{await db.myCsfConnection.updateMany({where:{id:a.id,organizationId:c.organizationId,leaseId:lease},data:{leaseId:null,leaseUntil:null}});}
}
