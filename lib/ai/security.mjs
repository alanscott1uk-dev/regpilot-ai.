export function allowedEmail(email,list){
 const safe=typeof email==="string"?email.trim().toLowerCase():"";
 if(!safe||typeof list!=="string")return false;
 return list.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean).some(e=>e===safe&&e!=="*");
}
export function extractGovBody(raw){
 if(!raw||typeof raw!=="object")return "";
 const parts=[];
 const strip=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
 .replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
 .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
 const visit=(value,depth=0)=>{
  if(depth>4||parts.join("").length>14000)return;
  if(typeof value==="string"){if(value.length>30)parts.push(strip(value).slice(0,12000));return;}
  if(Array.isArray(value)){for(const x of value.slice(0,50))visit(x,depth+1);return;}
  if(value&&typeof value==="object")for(const key of ["body","content","text","parts","blocks","summary","description"])if(key in value)visit(value[key],depth+1);
 };
 visit(raw.details);if(parts.join("").length<80)visit(raw.description);
 return parts.filter(Boolean).join("\n").slice(0,14000);
}
