import type {RegulatorySource} from "../regulatory-sources.mjs";
import {OfficialWebUnavailable,officialMainText} from "./official-web-source";

function pathAllowed(path:string){
 return /^\/[a-z0-9][a-z0-9/-]{0,448}$/.test(path)&&!path.includes("//")&&!path.endsWith("/")&&!path.includes("/../");
}
async function boundedHtml(res:Response){
 if(!res.body)throw new OfficialWebUnavailable("The official page returned no body");
 const reader=res.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   bytes+=value.byteLength;
   if(bytes>1024*1024)throw new OfficialWebUnavailable("The official page exceeds bounded extraction limits");
   chunks.push(value);
  }
 }finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks).toString("utf8");
}
/**
 * Fixed gov.uk HTML fallback when the published Content API cannot be retrieved.
 * This is NOT unrestricted scraping: hostname, path, redirect, HTTP identity, h1 and
 * maximum body size are controlled. Page text is a snapshot, not legal interpretation.
 */
export async function loadGovUkHtml(source:RegulatorySource,fetcher:typeof fetch=fetch){
 if(source.provider==="OFFICIAL_WEB"||!pathAllowed(source.path)||typeof source.title!=="string"||source.title.length<6||source.title.length>300)
  throw new OfficialWebUnavailable("GOV.UK HTML fallback expects a registered publication identity");
 const url="https://www.gov.uk"+source.path;
 const response=await fetcher(url,{method:"GET",headers:{Accept:"text/html"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(9000)});
 if(!response.ok||!response.headers.get("content-type")?.includes("text/html")||response.url&&response.url!==url){
  await response.body?.cancel();throw new OfficialWebUnavailable("GOV.UK official page unavailable, redirected or unsupported");
 }
 const html=await boundedHtml(response);
 const text=officialMainText(html,source.title);
 if(text.length<200||text.length>60000)throw new OfficialWebUnavailable("Publication main text cannot be verified");
 return {id:source.id,title:source.title,url,updatedAt:null,revisionAt:null,text};
}
