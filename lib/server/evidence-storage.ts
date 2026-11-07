import {createClient} from "@supabase/supabase-js";
import {workspaceConfigured} from "./ai-auth";
import {EvidenceError,MAX_EVIDENCE_BYTES} from "../evidence/file-guard.mjs";

export interface EvidenceObjectStore{
 put(key:string,bytes:Uint8Array,contentType?:string):Promise<void>;
 get(key:string):Promise<Uint8Array>;
 remove(key:string):Promise<void>;
}
export function evidenceConfigured(){
 const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 return workspaceConfigured()&&process.env.REGPILOT_EVIDENCE_ENABLED==="true"&&
  !!secret&&!!process.env.REGPILOT_EVIDENCE_BUCKET&&!!process.env.REGPILOT_CLAMD_HOST;
}
export async function privateEvidenceStore():Promise<EvidenceObjectStore>{
 if(!evidenceConfigured())throw new EvidenceError("Private evidence storage not configured",503);
 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||"";
 const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"";
 const bucket=process.env.REGPILOT_EVIDENCE_BUCKET||"";
 const client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.storage.getBucket(bucket);
 if(error||!data||data.public!==false)throw new EvidenceError("Evidence storage bucket must exist and be private",503);
 const api=client.storage.from(bucket);
 return {
  async put(key,bytes,contentType="application/pdf"){
   const {error}=await api.upload(key,Buffer.from(bytes),{contentType,upsert:false,cacheControl:"0"});
   if(error)throw new EvidenceError("Private evidence upload failed",503);
  },
  async get(key){
   const {data,error}=await api.download(key);
   if(error||!data)throw new EvidenceError("Private evidence file unavailable",503);
   if(data.size>MAX_EVIDENCE_BYTES)throw new EvidenceError("Stored evidence exceeded download size limit",503);
   const bytes=new Uint8Array(await data.arrayBuffer());
   if(bytes.byteLength>MAX_EVIDENCE_BYTES)throw new EvidenceError("Stored evidence exceeded download size limit",503);
   return bytes;
  },
  async remove(key){
   const {error}=await api.remove([key]);if(error)throw new EvidenceError("Evidence storage cleanup failed",503);
  }
 };
}
