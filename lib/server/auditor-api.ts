import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {allowedEmail} from "../ai/security.mjs";
import {hashValue} from "../regulatory/intelligence";
import {activeRoom,auditApiConfigured,clearedAuditKey,currentAssurance,event,filesWithAvailability,issuerActive,manifest} from "./audit-disclosure";
import {downloadScopedAuditEvidence,type AuditReadScope} from "./auditor-service";
import type {EvidenceObjectStore} from "./evidence-storage";
import type {AuthorizedContext} from "./authorization";
import {db} from "./db";
import {IntelligenceError,transaction} from "./intelligence-service";
import {ADMIN,requireMember} from "./workspace-member";

const keyAction = z.object({action:z.enum(["ISSUE","REVOKE"]),grantId:z.uuid(),version:z.number().int().positive()}).strict();
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const bearer = new RegExp("^Bearer (rpa1_("+uuid+")_[A-Za-z0-9_-]{43})$");
const digest = (token:string,subject:string)=>createHash("sha256").update(token).update("\0").update(subject).digest("hex");
function enabled(){if(!auditApiConfigured())throw new IntelligenceError("Auditor API is disabled",503);}
function unavailable(){return new IntelligenceError("Auditor key unavailable",401);}
function matches(actual:string|null,expected:string){return !!actual && actual.length===expected.length && timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
export class AuditorRateLimit extends IntelligenceError {
  constructor(public retryAfter:number){super("Auditor sync rate limit reached",429);}
}

export async function manageAuditorKey(ctx:AuthorizedContext,roomId:string,input:unknown) {
  const action=keyAction.parse(input);
  // Revocation remains available during a service pause.
  if(action.action==="ISSUE")enabled();
  return transaction(ctx,async tx=>{
    await requireMember(tx,ctx,ADMIN);
    const grant=await tx.auditGrant.findFirst({where:{id:action.grantId,roomId,organizationId:ctx.organizationId},
      include:{room:true,user:{select:{email:true,externalId:true}}}});
    if(!grant)throw new IntelligenceError("Named invitation unavailable",404);
    if(grant.version!==action.version)throw new IntelligenceError("Guest access changed. Refresh the room.",409);
    if(action.action==="REVOKE"){
      await tx.auditGrant.update({where:{id:grant.id},data:{...clearedAuditKey,version:{increment:1}}});
      await event(tx,ctx.organizationId,ctx.userId,"api_key_revoked",roomId,{grantId:grant.id});
      return {revoked:true};
    }
    if(grant.status!=="ACCEPTED" || !grant.user || grant.user.email!==grant.email ||
       !allowedEmail(grant.email,process.env.REGPILOT_AI_ALLOWED_EMAILS) || !activeRoom(grant.room) || !await issuerActive(tx,grant.room))
      throw new IntelligenceError("A current, accepted auditor invitation is required",409);
    await currentAssurance(tx,grant.room);
    const token="rpa1_"+grant.id+"_"+randomBytes(32).toString("base64url");
    const expiresAt=new Date(Math.min(grant.room.expiresAt.getTime(),Date.now()+7*86400000));
    await tx.auditGrant.update({where:{id:grant.id},data:{apiKeyHash:digest(token,grant.user.externalId),apiIssuerId:ctx.userId,
      apiExpiresAt:expiresAt,apiLastUsedAt:null,version:{increment:1}}});
    await event(tx,ctx.organizationId,ctx.userId,"api_key_issued",roomId,{grantId:grant.id,expiresAt:expiresAt.toISOString()});
    return {token,expiresAt:expiresAt.toISOString()};
  });
}

async function auditorAccess(request:Request):Promise<AuditReadScope> {
  enabled();
  const match=bearer.exec(request.headers.get("authorization")??"");
  if(!match)throw unavailable();
  const [,token,id]=match;
  const seed=await db.auditGrant.findUnique({where:{id},select:{organizationId:true,apiKeyHash:true,user:{select:{externalId:true}}}});
  if(!seed?.user || !matches(seed.apiKeyHash,digest(token,seed.user.externalId)))throw unavailable();
  const org=seed.organizationId;
  const access:AuditReadScope=fn=>transaction({organizationId:org,userId:"",role:"VIEWER"},async tx=>{
    enabled();
    const grant=await tx.auditGrant.findFirst({where:{id,organizationId:org},include:{room:true,user:{select:{id:true,externalId:true,email:true}}}});
    if(!grant?.user || grant.status!=="ACCEPTED" || grant.user.email!==grant.email ||
       !allowedEmail(grant.email,process.env.REGPILOT_AI_ALLOWED_EMAILS) ||
       !grant.apiIssuerId || !grant.apiExpiresAt || grant.apiExpiresAt<=new Date() || !activeRoom(grant.room) ||
       !matches(grant.apiKeyHash,digest(token,grant.user.externalId)) || !await issuerActive(tx,grant.room) ||
       (grant.apiIssuerId!==grant.room.createdById && !await issuerActive(tx,{organizationId:org,createdById:grant.apiIssuerId})))throw unavailable();
    await currentAssurance(tx,grant.room);
    return fn(tx,grant,grant.room,grant.user.id);
  });
  await access(async(tx)=>{
    const minute=new Date(Math.floor(Date.now()/60000)*60000);
    for(const [bucket,limit] of [["auditor:"+id,60],["auditor-company",240]] as const){
      const row=await tx.customerApiBudget.upsert({where:{organizationId_bucket_minute:{organizationId:org,bucket,minute}},
        create:{organizationId:org,bucket,minute,count:1},update:{count:{increment:1}}});
      if(row.count>limit)throw new AuditorRateLimit(Math.max(1,Math.ceil((minute.getTime()+60000-Date.now())/1000)));
    }
    await tx.customerApiBudget.deleteMany({where:{organizationId:org,minute:{lt:new Date(minute.getTime()-86400000)}}});
    await tx.auditGrant.update({where:{id},data:{apiLastUsedAt:new Date()}});
  });
  return access;
}

export async function auditorPackage(request:Request) {
  const access=await auditorAccess(request);
  return access(async(tx,grant,room,userId)=>{
    const shared=manifest(room),files=await filesWithAvailability(tx,room.organizationId,shared);
    const body={format:"regpilot-auditor-package-v1",roomId:room.id,title:room.title,purpose:room.purpose,
      publishedAt:room.publishedAt!.toISOString(),roomExpiresAt:room.expiresAt.toISOString(),accessExpiresAt:grant.apiExpiresAt!.toISOString(),
      selectionHash:room.manifestHash,period:shared.period??null,
      controls:(shared.requests??[]).map(r=>({requestId:r.id,requestTitle:r.title,title:r.controlTitle,version:r.controlVersion,
        acceptedAt:r.acceptedAt,coverage:r.coverage,evidenceIds:r.fileIds})),
      evidence:files.map(f=>f.available?{id:f.id,state:"AVAILABLE" as const,filename:f.filename,contentType:f.contentType,
        bytes:f.sizeBytes,sha256:f.sha256,reviewVersion:f.reviewVersion,reviewedAt:f.reviewedAt,
        download:"/api/v1/auditor/evidence/"+f.id}:{id:f.id,state:"WITHDRAWN" as const}),
    };
    const etag='"'+hashValue(body)+'"';
    await event(tx,room.organizationId,userId,"api_package_read",room.id,{grantId:grant.id,available:files.filter(f=>f.available).length});
    return {body,etag};
  });
}
export async function auditorFile(request:Request,id:string,store?:EvidenceObjectStore){
  const access=await auditorAccess(request);
  return downloadScopedAuditEvidence(access,z.uuid().parse(id),store,true);
}
export function auditorApiFailure(error:unknown) {
  const known=error instanceof IntelligenceError;
  const status=known?error.status:error instanceof z.ZodError?400:503;
  const headers:Record<string,string>={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
  if(status===401)headers["WWW-Authenticate"]='Bearer realm="RegPilot auditor"';
  if(error instanceof AuditorRateLimit)headers["Retry-After"]=String(error.retryAfter);
  return Response.json({error:known?error.message:status===400?"Invalid evidence identifier":"Auditor service unavailable"},{status,headers});
}
