import {NextResponse} from "next/server";
import {AccessError,aiConfigured,bootstrapAiOrganisation,listAiOrganisations} from "../../../lib/server/ai-auth";
export const runtime="nodejs";export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function GET(request:Request){
 if(!aiConfigured())return json({error:"AI private pilot has not been activated"},503);
 try{return json(await listAiOrganisations(request))}
 catch(e){return json({error:e instanceof AccessError?e.message:"Organisation access unavailable"},e instanceof AccessError?e.status:503)}
}
export async function POST(request:Request){
 if(!aiConfigured())return json({error:"AI private pilot has not been activated"},503);
 try{
  const text=await request.text();if(text.length>700)return json({error:"Request too large"},413);
  const input=JSON.parse(text);const company=typeof input.company==="string"?input.company:"";
  return json({organisation:await bootstrapAiOrganisation(request,company)});
 }catch(e){return json({error:e instanceof AccessError?e.message:"Could not create organisation"},e instanceof AccessError?e.status:503)}
}
