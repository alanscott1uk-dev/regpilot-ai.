import {REGULATORY_SOURCES,normaliseContent} from "../regulatory-sources.mjs";
import {extractGovBody} from "../ai/security.mjs";
export class SourceUnavailable extends Error {constructor(message:string){super(message);this.name="SourceUnavailable"}}
export async function loadOfficialSource(sourceId:string){
 if(!sourceId)return null;
 const source=REGULATORY_SOURCES.find(s=>s.id===sourceId);
 if(!source)throw new SourceUnavailable("Unknown official source ID");
 let response:Response;
 try{
  response=await fetch("https://www.gov.uk/api/content"+source.path,
   {headers:{accept:"application/json"},signal:AbortSignal.timeout(9000),cache:"no-store"});
 }catch{throw new SourceUnavailable("Official source could not be retrieved");}
 if(!response.ok)throw new SourceUnavailable("Official publication unavailable");
 let raw:unknown;
 try{raw=await response.json()}catch{throw new SourceUnavailable("Official source data invalid")}
 let meta;
 try{meta=normaliseContent(source,raw)}catch{throw new SourceUnavailable("Official source data invalid")}
 const text=extractGovBody(raw);
 if(text.length<80)throw new SourceUnavailable("Publication text unavailable: review the original official page");
 return {id:source.id,title:meta.title,url:meta.url,updatedAt:meta.updatedAt,revisionAt:meta.revisionAt,text};
}
