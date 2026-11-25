import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseScheduleProof} from '../lib/server/database-schedule-proof';
test('scheduled database proof requires the release, attempt, successful admission and a live artifact digest',async()=>{
 const sha='a'.repeat(40),repo={full_name:'alanscott1uk-dev/regpilot-ai.'},run={id:31,run_attempt:2,path:'.github/workflows/integration-directory.yml',status:'completed',head_sha:sha,repository:repo,head_repository:repo};
 const job={id:51,name:'database-source (mssql)',run_id:31,conclusion:'success',steps:[{name:'Verify timed source failure and recovery through the workspace API',conclusion:'success'}]};
 const artifact={id:71,name:'scheduled-database-mssql-'+sha+'-2',workflow_run:{id:31,head_sha:sha},expired:false,expires_at:new Date(Date.now()+60_000).toISOString(),digest:'sha256:'+sha+'b'.repeat(24)};
 const read:typeof fetch=async url=>Response.json(String(url).includes('head_sha=')?{workflow_runs:[run]}:String(url).includes('/jobs?')?{jobs:[job]}:{artifacts:[artifact]});
 const result=await databaseScheduleProof(sha,read);assert.deepEqual(result.rows.map(r=>r.engine),['mssql']);assert.match(result.rows[0].receiptUrl,/artifacts\/71$/);
 artifact.expired=true;assert.equal((await databaseScheduleProof(sha,read)).rows.length,0);artifact.expired=false;
 job.steps[0].conclusion='skipped';assert.equal((await databaseScheduleProof(sha,read)).rows.length,0);job.steps[0].conclusion='success';
 artifact.workflow_run.head_sha='e'.repeat(40);assert.equal((await databaseScheduleProof(sha,read)).rows.length,0);
});
