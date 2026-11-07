import {teamWorkspace,inviteMember,changeMember,revokeInvitation} from "../../../../lib/server/team-service";
import {context,reply,fail,readBody,validId} from "../../../../lib/server/operations-http";
import {z} from "zod";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true);return reply(await teamWorkspace(ctx));}catch(e){return fail(e);}}
export async function POST(request:Request){try{const {organizationId,...data}=await readBody(request,2048),ctx=await context(request,organizationId,true);return reply(await inviteMember(ctx,data));}catch(e){return fail(e);}}
export async function PATCH(request:Request){try{const {organizationId,...data}=await readBody(request,2048),ctx=await context(request,organizationId,true);return reply(await changeMember(ctx,data));}catch(e){return fail(e);}}
export async function DELETE(request:Request){try{const data=await readBody(request,2048),ctx=await context(request,data.organizationId,true);return reply(await revokeInvitation(ctx,validId(data.id),z.number().int().positive().parse(data.version)));}catch(e){return fail(e);}}
