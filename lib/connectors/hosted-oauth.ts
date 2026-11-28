import {z} from "zod";
import {checkedJson} from "../services/http";
import {CollectionError} from "./collection-error";

export const brokerOrigin="https://api.nango.dev";
export const brokerId=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
export type NangoConfig={key:string;integration:string};

export async function hostedConnectSession(org:string,actor:string,config:NangoConfig,fetcher:typeof fetch=fetch,tags:Record<string,string>={},renewId?:string) {
  const response=await fetcher(brokerOrigin+"/connect/sessions"+(renewId?"/reconnect":""),{
    method:"POST",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(6000),
    headers:{Authorization:"Bearer "+config.key,"Content-Type":"application/json"},
    body:JSON.stringify({...(renewId?{integration_id:config.integration,connection_id:brokerId.parse(renewId)}:{allowed_integrations:[config.integration]}),tags:{...tags,organization_id:z.uuid().parse(org),end_user_id:z.uuid().parse(actor)}})
  });
  const session=(await checkedJson(response,8192))?.data;
  const url=typeof session?.connect_link==="string"?URL.parse(session.connect_link):null;
  const expires=Date.parse(session?.expires_at);
  if(!url||url.origin!=="https://connect.nango.dev"||url.username||url.password||url.hash||
     !Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+31*60000)throw new CollectionError("INVALID_RESPONSE");
  return {link:url.href,expiresAt:new Date(expires).toISOString()};
}
