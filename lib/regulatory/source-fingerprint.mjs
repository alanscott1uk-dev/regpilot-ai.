import {createHash} from "node:crypto";
export function canonicalSourceText(value){
 if(typeof value!=="string")return "";
 return value.normalize("NFKC").replace(/\s+/g," ").trim().slice(0,20000);
}
export function sourceTextHash(value){
 const normal=canonicalSourceText(value);
 if(normal.length<80)throw new Error("Official source body too short to fingerprint");
 return createHash("sha256").update(normal,"utf8").digest("hex");
}
function sentences(value){
 const chunks=canonicalSourceText(value).split(/(?<=[.!?;])\s+|\n+/g);
 return [...new Set(chunks.map(x=>x.trim()).filter(x=>x.length>=35))].slice(0,300);
}
/** Textual drift only. No claim that law, effective dates or applicability changed. */
export function compareSourceText(before,after){
 const old=canonicalSourceText(before),next=canonicalSourceText(after);
 if(!next||next.length<80)throw new Error("Official source text is incomplete");
 if(!old)return {state:"BASELINE",added:[],removed:[],changed:false};
 if(sourceTextHash(old)===sourceTextHash(next))return {state:"UNCHANGED",added:[],removed:[],changed:false};
 const older=sentences(old),newer=sentences(next);
 const left=new Set(older),right=new Set(newer);
 const added=newer.filter(v=>!left.has(v)).slice(0,8);
 const removed=older.filter(v=>!right.has(v)).slice(0,8);
 return {state:"CONTENT_CHANGED",added,removed,changed:true};
}
export function publicSnapshot(record){
 return {id:record.id,organizationId:record.organizationId,sourceId:record.sourceId,
  title:record.title,url:record.url,contentHash:record.contentHash,
  revisionAt:record.revisionAt||null,firstCapturedAt:record.firstCapturedAt,lastCheckedAt:record.lastCheckedAt,
  reviewStatus:record.reviewStatus,reviewNotes:record.reviewNotes,reviewedAt:record.reviewedAt,reviewerId:record.reviewerId,
  addedSnippets:record.addedSnippets||[],removedSnippets:record.removedSnippets||[],version:record.version};
}
