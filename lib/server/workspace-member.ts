import type {Prisma} from "@prisma/client";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError} from "./intelligence-service";
import {allowedEmail} from "../ai/security.mjs";
export async function requireMember(tx:Prisma.TransactionClient,ctx:AuthorizedContext,roles:readonly string[]=["OWNER","ADMIN","EDITOR","VIEWER"]){
 const rows=await tx.$queryRaw<Array<{role:string;email:string}>>`SELECT m.role::text AS role,u.email FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."organizationId"=${ctx.organizationId}::uuid AND m."userId"=${ctx.userId}::uuid FOR SHARE OF m,u`;
 if(!rows[0]||!roles.includes(rows[0].role)||!allowedEmail(rows[0].email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new IntelligenceError("Workspace permission is no longer available",403);
 return rows[0];
}
export const ADMIN=["OWNER","ADMIN"];
export const WRITER=["OWNER","ADMIN","EDITOR"];
