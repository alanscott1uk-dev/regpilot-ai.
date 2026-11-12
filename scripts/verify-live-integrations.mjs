/** Real read-only GitHub contract check. The Actions job supplies a short-lived,
 * repository-scoped token only to this step. No provider body or token is logged. */
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as module from '../lib/connectors/github.ts';
const collect=module.collectGithub||module.default?.collectGithub;
const repository=process.env.GITHUB_REPOSITORY,branch=process.env.GITHUB_BASE_REF||process.env.GITHUB_REF_NAME||'main';
const report={format:'regpilot-live-contract-v1',checkedAt:new Date().toISOString(),commit:process.env.REGPILOT_VERIFIED_CODE_SHA||process.env.GITHUB_SHA||null,
 provider:'GITHUB',repository,branch,state:'failed',httpReads:0,checks:null,observationHash:null,
 limitations:['This uses a short-lived Actions token, not a configured customer connector.',
 'Unavailable administration settings remain UNKNOWN; this does not prove private-tenant credentials, MFA, or continuous enforcement.',
 'Microsoft 365, Google Workspace, GitLab, Cloudflare and Companies House live customer verification is still pending dedicated credentials.']};
try{
 if(!repository||!process.env.GITHUB_TOKEN)throw Error('configuration');
 const observation=await collect({repository,branch},process.env.GITHUB_TOKEN,async(url,init)=>{report.httpReads++;return fetch(url,init);});
 report.checks=Object.fromEntries(['PASS','FAIL','UNKNOWN'].map(s=>[s,observation.checks.filter(c=>c.status===s).length]));
 report.observationHash=createHash('sha256').update(JSON.stringify(observation)).digest('hex');
 // Contract success is data retrieval and verified scope, not passing controls.
 report.state=observation.checks.find(c=>c.id==='ruleset-coverage')?.status==='PASS'?'verified-read-contract':'partial-read-contract';
 if(report.state!=='verified-read-contract')process.exitCode=1;
}catch{process.exitCode=1;}
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/live-integration-contract.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log('GitHub live contract:',report.state,'; HTTP reads:',report.httpReads,'; check counts:',report.checks);
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,
 `\n### Live integration contract\n\nGitHub: **${report.state}**, ${report.httpReads} real API reads. Configuration signals: ${JSON.stringify(report.checks)}. Unknown settings are not passes. Other customer providers await credentials.\n`,{flag:'a'});
