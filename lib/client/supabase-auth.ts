"use client";
import {createClient} from "@supabase/supabase-js";
import {callbackInfo,cleanAuthUrl,authProblem,signInDestination,resolveSignInReturn} from '../auth-flow.mjs';
let client:ReturnType<typeof createClient>|null=null;
let incoming:ReturnType<typeof callbackInfo>=null;
let incomingPath='/team';
type ReturnResult={ok:boolean;message:string;destination:string};
let completion:Promise<ReturnResult>|null=null;
export function browserAuth(){
 if(client)return client;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw new Error("Supabase public login configuration is missing");
 if(typeof window!=='undefined'){
  incoming=callbackInfo(window.location.search,window.location.hash);
  incomingPath=window.location.pathname;
 }
 client=createClient(url,key,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true,flowType:"pkce"}});
 return client;
}
export function completeSignInReturn():Promise<ReturnResult>|null{
 if(completion)return completion;
 const info=incoming||callbackInfo(window.location.search,window.location.hash);
 if(!info)return null;
 const path=incoming?incomingPath:window.location.pathname;
 completion=(async()=>{
  const destination=signInDestination(path);
  try{
   // Observe the SDK's single initialization; never exchange the one-use code a second time.
   return await resolveSignInReturn(info,path,browserAuth().auth,()=>!!callbackInfo(window.location.search,window.location.hash)?.hasCode);
  }catch(error){return {ok:false,message:authProblem(error).message,destination};}
  finally{window.history.replaceState(window.history.state,'',cleanAuthUrl(window.location.href));}
 })();
 return completion;
}
