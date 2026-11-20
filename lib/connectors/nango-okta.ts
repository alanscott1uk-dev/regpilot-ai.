import {createHash} from "node:crypto";
import {z} from "zod";
import {providerReader, validCredential} from "./bounded-http";
import {CollectionError} from "./collection-error";
import type {Observation} from "./observation";
import {checkedJson} from "../services/http";

const api = "https://api.nango.dev";
const connectionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
const groupId = z.string().regex(/^00g[A-Za-z0-9]{17}$/);
const userId = z.string().regex(/^00u[A-Za-z0-9]{17}$/);
export const oktaTarget = z.object({connectionId, groupId, removedUserId:userId.optional()});
export type OktaTarget = z.infer<typeof oktaTarget>;
export type NangoConfig = {key:string; integration:string};
export function nangoConfig(): NangoConfig {
  const key = process.env.REGPILOT_NANGO_API_KEY || "";
  const integration = process.env.REGPILOT_NANGO_OKTA_INTEGRATION || "okta";
  if (!validCredential(key) || !connectionId.safeParse(integration).success) throw new CollectionError("PROVIDER_DISABLED");
  return {key,integration};
}

export async function oktaConnections(org:string, config:NangoConfig, fetcher:typeof fetch=fetch, exact?:string) {
  const params = new URLSearchParams({"tags[organization_id]":z.uuid().parse(org),limit:"100"});
  if (exact) params.set("connectionId",connectionId.parse(exact));
  const read = providerReader(fetcher,{Authorization:"Bearer "+config.key},6000);
  const rows = (await read(api+"/connections?"+params))?.body?.connections;
  if (!Array.isArray(rows) || rows.length>100) throw new CollectionError("INVALID_RESPONSE");
  return rows.filter(row=>row?.provider==="okta" && row.provider_config_key===config.integration &&
      row.tags?.organization_id===org && (!exact || row.connection_id===exact) &&
      connectionId.safeParse(row.connection_id).success && Array.isArray(row.errors) &&
      !row.errors.some((err:{type?:string}|null)=>!err || err.type==="auth"))
    .map((row:{connection_id:string})=>row.connection_id);
}

async function directoryReader(org:string, id:string, config:NangoConfig, fetcher:typeof fetch) {
  const bound=await oktaConnections(org,config,fetcher,connectionId.parse(id));
  if (bound.length!==1) throw new CollectionError("TARGET_MISMATCH");
  return providerReader(fetcher,{Authorization:"Bearer "+config.key,"Provider-Config-Key":config.integration,
    "Connection-Id":id,Retries:"0"},17000);
}

const groupQuery=z.string().trim().min(2).max(80).regex(/^[^\x00-\x1f\x7f]+$/);
export async function findOktaGroups(org:string, id:string, query:string, config:NangoConfig, fetcher:typeof fetch=fetch) {
  const params=new URLSearchParams({q:groupQuery.parse(query),limit:"20"});
  const read=await directoryReader(org,id,config,fetcher);
  const rows=(await read(api+"/proxy/api/v1/groups?"+params))!.body;
  if (!Array.isArray(rows) || rows.length>20) throw new CollectionError("INVALID_RESPONSE");
  const shape=z.object({id:groupId,profile:z.object({name:z.string().trim().min(1).max(255)})});
  return rows.map(row=>{
    const parsed=shape.safeParse(row);
    if (!parsed.success) throw new CollectionError("INVALID_RESPONSE");
    return {id:parsed.data.id,name:parsed.data.profile.name};
  });
}

export async function oktaConnectSession(org:string, actor:string, config:NangoConfig, fetcher:typeof fetch=fetch) {
  const response = await fetcher(api+"/connect/sessions",{
    method:"POST",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(6000),
    headers:{Authorization:"Bearer "+config.key,"Content-Type":"application/json"},
    body:JSON.stringify({allowed_integrations:[config.integration],tags:{organization_id:z.uuid().parse(org),end_user_id:z.uuid().parse(actor)}})
  });
  const session = (await checkedJson(response,8192))?.data;
  const url = new URL(session?.connect_link);
  const expires = Date.parse(session?.expires_at);
  if (url.origin!=="https://connect.nango.dev" || url.username || url.password || url.hash ||
      !Number.isFinite(expires) || expires<=Date.now() || expires>Date.now()+31*60000)
    throw new CollectionError("INVALID_RESPONSE");
  return {link:url.href,expiresAt:new Date(expires).toISOString()};
}

const lifecycle = new Set(["STAGED","PROVISIONED","ACTIVE","RECOVERY","LOCKED_OUT","PASSWORD_EXPIRED","SUSPENDED","DEPROVISIONED"]);
const pageSize = 50, maxPages = 8;

// The upstream URL is examined only. Every request goes to Nango's fixed proxy origin.
function upstreamUrl(raw:unknown, path:string, origin?:string) {
  if (typeof raw!=="string" || raw.length>2048) throw new CollectionError("INVALID_RESPONSE");
  const url = URL.parse(raw);
  if (!url || url.protocol!=="https:" || !/^[a-z0-9-]+\.okta\.com$/.test(url.hostname) ||
      url.username || url.password || url.port || url.hash || url.pathname!==path || (origin && url.origin!==origin))
    throw new CollectionError("TARGET_MISMATCH");
  return url;
}

function pagination(headers:Headers, origin:string, path:string, current:string) {
  const links=headers.get("link");
  if (!links) return {complete:false};
  let self=false, next:string|undefined;
  for (const part of links.split(/,(?=\s*<)/)) {
    const match=/^\s*<([^>]+)>\s*;\s*rel="(self|next|prev|first|last)"\s*$/.exec(part);
    if (!match) throw new CollectionError("INVALID_RESPONSE");
    if (match[2]!=="self" && match[2]!=="next") continue;
    const url=upstreamUrl(match[1],path,origin);
    if ([...url.searchParams.keys()].some(k=>k!=="after" && k!=="limit") ||
        url.searchParams.getAll("after").length>1 || url.searchParams.getAll("limit").length>1 ||
        (url.searchParams.has("limit") && url.searchParams.get("limit")!==String(pageSize)))
      throw new CollectionError("INVALID_RESPONSE");
    const after=url.searchParams.get("after") || "";
    if (match[2]==="self") {
      if (self || after!==current) throw new CollectionError("TARGET_MISMATCH");
      self=true;
    } else {
      if (next || !after || after.length>512 || /[\x00-\x1f\x7f]/.test(after)) throw new CollectionError("INVALID_RESPONSE");
      next=url.search;
    }
  }
  return {complete:self && !next,next};
}

export async function collectOkta(target:OktaTarget, org:string, config:NangoConfig, fetcher:typeof fetch=fetch):Promise<Observation> {
  const t=oktaTarget.parse(target);
  const read=await directoryReader(org,t.connectionId,config,fetcher);
  const base=api+"/proxy", groupPath="/api/v1/groups/"+t.groupId, membersPath=groupPath+"/users";
  const group=(await read(base+groupPath))!.body;
  if (group?.id!==t.groupId) throw new CollectionError("TARGET_MISMATCH");
  const origin=upstreamUrl(group?._links?.users?.href,membersPath).origin;
  if (t.removedUserId) {
    const user=(await read(base+"/api/v1/users/"+t.removedUserId))!.body;
    if (user?.id!==t.removedUserId) throw new CollectionError("TARGET_MISMATCH");
  }
  const ids=new Set<string>(), visited=new Set<string>();
  let blocked=0, unknown=0, complete=false, query="?limit="+pageSize;
  for (let page=0;page<maxPages;page++) {
    const cursor=new URLSearchParams(query).get("after") || "";
    if (visited.has(cursor)) throw new CollectionError("INVALID_RESPONSE");
    visited.add(cursor);
    const {body,headers}=(await read(base+membersPath+query))!;
    if (!Array.isArray(body) || body.length>pageSize) throw new CollectionError("INVALID_RESPONSE");
    for (const row of body) {
      if (!userId.safeParse(row?.id).success || ids.has(row.id)) throw new CollectionError("INVALID_RESPONSE");
      ids.add(row.id);
      if (!lifecycle.has(row.status)) unknown++;
      if (row.status==="SUSPENDED" || row.status==="DEPROVISIONED") blocked++;
    }
    const links=pagination(headers,origin,membersPath,cursor);
    if (!links.next) { complete=links.complete; break; }
    query=links.next;
  }
  const follow="Review the group in Okta and collect fresh evidence after any access change.";
  const fingerprint=complete?createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex"):null;
  const checks:Observation["checks"]=[
    {id:"group-coverage",label:"Complete group membership inventory",status:complete?"PASS":"UNKNOWN",
      observed:complete?ids.size+" members. Membership digest "+fingerprint:ids.size+" members read. End of inventory unconfirmed.",
      nextStep:"Inspect pagination and group size if collection is incomplete."},
    {id:"inactive-grants",label:"Group has no suspended or deprovisioned members",status:blocked?"FAIL":complete && !unknown?"PASS":"UNKNOWN",
      observed:blocked+" suspended or deprovisioned members observed. "+unknown+" unrecognised lifecycle states.",nextStep:follow}
  ];
  if (t.removedUserId) {
    const present=ids.has(t.removedUserId);
    checks.push({id:"revoked-grant",label:"Selected user's group access has been removed",status:present?"FAIL":complete?"PASS":"UNKNOWN",
      observed:present?"Selected user is a member.":complete?"Selected user is absent from the complete group inventory.":"Absence could not be verified.",nextStep:follow});
  }
  return {engine:"nango-okta-group-1.0.0",sourceUrl:origin+groupPath,capturedAt:new Date().toISOString(),checks,
    limitations:["Group membership and account status are observed at collection time. Direct application grants and existing sessions require separate evidence."]};
}
