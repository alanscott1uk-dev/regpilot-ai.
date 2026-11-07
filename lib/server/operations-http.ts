import {z} from "zod";
import {authorisedWorkspaceContext,workspaceConfigured} from "./ai-auth";
import {IntelligenceError} from "./intelligence-service";
import {EvidenceError} from "../evidence/file-guard.mjs";
import {failure,reply} from "./intelligence-http";
export {reply,readBody} from "./intelligence-http";
export function fail(e:unknown){if(e instanceof EvidenceError)return reply({error:e.message},e.status);if(e instanceof z.ZodError)return reply({error:"Check the supplied fields"},400);return failure(e);}
export function validId(v:unknown):string{const parsed=z.uuid().safeParse(v);if(!parsed.success)throw new IntelligenceError("Invalid identifier");return parsed.data;}
export function context(request:Request,org:unknown,write=false){if(!workspaceConfigured())throw new IntelligenceError("Private workspace awaits activation",503);return authorisedWorkspaceContext(request,validId(org),write?["OWNER","ADMIN"]:undefined);}
