"use client";
import {createClient} from "@supabase/supabase-js";
let client:ReturnType<typeof createClient>|null=null;
export function browserAuth(){
 if(client)return client;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw new Error("Supabase public login configuration is missing");
 client=createClient(url,key,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true,flowType:"pkce"}});
 return client;
}
