import {REGULATORY_SOURCES,normaliseContent} from "../regulatory-sources.mjs";
import {boundedPublicJson} from "./publication-catalogue";
import type {RegulatorySource} from "../regulatory-sources.mjs";
import {extractGovBody} from "../ai/security.mjs";
export class SourceUnavailable extends Error {constructor(message:string){super(message);this.name="SourceUnavailable"}}
export async function loadOfficialSource(sourceId:string){
 if(!sourceId)return null;
 const source=REGULATORY_SOURCES.find(s=>s.id===sourceId);
 if(!source)throw new SourceUnavailable("Unknown official source ID");
 return loadPublication(source);
}
export async function loadPublication(source:RegulatorySource){
 let raw:any;
 try{raw=await boundedPublicJson("https://www.gov.uk/api/content"+source.path);}catch{throw new SourceUnavailable("Official source could not be retrieved");}
 if(raw?.base_path!==source.path||raw?.document_type==="redirect"||raw?.withdrawn_notice)throw new SourceUnavailable("Publication identity changed or was withdrawn; inspect the original");
 let meta;
 try{meta=normaliseContent(source,raw)}catch{throw new SourceUnavailable("Official source data invalid")}
 const text=extractGovBody(raw);
 if(text.length<80)throw new SourceUnavailable("Publication text unavailable: review the original official page");
 return {id:source.id,title:meta.title,url:meta.url,updatedAt:meta.updatedAt,revisionAt:meta.revisionAt,text};
}
