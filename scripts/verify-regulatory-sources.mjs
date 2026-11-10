/** Independent external probe. Runs in GitHub Actions, not in the web application. */
import {mkdir,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {REGULATORY_SOURCES} from "../lib/regulatory-sources.mjs";
import * as sourceModule from "../lib/server/ai-sources.ts";
const loadPublication=sourceModule.loadPublication||sourceModule.default?.loadPublication;
if(typeof loadPublication!=="function")throw Error("Official publication loader unavailable");

const results=new Array(REGULATORY_SOURCES.length),checkedAt=new Date().toISOString();
let cursor=0;
async function worker(){
 while(cursor<REGULATORY_SOURCES.length){
  const index=cursor++,source=REGULATORY_SOURCES[index];
  const record={id:source.id,agency:source.agency,provider:source.provider||"GOV_UK_CONTENT_API",
   checkedAt,state:"unavailable",textHash:null,characters:0,reason:null};
  try{
   const doc=await loadPublication(source);
   if(doc.id!==source.id||typeof doc.text!=="string"||doc.text.length<80||!doc.url.startsWith("https://"))
    throw Error("Publication identity, URL or body was not verified");
   record.state="text-retrieved";
   record.textHash=createHash("sha256").update(doc.text).digest("hex");
   record.characters=doc.text.length;
  }catch(e){
   // Error text is not returned or stored: providers may leak headers or tokens.
   record.reason=e?.name==="SourceUnavailable"?"source-or-parser-unavailable":"fetch-or-extraction-failed";
   if(index<3 && e?.name==="SourceUnavailable")record.safeLoaderReason=String(e.message).slice(0,120);
   if(index<3 && source.provider!=="OFFICIAL_WEB"){
    try{
      const probe=await fetch("https://www.gov.uk"+source.path,{method:"GET",redirect:"error",signal:AbortSignal.timeout(7000),headers:{accept:"text/html"}});
      record.htmlProbeStatus=probe.status;
      record.htmlProbeType=probe.headers.get("content-type")?.split(";")[0]||"unknown";
      await probe.body?.cancel();
    }catch{record.htmlProbeStatus="network-unavailable";}
    try{
      const r=await fetch("https://www.gov.uk/api/content"+source.path,{method:"GET",redirect:"error",signal:AbortSignal.timeout(7000)});
      const body=r.ok?await r.json():null;
      record.govApiDiagnostics={status:r.status,basePath:typeof body?.base_path==="string"?body.base_path.slice(0,170):null,
        kind:typeof body?.document_type==="string"?body.document_type:null,withdrawn:!!body?.withdrawn_notice,
        titleMatch:typeof body?.title==="string"?body.title.toLowerCase().includes(source.title.toLowerCase()):null};
    }catch{record.govApiDiagnostics={status:"failed"};}
   }
  }
  results[index]=record;
 }
}
await Promise.all(Array.from({length:3},()=>worker()));
const success=results.filter(x=>x.state==="text-retrieved").length,total=results.length;
const report={format:"regpilot-official-source-probe-v1",checkedAt,total,textRetrieved:success,
 unavailable:total-success,coveragePercent:Math.round(success/total*100),limitations:[
 "These are point-in-time public HTTP retrieval checks, not proof of legal change, coverage completeness or correct applicability.",
 "Official pages that cannot be extracted are classified unavailable and must not be reported as checked.",
 "Linked documents, PDF attachments, guidance chapter links and legal effective dates are not recursively extracted."
],results};
await mkdir("artifacts",{recursive:true});
await writeFile("artifacts/official-source-probe.json",JSON.stringify(report,null,2)+"\n",{mode:0o600});
console.log("Official source probe:",success,"text bodies retrieved,",total-success,"unavailable of",total);
console.log("Coverage by regulator:",[...new Set(results.map(x=>x.agency))].map(agency=>({agency,retrieved:results.filter(x=>x.agency===agency&&x.state==="text-retrieved").length,total:results.filter(x=>x.agency===agency).length})));
console.log("Official HTML fallback diagnostics (non-sensitive):",results.slice(0,3).map(x=>({id:x.id,htmlProbeStatus:x.htmlProbeStatus||"not-run",htmlProbeType:x.htmlProbeType||"not-run",safeLoaderReason:x.safeLoaderReason||"not-recorded",govApiDiagnostics:x.govApiDiagnostics||null})));
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,
  "## UK official regulatory coverage probe\n\n**"+success+"/"+total+"** publication texts fetched and extracted on "+checkedAt+". "+(total-success)+" source(s) unavailable; inspect uploaded manifest before release. No legal conclusions made.\n",{flag:"a"});
// Failure makes degradation visible in the independent job rather than claiming coverage.
if(success<Math.ceil(total*0.65))process.exitCode=1;
