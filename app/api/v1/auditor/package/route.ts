import {auditorApiFailure,auditorPackage} from "../../../../../lib/server/auditor-api";
export const runtime="nodejs", dynamic="force-dynamic";
export async function GET(request:Request){
  try{
    const {body,etag}=await auditorPackage(request);
    const headers={"Cache-Control":"private, no-store","Vary":"Authorization","ETag":etag,"X-Content-Type-Options":"nosniff"};
    const validators=request.headers.get("if-none-match")?.split(",").map(value=>value.trim().replace(/^W\//,""));
    if(validators?.includes("*")||validators?.includes(etag))return new Response(null,{status:304,headers});
    return Response.json(body,{headers});
  }catch(error){return auditorApiFailure(error);}
}
