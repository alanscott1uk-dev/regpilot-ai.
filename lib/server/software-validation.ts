import {providerReader} from '../connectors/bounded-http';

const repo='alanscott1uk-dev/regpilot-ai.';
const web='https://github.com/'+repo,api='https://api.github.com/repos/'+repo;
// Search by commit because a PR workflow may be present on the feature branch before it reaches main.
export async function softwareValidation(revision:string,fetcher:typeof fetch=fetch){
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Invalid release identifier');
 const get=providerReader(fetcher,{'X-GitHub-Api-Version':'2022-11-28'});
 const runs=(await get(api+'/actions/runs?head_sha='+revision+'&per_page=100'))!.body.workflow_runs;
 if(!Array.isArray(runs))throw Error('Invalid workflow listing');
 const run=runs.filter(r=>r?.path==='.github/workflows/release-validation.yml'&&r.head_sha===revision&&r.repository?.full_name===repo&&r.head_repository?.full_name===repo&&Number.isSafeInteger(r.id)&&r.id>0&&Number.isSafeInteger(r.run_attempt)&&r.run_attempt>0).sort((a,b)=>b.id-a.id)[0];
 if(!run)return {state:'MISSING' as const,revision};
 const runUrl=web+'/actions/runs/'+run.id+'/attempts/'+run.run_attempt;
 if(run.status!=='completed'||run.conclusion!=='success')return {state:run.status!=='completed'?'RUNNING' as const:'FAILED' as const,revision,runUrl};
 const artifacts=(await get(api+'/actions/runs/'+run.id+'/artifacts?per_page=100'))!.body.artifacts;
 if(!Array.isArray(artifacts))throw Error('Invalid artifact listing');
 const name='pharma-validation-'+revision+'-'+run.run_attempt;
 const found=artifacts.filter(a=>a?.name===name&&!a.expired&&Date.parse(a.expires_at)>Date.now()&&a.workflow_run?.id===run.id&&a.workflow_run?.head_sha===revision&&Number.isSafeInteger(a.id)&&a.id>0&&/^sha256:[a-f0-9]{64}$/.test(a.digest));
 if(found.length!==1)return {state:'UNAVAILABLE' as const,revision,runUrl};
 const artifact=found[0];
 return {state:'AVAILABLE' as const,revision,runUrl,downloadUrl:web+'/actions/runs/'+run.id+'/artifacts/'+artifact.id,digest:String(artifact.digest),expiresAt:String(artifact.expires_at)};
}
