// Isolated contract fixture. This is not an OCR engine and never calls a paid provider.
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {fixtureAzureOcr,fixtureOcrPng,fixtureOcrJpeg,fixtureScannedPdf} from '../tests/helpers/ocr-fixture.mjs';
export const OCR_FIXTURE_ORIGIN='https://fixture.cognitiveservices.azure.com';
const prefix='/documentintelligence/documentModels/prebuilt-read/analyzeResults/';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function startOcrProviderFixture(port=0){
 const accepted=new Map([[hash(fixtureOcrPng()),'PNG'],[hash(fixtureOcrJpeg()),'JPEG'],[hash(fixtureScannedPdf()),'PDF']]),operations=new Map(),stats={starts:0,polls:0,rejected:0,mode:'CONTROLLED_PROVIDER_TRANSPORT_NO_LIVE_OCR'};
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');const send=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(url.pathname==='/health'&&req.method==='GET')return send(200,{ready:true,...stats});
  if(req.headers['ocp-apim-subscription-key']!=='fictional-ocr-contract-key'){stats.rejected++;return send(403,{error:'fixture key required'});}
  if(req.method==='POST'&&url.pathname==='/documentintelligence/documentModels/prebuilt-read:analyze'){
   if(url.searchParams.get('api-version')!=='2024-11-30'||url.searchParams.get('stringIndexType')!=='utf16CodeUnit'||url.searchParams.get('pages')!=='1-1'){stats.rejected++;return send(400,{error:'bounded contract required'});}
   const chunks=[];let size=0;try{for await(const chunk of req){size+=chunk.length;if(size>4300000)throw Error();chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(Object.keys(body).join(',')!=='base64Source'||typeof body.base64Source!=='string')throw Error();const format=accepted.get(hash(Buffer.from(body.base64Source,'base64')));if(!format)throw Error();const id=randomUUID();operations.set(id,format);stats.starts++;res.setHeader('Operation-Location',OCR_FIXTURE_ORIGIN+prefix+id+'?api-version=2024-11-30');return send(202,{status:'accepted',mode:stats.mode});}catch{stats.rejected++;return send(400,{error:'only the committed fictional scan fixtures are accepted'});}
  }
  if(req.method==='GET'&&url.pathname.startsWith(prefix)&&url.search==='?api-version=2024-11-30'){const format=operations.get(url.pathname.slice(prefix.length));if(!format){stats.rejected++;return send(404,{error:'unknown fixture operation'});}stats.polls++;return send(200,fixtureAzureOcr(format));}
  stats.rejected++;send(404,{error:'unsupported fixture request'});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});const address=server.address();return {server,url:`http://127.0.0.1:${address.port}`,stats,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const port=Number(process.env.REGPILOT_OCR_FIXTURE_PORT||4029);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid isolated OCR fixture port');const fixture=await startOcrProviderFixture(port);process.stdout.write(JSON.stringify({url:fixture.url,mode:fixture.stats.mode})+'\n');process.on('SIGTERM',()=>{void fixture.close().then(()=>process.exit(0));});}
