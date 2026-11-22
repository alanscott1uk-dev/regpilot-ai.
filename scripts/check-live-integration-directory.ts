import {publicDirectory} from '../lib/connectors/marketplace';
async function verify(){
 const entries=await publicDirectory();
 if(entries.length<400||!entries.some(e=>e.slug==='openai'))throw Error('Provider catalogue breadth or expected provider unavailable');
 console.log(JSON.stringify({source:'Nango public provider catalogue',catalogueEntries:entries.length,apiKeySetupCandidates:entries.filter(e=>e.auth==='API_KEY').length,checkedAt:new Date().toISOString(),scope:'Discovery only. Tenant authorisation and data collection require separate verification.'}));
}
verify().catch(()=>{console.error('Live provider directory check failed.');process.exitCode=1;});
