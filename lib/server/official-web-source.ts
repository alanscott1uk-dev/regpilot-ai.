import {REGULATORY_SOURCES,type RegulatorySource} from "../regulatory-sources.mjs";
export class OfficialWebUnavailable extends Error{}
function plain(html:string){return html.replace(/<(script|style|nav|aside|footer|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi," ").replace(/<!--[^]*?-->/g," ").replace(/<[^>]*>/g," ").replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>{const n=v[0].toLowerCase()==="x"?parseInt(v.slice(1),16):parseInt(v,10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):" ";}).replace(/&(nbsp|amp|lt|gt|quot|apos);/g,(_,v)=>({nbsp:" ",amp:"&",lt:"<",gt:">",quot:'"',apos:"'"}[v as string]||" ")).replace(/\s+/g," ").trim();}
export function officialMainText(html:string,heading:string){
 // Ignore commented templates and scripts before locating the single semantic main region.
 const clean=html.replace(/<!--[\s\S]*?-->/g,"").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"");
 const blocks=[...clean.matchAll(/<(main)\b[^>]*>|<(div)\b(?=[^>]*\brole\s*=\s*["']main["'])[^>]*>/gi)];
 if(blocks.length!==1)throw new OfficialWebUnavailable("Official page layout changed; inspect the original");
 const start=blocks[0],tag=start[1]||start[2],offset=start.index!+start[0].length,tail=clean.slice(offset),tags=new RegExp(`<\\/?${tag}\\b[^>]*>`,"gi");let depth=1,end=-1;
 for(const t of tail.matchAll(tags)){depth+=t[0].startsWith("</")?-1:1;if(depth===0){end=t.index!;break;}}
 if(end<0)throw new OfficialWebUnavailable("Official page main region is incomplete");
 const main=tail.slice(0,end),titles=[...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)];
 if(titles.length!==1||!plain(titles[0][1]).toLowerCase().includes(heading.toLowerCase()))throw new OfficialWebUnavailable("Official page identity changed; inspect the original");
 const text=plain(main);
 if(text.length<200||text.length>60000||/access denied|verify you are human|checking your browser|page not found/i.test(plain(titles[0][1])))throw new OfficialWebUnavailable("Official publication text is unavailable or exceeds the supported size");
 return text;
}
export async function loadOfficialWeb(source:RegulatorySource,fetcher:typeof fetch=fetch){
 const known=REGULATORY_SOURCES.find(s=>s.id===source.id&&s.provider==="OFFICIAL_WEB");
 if(!known?.url||!known.heading||source.url!==known.url||source.path!==known.path)throw new OfficialWebUnavailable("Only curated official pages can be fetched");
 const response=await fetcher(known.url,{method:"GET",headers:{Accept:"text/html"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(9000)});
 if(!response.ok||!response.headers.get("content-type")?.includes("text/html")||response.url&&response.url!==known.url){await response.body?.cancel();throw new OfficialWebUnavailable("Official page unavailable, moved or unsupported");}
 const reader=response.body?.getReader();if(!reader)throw new OfficialWebUnavailable("Official page was empty");const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1000000)throw new OfficialWebUnavailable("Official page exceeds the safe size limit");chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const text=officialMainText(Buffer.concat(chunks).toString("utf8"),known.heading);
 // Fetch time and HTML Last-Modified are not asserted as a legal effective date or publisher revision date.
 return {id:known.id,title:known.title,url:known.url,updatedAt:null,revisionAt:null,text};
}
