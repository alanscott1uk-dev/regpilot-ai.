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
 if(raw?.document_type==="redirect"||raw?.withdrawn_notice)throw new SourceUnavailable("Publication explicitly redirected or withdrawn; inspect the original");
 if(raw?.base_path!==source.path){
  // A Content API mismatch cannot be accepted as a published version. A separate
  // full HTML identity check at the fixed original URL can establish a safe body,
  // but never automatically approves the document's legal effect.
  try{return await loadGovUkHtml(source);}
  catch{throw new SourceUnavailable("GOV.UK publication identity is not verifiable in API or HTML");}
 }
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
