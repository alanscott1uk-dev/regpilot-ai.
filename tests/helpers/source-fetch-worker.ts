import {db} from '../../lib/server/db';
import {loadSharedPublicSource} from '../../lib/server/shared-source-fetch';
import {REGULATORY_SOURCES,officialSourceUrl} from '../../lib/regulatory-sources.mjs';
if(process.env.REGPILOT_SHARED_FETCH_FIXTURE!=='true')throw Error('Test fixture only');
const source=REGULATORY_SOURCES.find(s=>s.id==='uk-data-protection')!;
process.once('message',async()=>{
 try{
  const results=await Promise.all(Array.from({length:25},()=>loadSharedPublicSource(source,async()=>{
   process.send?.({kind:'fetch'});
   await new Promise(r=>setTimeout(r,150));
   return {id:source.id,title:'Fictional public source',url:officialSourceUrl(source),updatedAt:null,revisionAt:null,text:'Fictional public test publication about retaining evidence and periodically reviewing supplier training records. '.repeat(3)};
  })));
  process.send?.({kind:'result',count:results.length,fetchedAt:results.map(r=>r.fetchedAt.toISOString()),reused:results.filter(r=>r.reused).length});
 }catch{process.send?.({kind:'failure'});process.exitCode=1;}
 finally{await db.$disconnect();process.disconnect();}
});
process.send?.({kind:'ready'});
