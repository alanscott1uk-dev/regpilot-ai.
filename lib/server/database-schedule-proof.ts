import {providerReader} from '../connectors/bounded-http';

const repo='alanscott1uk-dev/regpilot-ai.',base='https://api.github.com/repos/'+repo,web='https://github.com/'+repo;
const engines:Record<string,string>={postgres:'PostgreSQL',mysql:'MySQL',tidb:'TiDB',mssql:'Microsoft SQL Server',mongodb:'MongoDB',clickhouse:'ClickHouse',cockroachdb:'CockroachDB'};
type Row={engine:string;name:string;jobUrl:string;receiptUrl:string;digest:string;expiresAt:string};
export async function databaseScheduleProof(revision:string,fetcher:typeof fetch=fetch){
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Invalid release identifier.');
 const get=providerReader(fetcher,{'X-GitHub-Api-Version':'2022-11-28'},12000),rows:Row[]=[];
 const runs=(await get(base+'/actions/runs?head_sha='+revision+'&per_page=30'))!.body.workflow_runs;
 if(!Array.isArray(runs))throw Error('Missing workflow list.');
 const run=runs.filter(r=>r?.path==='.github/workflows/integration-directory.yml'&&r.head_sha===revision&&r.repository?.full_name===repo&&r.head_repository?.full_name===repo&&Number.isSafeInteger(r.id)&&r.id>0&&Number.isSafeInteger(r.run_attempt)&&r.run_attempt>0).sort((a,b)=>b.id-a.id)[0];
 if(!run)return {revision,runUrl:null,state:'No release run found',rows,applications:null};
 const root='/actions/runs/'+run.id,attempt=root+'/attempts/'+run.run_attempt,runUrl=web+attempt;
 if(run.status!=='completed')return {revision,runUrl,state:'Collection tests running',rows,applications:null};
 const [jobsResponse,artifactsResponse]=await Promise.all([get(base+root+'/jobs?filter=latest&per_page=100'),get(base+root+'/artifacts?per_page=100')]);
 const jobs=jobsResponse?.body.jobs,artifacts=artifactsResponse?.body.artifacts;
 if(!Array.isArray(jobs)||!Array.isArray(artifacts))throw Error('Incomplete provider receipt list.');
 function verifiedArtifact(jobName:string,step:string,prefix:string){
  const job=jobs.find((j:any)=>j.name===jobName&&j.conclusion==='success'&&j.run_id===run.id&&Number.isSafeInteger(j.id)&&j.id>0&&
   j.steps?.some((s:{name:string;conclusion:string})=>s.name===step&&s.conclusion==='success'));
  if(!job||!Number.isSafeInteger(job.run_attempt)||job.run_attempt<1||job.run_attempt>run.run_attempt)return null;
  // GitHub can retry only failed jobs. Each successful job retains the artifact from its own attempt.
  const matching=artifacts.filter((a:any)=>a.name===prefix+'-'+revision+'-'+job.run_attempt&&a.workflow_run?.id===run.id&&a.workflow_run?.head_sha===revision&&
   !a.expired&&Date.parse(a.expires_at)>Date.now()&&Number.isSafeInteger(a.id)&&a.id>0&&/^sha256:[a-f0-9]{64}$/.test(a.digest));
  if(matching.length!==1)return null;
  const receipt=matching[0];
  return {jobUrl:web+root+'/job/'+job.id,receiptUrl:web+root+'/artifacts/'+receipt.id,digest:String(receipt.digest),expiresAt:String(receipt.expires_at)};
 }
 for(const [engine,name] of Object.entries(engines)){
  const record=verifiedArtifact('database-source ('+engine+')','Verify timed source failure and recovery through the workspace API','scheduled-database-'+engine);
  if(record)rows.push({engine,name,...record});
 }
 const applications=verifiedArtifact('monitored-applications','Monitor Gitea and Grafana through timed changes and credential renewal','business-application-recovery');
 return {revision,runUrl,applications,state:rows.length===Object.keys(engines).length?'All seven schedules verified':'Partial release evidence',rows};
}
