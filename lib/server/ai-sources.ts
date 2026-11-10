import {loadOfficialWeb} from "./official-web-source";
import {loadGovUkHtml} from "./govuk-html-source";
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
 if(source.provider==="OFFICIAL_WEB"){try{return await loadOfficialWeb(source);}catch{throw new SourceUnavailable("Official page unavailable or changed; inspect the original");}}
 let raw:any;
 try{raw=await boundedPublicJson("https://www.gov.uk/api/content"+source.path);}catch{
  // The authenticated identity of the article is checked again against a fixed
  // official host and H1. HTML can have different navigation/markup and must fail
  // closed rather than silently substituting an unrelated or withdrawn page.
  try{return await loadGovUkHtml(source);}
  catch{throw new SourceUnavailable("Official source API and verified HTML fallback are unavailable");}
 }
 if(raw?.base_path!==source.path||raw?.document_type==="redirect"||raw?.withdrawn_notice)throw new SourceUnavailable("Publication identity changed or was withdrawn; inspect the original");
 let meta;
 try{meta=normaliseContent(source,raw)}catch{throw new SourceUnavailable("Official source data invalid")}
 const text=extractGovBody(raw);
 if(text.length<80){
  // Some GOV.UK content items expose metadata or navigation without a useful body.
  // This is NOT proof the source is missing: try the exact official published HTML.
  try{return await loadGovUkHtml(source);}
  catch{throw new SourceUnavailable("Publication body could not be verified through API or HTML");}
 }
 return {id:source.id,title:meta.title,url:meta.url,updatedAt:meta.updatedAt,revisionAt:meta.revisionAt,text};
}
