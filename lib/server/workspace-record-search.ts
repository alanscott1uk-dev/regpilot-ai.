import type {Prisma} from '@prisma/client';
import {searchTerms} from '../retrieval/bm25';
import {normalisePublicationText} from '../regulatory/publication-query.mjs';
import {workspaceLink} from './workspace-journey';

const destinations={
 Control:['/team/operations',''],
 Risk:['/team/risks','riskId'],
 'AI system':['/team/ai-inventory','systemId'],
 Supplier:['/team/vendors','vendorId'],
 'Access review':['/team/access-reviews',''],
 Questionnaire:['/team/questionnaires','questionnaireId'],
 'Audit room':['/team/audits',''],
 'Audit request':['/team/audit-requests',''],
 Obligation:['/team/work','taskId'],
 Requirement:['/team/library',''],
 Training:['/team/training',''],
 Policy:['/team/people',''],
 'Regulatory change':['/team/changes','responseId'],
 'Quality case':['/team/quality','caseId'],
 'Evidence connection':['/team/operations','']
} as const;
type RecordRow={kind:keyof typeof destinations;id:string;target:string;title:string;status:string};
const filler=new Set('about find show give list need me relevant current open linked records record our business organisation latest supporting please'.split(' '));

/** Search operational metadata, not evidence bytes or draft questionnaire answers. Caller checks admin and product scope. */
export async function searchWorkspaceRecords(tx:Prisma.TransactionClient,org:string,question:string){
 const terms=[...new Set(searchTerms(normalisePublicationText(question)))].filter(t=>!filler.has(t)).slice(0,24);
 if(!terms.length)return [];
 // searchTerms emits only Unicode letters and numbers. The tsquery operand is also a bound parameter.
 const query=terms.join(' | ');
 const rows=await tx.$queryRaw<RecordRow[]>`
 WITH records(kind,id,target,title,status,detail) AS (
  SELECT 'Control',id,"importId",title,'Enabled',description||' '||"testProcedure" FROM "ManagedControl" WHERE "organizationId"=${org}::uuid AND enabled
  UNION ALL SELECT 'Risk',id,id,title,status,description||' '||category FROM "RiskRecord" WHERE "organizationId"=${org}::uuid AND status<>'ARCHIVED'
  UNION ALL SELECT 'AI system',id,id,name,'Inventory version '||version,kind||' AI governance '||coalesce(profile->>'purpose','') FROM "AiSystem" WHERE "organizationId"=${org}::uuid
  UNION ALL SELECT 'Supplier',id,id,name,criticality,service||' vendor '||CASE WHEN "licenceScope" IS NULL THEN '' ELSE ' MHRA WDA wholesale licence authorisation supplier site '||coalesce("licenceScope"->>'premises','')||' '||coalesce("licenceScope"->>'number','')||' '||coalesce("licenceScope"->>'companyNumber','')||' '||coalesce("licenceScope"->>'activity','') END FROM "Vendor" WHERE "organizationId"=${org}::uuid AND active
  UNION ALL SELECT 'Access review',id,id,title,status,'access campaign' FROM "AccessCampaign" WHERE "organizationId"=${org}::uuid
  UNION ALL SELECT 'Questionnaire',id,id,title,status,scope FROM "AssuranceQuestionnaire" WHERE "organizationId"=${org}::uuid AND status<>'WITHDRAWN'
  UNION ALL SELECT 'Audit room',id,id,title,status,purpose FROM "AuditRoom" WHERE "organizationId"=${org}::uuid AND status<>'CLOSED'
  UNION ALL SELECT 'Audit request',id,id,title,status,instructions FROM "AuditRequest" WHERE "organizationId"=${org}::uuid AND status<>'CANCELLED'
  UNION ALL SELECT 'Obligation',id,id,title,status::text,category FROM "Obligation" WHERE "organizationId"=${org}::uuid
  UNION ALL SELECT 'Requirement',r.id,r.id,r.collection||' · '||r.reference,'Accepted revision '||v.number,r.collection||' framework' FROM "LibraryRequirement" r JOIN "LibraryRevision" v ON v."requirementId"=r.id AND v."organizationId"=r."organizationId" AND v.number=r."currentRevision" WHERE r."organizationId"=${org}::uuid AND v.status='ACCEPTED'
  UNION ALL SELECT 'Regulatory change',id,id,title,status,'regulatory change response' FROM "ChangeResponse" WHERE "organizationId"=${org}::uuid
  UNION ALL SELECT 'Quality case',id,id,title,status,kind||' '||description||' corrective action CAPA' FROM "QualityCase" WHERE "organizationId"=${org}::uuid
  UNION ALL SELECT 'Evidence connection',id,id,provider||' · '||repository,CASE WHEN enabled THEN 'Enabled' ELSE 'Paused' END,'integration evidence connector' FROM "EvidenceConnector" WHERE "organizationId"=${org}::uuid
  UNION ALL SELECT 'Training',id,id,title,'Active',description||' '||"businessRole" FROM "TrainingCurriculum" WHERE "organizationId"=${org}::uuid AND active
  UNION ALL SELECT 'Policy',p.id,p.id,p.title,'Published revision '||v.number,v.summary||' sop procedure' FROM "Policy" p JOIN "PolicyRevision" v ON v."policyId"=p.id AND v."organizationId"=p."organizationId" AND v.number=p."currentRevision" WHERE p."organizationId"=${org}::uuid AND p.active AND v.status='PUBLISHED'
 ), indexed AS (
  SELECT *,setweight(to_tsvector('english',title),'A')||setweight(to_tsvector('english',kind),'B')||to_tsvector('english',detail) AS words FROM records
 ), matched AS (
  SELECT indexed.*,ts_rank(words,q) AS score FROM indexed CROSS JOIN to_tsquery('english',${query}) AS q WHERE words @@ q
 ), grouped AS (
  SELECT *,row_number() OVER(PARTITION BY kind ORDER BY score DESC,title,id) AS position FROM matched
 )
 SELECT kind,id,target,title,status FROM grouped WHERE position<=3 ORDER BY score DESC,kind,title,id
 `;
 return rows.map(row=>{
  const [path,key]=destinations[row.kind];
  return {kind:row.kind,id:row.id,title:row.title,status:row.status,href:workspaceLink(org,path,row.kind==='Control'?{view:'controls'}:row.kind==='Evidence connection'?{view:'connections'}:key?{[key]:row.target}:{})};
 });
}
