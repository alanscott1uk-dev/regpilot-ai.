import {z} from 'zod';
import {hashValue} from '../regulatory/intelligence';
import {casesSchema,LOSS_METHOD} from '../risk-loss';
import type {AuthorizedContext} from './authorization';
import {IntelligenceError,transaction} from './intelligence-service';
import {ADMIN,requireMember} from './workspace-member';
import {reviewedFileSchema} from './reviewed-files';

const selection=z.object({entities:z.array(z.object({id:z.uuid(),annualTreatmentCostGbp:z.number().int().min(0).max(1000000000).nullable()}).strict()).min(1).max(12),missingSites:z.array(z.string().trim().min(1).max(80)).max(30),scopeComplete:z.boolean()}).strict().refine(v=>new Set(v.entities.map(e=>e.id)).size===v.entities.length);
const request=z.object({selection,approveHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
const money=(events:number,low:number,likely:number,high:number)=>Math.round(events*(low+likely+high)/3);

export async function groupRiskReport(ctx:AuthorizedContext,raw:unknown){
 const d=request.parse(raw),entities=[...d.selection.entities].sort((a,b)=>a.id.localeCompare(b.id));
 if(!entities.some(e=>e.id===ctx.organizationId))throw new IntelligenceError('Include the selected workspace in the group scope',400);
 return transaction(ctx,async tx=>{
  for(const e of entities)await requireMember(tx,{...ctx,organizationId:e.id},ADMIN);
  const rows=[];
  for(const e of entities){
   const organisation=await tx.organization.findUniqueOrThrow({where:{id:e.id},select:{name:true}});
   const risks=await tx.riskRecord.findMany({where:{organizationId:e.id,status:{not:'ARCHIVED'}},orderBy:{id:'asc'},take:201,select:{id:true,title:true,version:true,likelihood:true,impact:true,reviewDueAt:true,lossScenarios:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,include:{evidence:true}}}});
   const exceptions:string[]=[],pieces=[],basis=[];
   if(risks.length>200)exceptions.push('Additional risks exceed the 200-record report limit');
   for(const r of risks.slice(0,200)){
    const scenario=r.lossScenarios[0],file=scenario?.evidence,expected=reviewedFileSchema.safeParse(scenario?.evidenceBasis),current=reviewedFileSchema.safeParse(file),cases=casesSchema.safeParse(scenario?.inputs);
    const grounded=!!scenario&&scenario.riskVersion===r.version&&scenario.method===LOSS_METHOD&&!!file&&file.reviewStatus==='APPROVED'&&file.scanStatus==='CLEAN'&&file.reviewedAt&&file.uploadedById!==file.reviewerId&&expected.success&&current.success&&hashValue(expected.data)===hashValue(current.data);
    basis.push({id:r.id,version:r.version,scenario:scenario?.id??null,file:grounded?file!.sha256:null});
    if(r.reviewDueAt.toISOString().slice(0,10)<new Date().toISOString().slice(0,10))exceptions.push(r.title+' — review overdue');
    if(r.likelihood*r.impact>=15)exceptions.push(r.title+' — high inherent rating');
    if(!grounded||!cases.success){exceptions.push(r.title+' — current, evidenced loss assumptions missing');continue;}
    const {before,after}=cases.data;
    pieces.push({baseline:money(before.eventsPerYear,before.low,before.likely,before.high),treated:after?money(after.eventsPerYear,after.low,after.likely,after.high):null});
   }
   if(!risks.length)exceptions.push('No active risk records in this entity');
   const covered=risks.length>0&&risks.length<=200&&pieces.length===risks.length;
   rows.push({organizationId:e.id,name:organisation.name,risks:risks.length>200?200:risks.length,limited:risks.length>200,covered,exceptions,baseline:covered?pieces.reduce((sum,v)=>sum+v.baseline,0):null,treated:covered&&pieces.every(v=>v.treated!==null)?pieces.reduce((sum,v)=>sum+v.treated!,0):null,annualTreatmentCostGbp:e.annualTreatmentCostGbp,basisHash:hashValue(basis)});
  }
  const missingSites=[...new Set(d.selection.missingSites)].sort(),complete=d.selection.scopeComplete&&!missingSites.length&&rows.every(r=>r.covered);
  const baseline=complete?rows.reduce((s,r)=>s+r.baseline!,0):null,after=complete&&rows.every(r=>r.treated!==null&&r.annualTreatmentCostGbp!==null)?rows.reduce((s,r)=>s+r.treated!+r.annualTreatmentCostGbp!,0):null;
  const report={currency:'GBP',rows,missingSites,scopeComplete:d.selection.scopeComplete,complete,baseline,afterTreatmentAndCost:after,annualNetReduction:baseline!==null&&after!==null?baseline-after:null};
  const digest=hashValue(report);
  if(d.approveHash&&d.approveHash!==digest)throw new IntelligenceError('Group risk inputs changed. Review the current report.',409);
  const where={organizationId:ctx.organizationId,entityType:'GroupRiskReport',entityId:digest,action:'risk.finance-review'};
  let receipt=await tx.auditEvent.findFirst({where:{...where,actorId:ctx.userId},select:{createdAt:true},orderBy:{createdAt:'desc'}});
  if(d.approveHash&&!receipt)receipt=await tx.auditEvent.create({data:{...where,actorId:ctx.userId,details:{reportHash:digest}},select:{createdAt:true}});
  return {...report,digest,reviewedByYouAt:receipt?.createdAt.toISOString()??null};
 });
}
