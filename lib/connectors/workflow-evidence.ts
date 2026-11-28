import {atStep,type CollectionStep} from './collection-step';
import {z} from 'zod';
import {providerReader} from './bounded-http';
import {CollectionError,type ConnectorCheck} from './github';
import type {Observation} from './observation';
export const workflowTarget=z.object({
 scope:z.string().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9_.-]{0,99}$/),
 record:z.string().regex(/^[A-Za-z0-9_-]{1,80}\.ya?ml$/),
 reference:z.string().max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/).refine(v=>!v.includes('..')&&!v.includes('//')&&!v.endsWith('/'))
});
const hash=z.string().regex(/^[0-9a-f]{40}$/),positive=z.number().int().positive();
const runSchema=z.object({id:positive,workflow_id:positive,head_sha:hash,head_branch:z.string(),run_attempt:positive,repository:z.object({id:positive}),head_repository:z.object({id:positive}).nullable(),status:z.literal('completed'),conclusion:z.string().nullable(),updated_at:z.iso.datetime({offset:true})});
export async function collectWorkflow(target:z.infer<typeof workflowTarget>,token:string,fetcher:typeof fetch=fetch):Promise<Observation>{
 const {scope,record,reference}=workflowTarget.parse(target);
 const read=providerReader(fetcher,{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'});
 const base='https://api.github.com/repos/'+scope,site='https://github.com/'+scope;
 const get=async(step:CollectionStep,path:string)=>(await atStep(step,()=>read(base+path)))!.body;
 const repo=z.object({id:positive,full_name:z.string()}).parse(await get('repository',''));
 if(repo.full_name.toLowerCase()!==scope)throw new CollectionError('TARGET_MISMATCH',undefined,'repository');
 const wf=z.object({id:positive,path:z.string(),state:z.string()}).parse(await get('workflow','/actions/workflows/'+record));
 if(wf.path!=='.github/workflows/'+record)throw new CollectionError('TARGET_MISMATCH',undefined,'workflow');
 const branch=z.object({name:z.string(),commit:z.object({sha:hash})}).parse(await get('branch','/branches/'+encodeURIComponent(reference)));
 if(branch.name!==reference)throw new CollectionError('TARGET_MISMATCH',undefined,'branch');
 const url='/actions/workflows/'+wf.id+'/runs?'+new URLSearchParams({branch:reference,status:'completed',per_page:'3'});
 const runs=z.object({total_count:z.number().int().nonnegative(),workflow_runs:z.array(runSchema).max(3)}).parse(await get('runs',url));
 if(runs.total_count<runs.workflow_runs.length||new Set(runs.workflow_runs.map(r=>r.id)).size!==runs.workflow_runs.length)throw new CollectionError('INVALID_RESPONSE',undefined,'runs');
 const checks:ConnectorCheck[]=[];
 function add(id:string,label:string,status:ConnectorCheck['status'],observed:string,sourceUrl:string){checks.push({id,label,status,observed,sourceUrl,nextStep:'Inspect the workflow run and jobs in the source repository.'});}
 const workflow=site+'/actions/workflows/'+record;
 add('workflow-enabled','Workflow is enabled',wf.state==='active'?'PASS':'FAIL',wf.state,workflow);
 const hasCurrent=runs.workflow_runs.some(r=>r.head_sha===branch.commit.sha&&r.head_repository?.id===repo.id);
 add('workflow-current','Completed run for the current branch revision',hasCurrent?'PASS':'UNKNOWN',hasCurrent?branch.commit.sha:'No matching completed run among the three latest',workflow);
 add('workflow-history','At least two distinct completed source runs returned',runs.workflow_runs.length>=2?'PASS':'UNKNOWN',runs.workflow_runs.length+' of '+runs.total_count+' completed runs returned',workflow);
 for(const [index,r] of runs.workflow_runs.entries()){
  if(r.repository.id!==repo.id||r.workflow_id!==wf.id||r.head_branch!==reference)throw new CollectionError('TARGET_MISMATCH',undefined,'runs');
  const link=site+'/actions/runs/'+r.id,runKey='run-'+(index+1);
  const own=r.head_repository?.id===repo.id;
  add(runKey+'-revision','Run belongs to the monitored source repository',own?'PASS':'UNKNOWN',own?r.head_sha:'External or unconfirmed source',link);
  add(runKey+'-decision','Recorded workflow decision',r.conclusion==='success'?(own?'PASS':'UNKNOWN'):r.conclusion==='failure'||r.conclusion==='timed_out'?'FAIL':'UNKNOWN',String(r.conclusion??'unknown')+' · run '+r.id+' · attempt '+r.run_attempt,link);
  const jobs=z.object({total_count:z.number().int().nonnegative(),jobs:z.array(z.object({id:positive,run_id:positive,head_sha:hash,run_attempt:positive.optional(),status:z.string(),conclusion:z.string().nullable()})).max(20)}).parse(await get('jobs','/actions/runs/'+r.id+'/attempts/'+r.run_attempt+'/jobs?per_page=20'));
  if(jobs.jobs.some(j=>j.run_id!==r.id||j.head_sha!==r.head_sha||j.run_attempt!==undefined&&j.run_attempt!==r.run_attempt)||new Set(jobs.jobs.map(j=>j.id)).size!==jobs.jobs.length||jobs.total_count<jobs.jobs.length)throw new CollectionError('TARGET_MISMATCH',undefined,'jobs');
  const failed=jobs.jobs.filter(j=>['failure','timed_out','action_required'].includes(j.conclusion??'')),successes=jobs.jobs.filter(j=>j.status==='completed'&&j.conclusion==='success');
  const full=jobs.jobs.length===jobs.total_count&&jobs.total_count>0;
  add(runKey+'-jobs','Jobs completed successfully on the recorded attempt',failed.length?'FAIL':own&&full&&successes.length===jobs.total_count?'PASS':'UNKNOWN',successes.length+' successful · '+failed.length+' failed · '+jobs.jobs.length+'/'+jobs.total_count+' inspected',link);
 }
 const end=z.object({name:z.string(),commit:z.object({sha:hash})}).parse(await get('branch','/branches/'+encodeURIComponent(reference)));
 if(end.name!==reference||end.commit.sha!==branch.commit.sha)throw new CollectionError('TARGET_MISMATCH',undefined,'branch');
 return {engine:'github-workflow-runs-1',capturedAt:new Date().toISOString(),sourceUrl:workflow,checks,limitations:['Latest three completed runs and up to 20 jobs on each recorded attempt. Approval of the release itself requires separate evidence.']};
}
