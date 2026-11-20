import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {hashValue} from '../regulatory/intelligence';
import {PRODUCT_LIMITS,createProductInput,changeProductInput,evidenceScopeInput,productSnapshotSchema,productQuestionnaireContextSchema,answerProductContextSchema,questionProductContextSchema,type ProductSnapshot} from '../product-scope';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import type {AuthorizedContext} from './authorization';

type Tx=Prisma.TransactionClient;
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const org=(c:AuthorizedContext)=>({organizationId:c.organizationId});
const snapshot=(p:ProductSnapshot)=>productSnapshotSchema.parse({id:p.id,code:p.code,name:p.name,version:p.version});
export type ProductScopeState={products:Map<string,ProductSnapshot&{status:string}>;applicability:Map<string,{mode:'GLOBAL'|'PRODUCT';version:number;productIds:string[]}>};
export async function loadProductScopeState(tx:Tx,organizationId:string,evidenceIds:string[]):Promise<ProductScopeState>{
 const ids=[...new Set(evidenceIds)].sort();if(ids.length>PRODUCT_LIMITS.evidence)throw new IntelligenceError('Product evidence projection exceeds its bounded limit',409);
 const [products,scopes]=await Promise.all([tx.companyProduct.findMany({where:{organizationId},select:{id:true,code:true,name:true,version:true,status:true},orderBy:{id:'asc'},take:PRODUCT_LIMITS.products+1}),ids.length?tx.evidenceApplicability.findMany({where:{organizationId,evidenceId:{in:ids}},include:{products:{select:{productId:true},orderBy:{productId:'asc'}}}}):Promise.resolve([])]);
 if(products.length>PRODUCT_LIMITS.products)throw new IntelligenceError('Product catalogue exceeds its supported limit',409);
 return {products:new Map(products.map(p=>[p.id,{...snapshot(p),status:p.status}])),applicability:new Map(scopes.filter(s=>s.mode==='GLOBAL'||s.mode==='PRODUCT').map(s=>[s.evidenceId,{mode:s.mode as 'GLOBAL'|'PRODUCT',version:s.version,productIds:s.products.map(p=>p.productId)}]))};
}
export function currentProductFromState(state:ProductScopeState,id:string):ProductSnapshot{
 const p=state.products.get(id);if(!p||p.status!=='ACTIVE')throw new IntelligenceError('The selected product is unavailable or archived',409);return snapshot(p);
}
export function filterProductEvidenceFromState(state:ProductScopeState,evidenceIds:string[],productId:string|null){
 const product=productId?currentProductFromState(state,productId):null;
 const evidence=[...new Set(evidenceIds)].sort().flatMap(id=>{const s=state.applicability.get(id);if(!s||s.mode==='GLOBAL'&&s.productIds.length||s.mode==='PRODUCT'&&(!productId||!s.productIds.includes(productId)))return [];return [{id,...s}];});
 return {scope:{product,evidence},eligibleEvidenceIds:evidence.map(e=>e.id)};
}
export async function filterKnowledgeEvidence(tx:Tx,organizationId:string,evidenceIds:string[],productId:string|null){return filterProductEvidenceFromState(await loadProductScopeState(tx,organizationId,evidenceIds),evidenceIds,productId);}
export function captureQuestionProductContextFromState(state:ProductScopeState,questionnaire:{productContext?:unknown},question:{productId?:string|null;productName?:string},evidenceIds:string[]){
 if(!questionnaire.productContext&&!question.productId)return null;
 const saved=productQuestionnaireContextSchema.safeParse(questionnaire.productContext);if(!saved.success||!question.productId)throw new IntelligenceError('Questionnaire product context is unavailable',409);
 const chosen=saved.data.products.find(p=>p.id===question.productId),current=currentProductFromState(state,question.productId);
 if(!chosen||hashValue(chosen)!==hashValue(current)||question.productName!==chosen.name)throw new IntelligenceError('The selected product changed. Refresh questionnaire product versions before preparing or confirming responses.',409);
 const filtered=filterProductEvidenceFromState(state,evidenceIds,question.productId);
 if(filtered.eligibleEvidenceIds.length!==new Set(evidenceIds).size)throw new IntelligenceError('Selected evidence must explicitly apply to this product or all products',409);
 return questionProductContextSchema.parse({format:'questionnaire-product-v1',product:current,evidence:filtered.scope.evidence});
}
export async function captureQuestionProductContext(tx:Tx,organizationId:string,questionnaire:{productContext?:unknown},question:{productId?:string|null;productName?:string},evidenceIds:string[]){return captureQuestionProductContextFromState(await loadProductScopeState(tx,organizationId,evidenceIds),questionnaire,question,evidenceIds);}
export function captureAnswerProductContextFromState(state:ProductScopeState,input:{productId?:string|null;globalForProducts?:boolean},evidenceIds:string[]){
 if(input.productId&&input.globalForProducts)throw new IntelligenceError('Choose a product or global applicability, not both',400);
 if(!input.productId&&!input.globalForProducts)return null;
 const filtered=filterProductEvidenceFromState(state,evidenceIds,input.productId||null);
 if(filtered.eligibleEvidenceIds.length!==new Set(evidenceIds).size)throw new IntelligenceError(input.productId?'Every supporting file must explicitly apply to the selected product':'A global answer requires evidence explicitly applicable to all products',409);
 return answerProductContextSchema.parse(input.productId?{format:'product-answer-v1',mode:'PRODUCT',product:filtered.scope.product}:{format:'product-answer-v1',mode:'GLOBAL'});
}
export function assertAnswerProductContextFromState(state:ProductScopeState,answer:{productId?:string|null;productContext?:unknown},evidenceIds:string[]){
 if(!answer.productContext&&!answer.productId)return;
 const context=answerProductContextSchema.safeParse(answer.productContext);if(!context.success)throw new IntelligenceError('Answer product context failed its integrity check',409);
 const now=captureAnswerProductContextFromState(state,{productId:answer.productId,globalForProducts:context.data.mode==='GLOBAL'},evidenceIds);
 if(hashValue(now)!==hashValue(context.data))throw new IntelligenceError('Product details or evidence applicability changed. Revise and review the answer.',409);
}
export async function captureQuestionnaireProducts(tx:Tx,organizationId:string,productIds:string[]){
 if(!productIds.length)return null;if(productIds.length>10||new Set(productIds).size!==productIds.length)throw new IntelligenceError('Choose up to ten distinct products',400);
 const state=await loadProductScopeState(tx,organizationId,[]);return productQuestionnaireContextSchema.parse({format:'product-questionnaire-v1',products:productIds.map(id=>currentProductFromState(state,id)).sort((a,b)=>a.id.localeCompare(b.id))});
}
async function audit(tx:Tx,c:AuthorizedContext,id:string,action:string,details:unknown){await tx.auditEvent.create({data:{...org(c),actorId:c.userId,entityType:'ProductScope',entityId:id,action:'product_scope.'+action,details:json(details)}});}
export async function productWorkspace(c:AuthorizedContext,requestKey?:string){return transaction(c,async tx=>{
 const actor=await requireMember(tx,c,WRITER);if(requestKey)z.uuid().parse(requestKey);
 const [products,files]=await Promise.all([tx.companyProduct.findMany({where:org(c),orderBy:[{status:'asc'},{name:'asc'}],take:100}),tx.evidence.findMany({where:{...org(c),scanStatus:'CLEAN',reviewStatus:'APPROVED'},orderBy:[{createdAt:'desc'},{id:'asc'}],take:100,select:{id:true,filename:true,reviewVersion:true,productApplicability:{include:{products:{select:{productId:true}}}}}})]);
 const product=requestKey?products.find(p=>p.createKey===requestKey&&p.createdById===c.userId):null;
 const scopeOperation=requestKey?await tx.auditEvent.findFirst({where:{...org(c),entityType:'EvidenceProductOperation',entityId:hashValue({organizationId:c.organizationId,actorId:c.userId,requestKey}),actorId:c.userId},select:{details:true}}):null;
 const scopeResult=scopeOperation?.details as {result?:{id:string;reviewVersion:number}}|null;
 return {admin:ADMIN.includes(actor.role),products:products.map(({createKey:_key,...p})=>p),evidence:files.map(f=>({id:f.id,filename:f.filename,reviewVersion:f.reviewVersion,mode:f.productApplicability?.mode||'UNSCOPED',productIds:f.productApplicability?.products.map(p=>p.productId)||[],scopeVersion:f.productApplicability?.version||0})),operation:product?{kind:'PRODUCT' as const,id:product.id,requestKey}:scopeResult?.result?{kind:'EVIDENCE_SCOPE' as const,...scopeResult.result,requestKey}:null,limits:PRODUCT_LIMITS};
 });}
export async function createProduct(c:AuthorizedContext,input:unknown){const d=createProductInput.parse(input);return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const existing=await tx.companyProduct.findUnique({where:{organizationId_createKey:{organizationId:c.organizationId,createKey:d.requestKey}}});
 if(existing){const e=await tx.auditEvent.findFirst({where:{...org(c),entityId:existing.id,action:'product_scope.created'},select:{details:true}});if(existing.createdById!==c.userId||(e?.details as {requestHash?:string})?.requestHash!==hashValue(d))throw new IntelligenceError('This product request key belongs to different details',409);return {id:existing.id,reused:true};}
 if(await tx.companyProduct.count({where:org(c)})>=100)throw new IntelligenceError('This company has reached its 100-product limit',429);
 if(await tx.companyProduct.findUnique({where:{organizationId_code:{organizationId:c.organizationId,code:d.code}}}))throw new IntelligenceError('Use a unique product code within this company',409);
 const {requestKey,confirm:_confirm,...fields}=d,row=await tx.companyProduct.create({data:{...org(c),createdById:c.userId,createKey:requestKey,...fields}});await audit(tx,c,row.id,'created',{requestHash:hashValue(d),product:snapshot(row)});return {id:row.id,reused:false};
 });}
export async function changeProduct(c:AuthorizedContext,id:string,input:unknown){const d=changeProductInput.parse(input);return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const row=await tx.companyProduct.findFirst({where:{id,...org(c)}});if(!row)throw new IntelligenceError('Product not found',404);if(row.version!==d.version)throw new IntelligenceError('Product changed; refresh before editing',409);
 if(d.action==='UPDATE'&&await tx.companyProduct.findFirst({where:{...org(c),code:d.code,id:{not:id}}}))throw new IntelligenceError('Use a unique product code within this company',409);
 const data=d.action==='UPDATE'?{code:d.code,name:d.name,description:d.description}: {status:d.action==='ARCHIVE'?'ARCHIVED':'ACTIVE'};
 const saved=await tx.companyProduct.update({where:{id},data:{...data,version:{increment:1}}});await audit(tx,c,id,d.action.toLowerCase(),{previous:snapshot(row),current:snapshot(saved),status:saved.status,notes:d.notes});return {id,version:saved.version};
 });}
export async function setEvidenceApplicability(c:AuthorizedContext,input:unknown){const d=evidenceScopeInput.parse(input);return transaction(c,async tx=>{
 await requireMember(tx,c,ADMIN);const key=hashValue({organizationId:c.organizationId,actorId:c.userId,requestKey:d.requestKey}),requestHash=hashValue({...d,productIds:[...d.productIds].sort()});
 const prior=await tx.auditEvent.findFirst({where:{...org(c),entityType:'EvidenceProductOperation',entityId:key},select:{details:true}});
 if(prior){const saved=prior.details as {requestHash?:string;result?:{id:string;reviewVersion:number}};if(saved.requestHash!==requestHash||!saved.result)throw new IntelligenceError('This evidence-scope request key belongs to different details',409);return {...saved.result,reused:true};}
 const file=await tx.evidence.findFirst({where:{id:d.evidenceId,...org(c)}});if(!file)throw new IntelligenceError('Evidence not found',404);
 if(file.reviewVersion!==d.reviewVersion)throw new IntelligenceError('Evidence changed; refresh before changing applicability',409);
 if(file.scanStatus!=='CLEAN'||file.reviewStatus!=='APPROVED'||!file.reviewedAt)throw new IntelligenceError('Only current approved evidence can be assigned product applicability',409);
 const state=await loadProductScopeState(tx,c.organizationId,[file.id]);for(const id of d.productIds)currentProductFromState(state,id);
 const previous=state.applicability.get(file.id),next={mode:d.mode,productIds:[...d.productIds].sort()},changed=(previous?.mode||'UNSCOPED')!==next.mode||hashValue(previous?.productIds||[])!==hashValue(next.productIds);
 let reviewVersion=file.reviewVersion;
 if(changed){
  if(d.mode==='UNSCOPED')await tx.evidenceApplicability.deleteMany({where:{...org(c),evidenceId:file.id}});
  else{await tx.evidenceApplicability.upsert({where:{evidenceId_organizationId:{evidenceId:file.id,organizationId:c.organizationId}},create:{...org(c),evidenceId:file.id,mode:d.mode,updatedById:c.userId},update:{mode:d.mode,updatedById:c.userId,version:{increment:1}}});await tx.evidenceProductLink.deleteMany({where:{...org(c),evidenceId:file.id}});if(d.productIds.length)await tx.evidenceProductLink.createMany({data:d.productIds.map(productId=>({...org(c),evidenceId:file.id,productId}))});}
  const updated=await tx.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});reviewVersion=updated.reviewVersion;
 }
 const result={id:file.id,reviewVersion};await tx.auditEvent.create({data:{...org(c),actorId:c.userId,entityType:'EvidenceProductOperation',entityId:key,action:'product_scope.evidence_applicability',details:json({requestHash,result,previous:previous||null,current:next,notes:d.notes,changed})}});return {...result,reused:false};
 });}
