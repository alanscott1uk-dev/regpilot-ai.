import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {collectGleif} from '../lib/connectors/gleif';
import {collectScorecard} from '../lib/connectors/scorecard';
import {observationSchema,observationOutcome,type Observation} from '../lib/connectors/observation';

async function collect(){
 const rows=await Promise.all([
  collectGleif({lei:'5493000HZTVUYLO1D793',companyNumber:'03888792'}),
  collectScorecard({repository:'ossf/scorecard'})
 ]);
 if(!rows[0].checks.some(check=>check.id==='uk-entity-match'&&check.status==='PASS'))throw Error('UK registration did not match');
 if(!/\?commit=[a-f0-9]{40}$/.test(rows[1].sourceUrl))throw Error('No identifiable upstream revision');
 return rows.map((value:Observation)=>{
  const data=observationSchema.parse(value);
  return {provider:data.engine,source:data.sourceUrl,collectedAt:data.capturedAt,checks:data.checks.length,outcome:observationOutcome(data),
   signalHash:createHash('sha256').update(JSON.stringify(data.checks)).digest('hex')};
 });
}
async function main(){
 const first=await collect();
 const second=await collect();
 const result={scope:'Two independent reads of public publisher records. Customer authorisation, renewal and scheduled collection require separate receipts.',first,second};
 await writeFile('live-public-evidence.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}
main().catch(error=>{console.error('Public provider check failed:',error instanceof Error?error.message:'unknown error');process.exitCode=1;});
