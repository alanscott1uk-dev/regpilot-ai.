import {paidMaster} from "../services/config";
import {db} from "./db";
import {authorizeOrganization} from "./authorization";
import {allowedEmail} from "../ai/security.mjs";

export class AccessError extends Error {
 status:number;
 constructor(message:string,status:number){super(message);this.name="AccessError";this.status=status;}
}
export function workspaceConfigured(){
 return process.env.REGPILOT_WORKSPACE_ENABLED==="true"&&!!process.env.REGPILOT_AI_ALLOWED_EMAILS?.trim()&&
 !!process.env.DATABASE_URL&&!!(process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL)&&
 !!(process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
export function aiConfigured(){
 const configuredModel=process.env.REGPILOT_AI_MODEL||"";
 return paidMaster()&&workspaceConfigured()&&process.env.REGPILOT_AI_ENABLED==="true"&&process.env.REGPILOT_AI_SAFEGUARDS_VERIFIED==="true"&&
  process.env.REGPILOT_AI_PROCESSOR_REVIEWED==="true"&&process.env.REGPILOT_AI_TRANSFER_REVIEWED==="true"&&process.env.REGPILOT_AI_INTENDED_USE_REVIEWED==="true"&&
  /^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(configuredModel)&&
  !!(process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN);
}
export type VerifiedWorkspaceIdentity={externalId:string;email:string};
export async function verifyAiIdentity(request:Request):Promise<VerifiedWorkspaceIdentity>{
 if(!workspaceConfigured())throw new AccessError("Private workspace not configured",503);
 const header=request.headers.get("authorization")||"";
 if(!/^Bearer [A-Za-z0-9._-]{20,5000}$/.test(header))throw new AccessError("Sign in to continue",401);
 const token=header.slice(7),base=(process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL||"").replace(/\/$/,"");
 const key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
 let result:Response;
 try{
  result=await fetch(base+"/auth/v1/user",{headers:{apikey:key,authorization:"Bearer "+token},cache:"no-store",signal:AbortSignal.timeout(8000)});
 }catch{throw new AccessError("Authentication provider unavailable",503);}
 if(!result.ok)throw new AccessError("Please sign in again",401);
 const user=await result.json();
 if(!user||typeof user.id!=="string"||typeof user.email!=="string"||!user.email_confirmed_at||user.aud!=="authenticated")throw new AccessError("Verified email login required",401);
 if(!allowedEmail(user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new AccessError("This pilot is invitation-only",403);
 return {externalId:user.id,email:user.email.toLowerCase()};
}
export async function authorisedWorkspaceContext(request:Request,organizationId:string,allowedRoles:readonly ("OWNER"|"ADMIN"|"EDITOR"|"VIEWER")[]=["OWNER","ADMIN","EDITOR","VIEWER"]){
 const identity=await verifyAiIdentity(request);
 const context=await authorizeOrganization({externalId:identity.externalId},organizationId,allowedRoles);
 if(!context)throw new AccessError("No permission for this organisation",403);
 return {...context,email:identity.email};
}
export async function authorisedAiContext(request:Request,organizationId:string){
 return authorisedWorkspaceContext(request,organizationId,["OWNER","ADMIN","EDITOR"]);
}
export async function listAiOrganisations(request:Request){
 const identity=await verifyAiIdentity(request);
 const user=await db.user.findUnique({where:{externalId:identity.externalId},select:{id:true,memberships:{select:{role:true,organization:{select:{id:true,name:true}}}}}});
 return {email:identity.email,userId:user?.id||null,organisations:user?.memberships.map(m=>({id:m.organization.id,name:m.organization.name,role:m.role}))||[]};
}
export async function bootstrapAiOrganisation(request:Request,companyName:string){
 const identity=await verifyAiIdentity(request);
 const name=companyName.trim();
 if(name.length<3||name.length>100)throw new AccessError("Enter a company name from 3 to 100 characters",400);
 return db.$transaction(async tx=>{
  const user=await tx.user.upsert({where:{externalId:identity.externalId},create:{externalId:identity.externalId,email:identity.email},update:{email:identity.email}});
  const existing=await tx.membership.findFirst({where:{userId:user.id},include:{organization:{select:{id:true,name:true}}}});
  if(existing)return {id:existing.organization.id,name:existing.organization.name,role:existing.role};
  const org=await tx.organization.create({data:{name},select:{id:true,name:true}});
  await tx.membership.create({data:{organizationId:org.id,userId:user.id,role:"OWNER"}});
  await tx.auditEvent.create({data:{organizationId:org.id,actorId:user.id,action:"organisation.pilot_created",entityType:"Organization",entityId:org.id,details:{origin:"allowlisted-supabase-user"}}});
  return {id:org.id,name:org.name,role:"OWNER"};
 },{isolationLevel:"Serializable"});
}
