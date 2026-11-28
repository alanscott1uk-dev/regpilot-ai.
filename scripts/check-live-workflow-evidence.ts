import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {collectWorkflow} from '../lib/connectors/workflow-evidence';
async function main(){
 const token=process.env.GITHUB_TOKEN,scope=process.env.GITHUB_REPOSITORY,reference=process.env.GITHUB_HEAD_REF||process.env.GITHUB_REF_NAME;
 if(!token||!scope||!reference)throw Error('The authenticated repository and branch are required');
 const observation=await collectWorkflow({scope,record:'ci.yml',reference},token);
 const captures=observation.checks.filter(check=>check.id.endsWith('-jobs'));
 if(!captures.length)throw Error('No completed workflow attempts available to verify');
 const receipt={provenance:'RegPilot repository, authenticated GitHub Actions read',...observation};
 await writeFile('live-workflow-evidence.json',JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({source:'Authenticated GitHub Actions',runs:captures.length,checks:observation.checks.length,hash:createHash('sha256').update(JSON.stringify(receipt)).digest('hex')}));
}
main().catch(e=>{console.error('Workflow evidence check failed',e.code??e.message);process.exitCode=1;});
