// Run with Node.js 20 or later. The input JSON contains {requestKey, observation}.
// Keep this file server-side. Use a scoped RegPilot credential from your secret manager.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export async function submitRecord({origin,token,envelope,fetcher=fetch}){
 const target=new URL(origin);
 if(target.protocol!=='https:'||target.pathname!=='/'||target.username||target.password||target.search||target.hash)throw Error('Configure your own HTTPS workspace origin');
 if(!token||!envelope?.requestKey||!envelope.observation?.partnerRecord)throw Error('Provide the saved request key, scoped credential and versioned observation');
 const response=await fetcher(new URL('/api/v1/observations',target),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':envelope.requestKey},body:JSON.stringify(envelope.observation),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('RegPilot returned HTTP '+response.status+' ('+(await response.json()).error?.code+'). Retry the same saved envelope after resolving the cause.');
 const result=await response.json();
 return {id:result.id,receiptHash:result.receiptHash,current:result.current,reused:result.reused,outcome:result.reportedOutcome,reason:result.reason};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const envelope=JSON.parse(await readFile(process.argv[2],'utf8'));
  const receipt=await submitRecord({origin:process.env.REGPILOT_ORIGIN,token:process.env.REGPILOT_CUSTOMER_TOKEN,envelope});
  console.log(JSON.stringify(receipt));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
