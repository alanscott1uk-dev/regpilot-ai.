import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 const key=process.env.OPENAI_API_KEY;
 if(!key)return NextResponse.json({error:"AI is not configured yet. An administrator must add the server-side API key."},{status:503});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const publishable=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!publishable)return NextResponse.json({error:"Authentication is unavailable."},{status:503});
 const authorization=req.headers.get("authorization")??"";
 if(!/^Bearer\s+\S+$/.test(authorization))return NextResponse.json({error:"Please sign in."},{status:401});
 if(Number(req.headers.get("content-length")??0)>8192)return NextResponse.json({error:"Request too large."},{status:413});
 let payload:unknown;
 try{payload=await req.json();}catch{return NextResponse.json({error:"Invalid request."},{status:400});}
 if(!payload||typeof payload!=="object")return NextResponse.json({error:"Invalid request."},{status:400});
 const body=payload as Record<string,unknown>;
 const question=body.question,orgId=body.organizationId;
 if(typeof question!=="string"||question.trim().length<3||question.length>1200||typeof orgId!=="string"||!/^[0-9a-f-]{36}$/i.test(orgId))return NextResponse.json({error:"Please enter a question and select your organisation."},{status:400});
 const db=createClient(url,publishable,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await db.auth.getUser(authorization.replace(/^Bearer\s+/,""));
 if(authError||!user)return NextResponse.json({error:"Your session has expired. Sign in again."},{status:401});
 const {data:membership,error:membershipError}=await db.from("organization_memberships").select("organization_id").eq("organization_id",orgId).eq("user_id",user.id).maybeSingle();
 if(membershipError||!membership)return NextResponse.json({error:"Organisation access denied."},{status:403});
 // No private records or documents are sent to the model in this initial release.
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),18000);
 try{
  const response=await fetch("https://api.openai.com/v1/responses",{
   method:"POST",signal:controller.signal,
   headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},
   body:JSON.stringify({model:process.env.EAGNEXIS_AI_MODEL||"gpt-4.1-mini",store:false,max_output_tokens:350,
    instructions:"You are EAGNEXIS, a UK business compliance navigation assistant. Give brief, clear general guidance, not legal advice. Never claim you checked current legislation, user records, licences or official websites. Ask the user to verify requirements against the appropriate UK regulator and qualified adviser. Do not assert an organisation is compliant. Do not invent citations. Avoid collecting personal or confidential information.",
    input:question.trim()})
  });
  if(!response.ok)return NextResponse.json({error:"The AI service is temporarily unavailable."},{status:502});
  const result=await response.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
  const answer=result.output?.flatMap(x=>x.content??[]).filter(x=>x.type==="output_text").map(x=>x.text??"").join("\n").trim();
  if(!answer)return NextResponse.json({error:"No answer was returned. Please try again."},{status:502});
  return NextResponse.json({answer},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"The AI request timed out or failed."},{status:504});}
 finally{clearTimeout(timeout);}
}
