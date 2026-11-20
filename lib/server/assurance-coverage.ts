import type {Prisma} from '@prisma/client';
import {workspaceLink} from './workspace-journey';
import {RISK_LIMIT} from '../risk-register';

type CoverageRow={area:string; total:number; attention:number};
const rules:Record<string,[string,string,string]>={
 controls:['Control reviews','Enabled controls past their scheduled review date','/team/operations'],
 sources:['Regulatory monitoring','Enabled watches with a failed, missing or overdue successful check','/team/coverage'],
 connectors:['Evidence integrations','Enabled connections with a failed, missing or overdue successful collection','/team/operations'],
 vendors:['Supplier assurance','Active suppliers past their review date','/team/vendors'],
 access:['Access reviews','Open campaigns past their deadline','/team/access-reviews'],
 risks:['Risk reviews','Unarchived risks past their review date','/team/risks'],
 rooms:['Auditor access','Published audit rooms whose access period has expired','/team/audits'],
 requests:['Audit evidence requests','Open requests with overdue underlying tasks','/team/audit-requests'],
 questionnaires:['Customer questionnaires','Draft questionnaires still awaiting approval','/team/questionnaires'],
 api:['Customer API access','Unrevoked credentials whose expiry has passed','/team/developers']
};

/** Read inside the authorised administrator's repeatable-read briefing transaction. */
export async function assuranceCoverage(tx:Prisma.TransactionClient,organizationId:string,now:Date){
 const day=new Date(now.toISOString().slice(0,10)+'T00:00:00Z');
 const rows=await tx.$queryRaw<CoverageRow[]>`
  SELECT 'controls' AS area,count(*)::int AS total,count(*) FILTER(WHERE "nextReviewAt"<${day})::int AS attention FROM "ManagedControl" WHERE "organizationId"=${organizationId}::uuid AND enabled
  UNION ALL SELECT 'sources',count(*)::int,count(*) FILTER(WHERE "failureCode" IS NOT NULL OR "lastSuccessAt" IS NULL OR "lastSuccessAt"+("intervalHours"*interval '1 hour')<${now})::int FROM "WatchSchedule" WHERE "organizationId"=${organizationId}::uuid AND enabled
  UNION ALL SELECT 'connectors',count(*)::int,count(*) FILTER(WHERE "failureCode" IS NOT NULL OR "lastSuccessAt" IS NULL OR "lastSuccessAt"+("intervalHours"*interval '1 hour')<${now})::int FROM "EvidenceConnector" WHERE "organizationId"=${organizationId}::uuid AND enabled
  UNION ALL SELECT 'vendors',count(*)::int,count(*) FILTER(WHERE "nextReviewAt"<${day})::int FROM "Vendor" WHERE "organizationId"=${organizationId}::uuid AND active
  UNION ALL SELECT 'access',count(*)::int,count(*) FILTER(WHERE "dueDate"<${now})::int FROM "AccessCampaign" WHERE "organizationId"=${organizationId}::uuid AND status='ACTIVE'
  UNION ALL SELECT 'risks',count(*)::int,count(*) FILTER(WHERE "reviewDueAt"<${day})::int FROM "RiskRecord" WHERE "organizationId"=${organizationId}::uuid AND status<>'ARCHIVED'
  UNION ALL SELECT 'rooms',count(*)::int,count(*) FILTER(WHERE "expiresAt"<=${now})::int FROM "AuditRoom" WHERE "organizationId"=${organizationId}::uuid AND status='PUBLISHED'
  UNION ALL SELECT 'requests',count(*)::int,count(*) FILTER(WHERE t."dueDate"<${day})::int FROM "AuditRequest" r JOIN "Obligation" t ON t.id=r."taskId" AND t."organizationId"=r."organizationId" WHERE r."organizationId"=${organizationId}::uuid AND r.status NOT IN ('ACCEPTED','CANCELLED')
  UNION ALL SELECT 'questionnaires',count(*)::int,count(*) FILTER(WHERE status='DRAFT')::int FROM "AssuranceQuestionnaire" WHERE "organizationId"=${organizationId}::uuid AND status<>'WITHDRAWN'
  UNION ALL SELECT 'api',count(*)::int,count(*) FILTER(WHERE "expiresAt"<=${now})::int FROM "CustomerApiCredential" WHERE "organizationId"=${organizationId}::uuid AND "revokedAt" IS NULL
 `;
 const risks=await tx.riskRecord.findMany({where:{organizationId,status:{not:'ARCHIVED'}},orderBy:[{reviewDueAt:'asc'},{id:'asc'}],take:RISK_LIMIT,select:{id:true,title:true,impact:true,likelihood:true}});
 return {checkedAt:now.toISOString(),measures:rows.map(row=>{
  const [title,description,path]=rules[row.area];
  return {...row,title,description,href:workspaceLink(organizationId,path,row.area==='controls'?{view:'controls'}:row.area==='connectors'?{view:'connections'}:{})};
 }),risks:risks.map(risk=>({...risk,href:workspaceLink(organizationId,'/team/risks',{riskId:risk.id})})),riskLimit:RISK_LIMIT};
}
