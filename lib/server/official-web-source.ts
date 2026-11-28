import {REGULATORY_SOURCES,type RegulatorySource} from "../regulatory-sources.mjs";
import {resilientGet} from "../connectors/resilient-http";
import {CollectionError} from "../connectors/collection-error";
import {parseFragment, type DefaultTreeAdapterTypes} from "parse5";
export class OfficialWebUnavailable extends Error{
 constructor(message:string,readonly reasonCode="EXTRACTION_FAILED",readonly httpStatus?:number){super(message);}
}
function plain(html:string){return html.replace(/<(script|style|nav|aside|footer|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi," ").replace(/<!--[^]*?-->/g," ").replace(/<[^>]*>/g," ").replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>{const n=v[0].toLowerCase()==="x"?parseInt(v.slice(1),16):parseInt(v,10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):" ";}).replace(/&(nbsp|amp|lt|gt|quot|apos);/g,(_,v)=>({nbsp:" ",amp:"&",lt:"<",gt:">",quot:'"',apos:"'"}[v as string]||" ")).replace(/\s+/g," ").trim();}
type Element = DefaultTreeAdapterTypes.Element;

function elements(root: DefaultTreeAdapterTypes.ParentNode): Element[] {
 const found: Element[] = [];
 const pending = [...root.childNodes].reverse();
 while (pending.length) {
  const child = pending.pop()!;
  if (!("tagName" in child)) continue;
  found.push(child);
  for (let i=child.childNodes.length-1;i>=0;i--) pending.push(child.childNodes[i]);
 }
 return found;
}

function publisherArticle(main:string, heading:string, scope:NonNullable<RegulatorySource["articleBody"]>) {
 const page=parseFragment(main,{sourceCodeLocationInfo:true});
 const articles=elements(page).filter(node=>node.tagName==="article");
 if(articles.length!==1 || !articles[0].sourceCodeLocation?.endTag)
  throw new OfficialWebUnavailable("Publisher article is missing, incomplete or ambiguous","ARTICLE_BODY_INVALID");
 const inside=elements(articles[0]);
 const content=(node:Element)=>{
  const loc=node.sourceCodeLocation;
  if(!loc?.startTag || !loc.endTag) throw new OfficialWebUnavailable("Publisher article section is incomplete","ARTICLE_BODY_INVALID");
  return main.slice(loc.startTag.endOffset,loc.endTag.startOffset);
 };
 const titles=inside.filter(node=>node.tagName==="h1");
 if(titles.length!==1 || plain(content(titles[0])).toLowerCase()!==heading.toLowerCase())
  throw new OfficialWebUnavailable("Publisher article title changed","HEADING_MISMATCH");
 const bodyClass=scope==="inspectorate"?"entry-content":"text-layout-block__text";
 const classes=(node:Element)=>node.attrs.find(attr=>attr.name==="class")?.value.split(/\s+/) || [];
 const sections=inside.filter(node=>node.tagName==="div" && classes(node).includes(bodyClass));
 if(!sections.length || (scope==="inspectorate" && sections.length!==1))
  throw new OfficialWebUnavailable("Publisher article body is missing or ambiguous","ARTICLE_BODY_INVALID");
 return sections.map(section=>{
  if(elements(section).some(node=>node.tagName==="article" || node.attrs.some(attr=>
   (attr.name==="class"||attr.name==="id") && /(?:^|\s)comments?(?:[-_\s]|$)/i.test(attr.value))))
   throw new OfficialWebUnavailable("Publisher and reader content overlap","ARTICLE_BODY_INVALID");
  // Preserve publisher paragraph boundaries so an answer cannot join a heading,
  // a list item and the next sentence into an invented statement.
  return content(section).split(/<\/(?:p|li|h[1-6]|blockquote)>/i).map(plain).filter(Boolean).join("\n");
 }).join("\n");
}

export function officialMainText(html:string,heading:string,articleBody?:RegulatorySource["articleBody"]){
 // Ignore commented templates and scripts before locating the single semantic main region.
 const clean=html.replace(/<!--[\s\S]*?-->/g,"").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"");
 const blocks=[...clean.matchAll(/<(main)\b[^>]*>|<(div)\b(?=[^>]*\brole\s*=\s*["']main["'])[^>]*>/gi)];
 if(!blocks.length)throw new OfficialWebUnavailable("Official page has no supported main region","MAIN_REGION_MISSING");
 if(blocks.length>1)throw new OfficialWebUnavailable("Official page has multiple main regions","MAIN_REGION_AMBIGUOUS");
 const start=blocks[0],tag=start[1]||start[2],offset=start.index!+start[0].length,tail=clean.slice(offset),tags=new RegExp(`<\\/?${tag}\\b[^>]*>`,"gi");let depth=1,end=-1;
 for(const t of tail.matchAll(tags)){depth+=t[0].startsWith("</")?-1:1;if(depth===0){end=t.index!;break;}}
 if(end<0)throw new OfficialWebUnavailable("Official page main region is incomplete","MAIN_REGION_INCOMPLETE");
 const main=tail.slice(0,end),titles=[...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)];
 if(titles.length!==1||!plain(titles[0][1]).toLowerCase().includes(heading.toLowerCase()))throw new OfficialWebUnavailable("Official page identity changed; inspect the original","HEADING_MISMATCH");
 const text=articleBody?publisherArticle(main,heading,articleBody):plain(main);
 if(text.length<200||text.length>60000||/access denied|verify you are human|checking your browser|page not found/i.test(plain(titles[0][1])))throw new OfficialWebUnavailable("Official publication text is unavailable or exceeds the supported size","PUBLICATION_BODY_INVALID");
 return text;
}
export async function loadOfficialWeb(source:RegulatorySource,fetcher:typeof fetch=fetch){
 const known=REGULATORY_SOURCES.find(s=>s.id===source.id&&s.provider==="OFFICIAL_WEB");
 if(known?.refreshMode==="manual")throw new OfficialWebUnavailable("Open this publication at the publisher for manual review","MANUAL_REFRESH");
 if(!known?.url||!known.heading||source.url!==known.url||source.path!==known.path)throw new OfficialWebUnavailable("Only curated official pages can be fetched");
 const read=resilientGet(fetcher,new URL(known.url).origin,{Accept:"text/html","User-Agent":"RegPilot/1.0 (public regulatory publication monitor)"},{timeoutMs:25000,maxRequests:3});
 let response:Response;
 try{response=await read(known.url);}catch(error){throw new OfficialWebUnavailable("Official page request failed",error instanceof CollectionError?error.code:"FETCH_FAILED");}
 // A queued request, partial document or publisher verification page cannot be a snapshot.
 if(["challenge","captcha"].includes(response.headers.get("x-amzn-waf-action")||"") || response.headers.get("cf-mitigated")==="challenge"){
  await response.body?.cancel();
  throw new OfficialWebUnavailable("Publisher verification is required for this page","PUBLISHER_CHALLENGE",response.status);
 }
 if(response.status!==200){await response.body?.cancel();throw new OfficialWebUnavailable("Official page returned an unsuccessful status","HTTP_STATUS",response.status);}
 if(!response.headers.get("content-type")?.includes("text/html")||response.url&&response.url!==known.url){await response.body?.cancel();throw new OfficialWebUnavailable("Official page unavailable, moved or unsupported","RESPONSE_IDENTITY_OR_TYPE");}
 const reader=response.body?.getReader();if(!reader)throw new OfficialWebUnavailable("Official page was empty");const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1000000)throw new OfficialWebUnavailable("Official page exceeds the safe size limit","RESPONSE_TOO_LARGE");chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 let text:string;
 try{text=officialMainText(Buffer.concat(chunks).toString("utf8"),known.heading,known.articleBody);}
 catch(error){
  if(error instanceof OfficialWebUnavailable)throw new OfficialWebUnavailable(error.message,error.reasonCode,response.status);
  throw error;
 }
 // Fetch time and HTML Last-Modified are not asserted as a legal effective date or publisher revision date.
 return {id:known.id,title:known.title,url:known.url,updatedAt:null,revisionAt:null,text};
}
