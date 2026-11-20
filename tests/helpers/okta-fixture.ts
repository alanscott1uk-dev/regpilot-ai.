import assert from "node:assert/strict";
import type {OktaTarget} from "../../lib/connectors/nango-okta";

export const oktaConfig={key:"fictional-nango-environment-key",integration:"okta-pilot"};
export const target:OktaTarget={connectionId:"Directory-With-Case",groupId:"00g"+"B".repeat(17),removedUserId:"00u"+"A".repeat(17)};
export const member=(n:number,status="ACTIVE")=>({id:"00u"+String(n).padStart(17,"0"),status,profile:{email:"private@example.invalid"}});
export const groupUrl="https://fictional.okta.com/api/v1/groups/"+target.groupId;
type Reply=(url:URL)=>Response;
export function mockOkta(org:string,pages:ReturnType<typeof member>[][],override?:(url:URL)=>Response|undefined):typeof fetch {
  return async(input,init)=>{
    const url=new URL(String(input)),headers=new Headers(init?.headers);
    assert.equal(url.origin,"https://api.nango.dev");
    assert.equal(init?.method,"GET");assert.equal(init?.redirect,"error");
    assert.equal(headers.get("Authorization"),"Bearer "+oktaConfig.key);
    const list:Reply=u=>{
      assert.equal(headers.has("Connection-Id"),false);
      const correct=u.searchParams.get("tags[organization_id]")===org;
      return Response.json({connections:correct?[{connection_id:target.connectionId,provider_config_key:oktaConfig.integration,
        provider:"okta",tags:{organization_id:org},errors:[],metadata:{name:"PRIVATE DIRECTORY"}}]:[]});
    };
    if (url.pathname==="/connections") return override?.(url) || list(url);
    assert.equal(headers.get("Connection-Id"),target.connectionId);
    assert.equal(headers.get("Provider-Config-Key"),oktaConfig.integration);assert.equal(headers.has("Base-Url-Override"),false);
    const overridden=override?.(url);if(overridden)return overridden;
    const path=url.pathname.replace(/^\/proxy/,"");
    if (path==="/api/v1/groups/"+target.groupId) return Response.json({id:target.groupId,_links:{users:{href:groupUrl+"/users"}},profile:{name:"PRIVATE GROUP"}});
    if (path==="/api/v1/users/"+target.removedUserId) return Response.json({id:target.removedUserId,profile:{email:"private@example.invalid"}});
    assert.equal(path,"/api/v1/groups/"+target.groupId+"/users");
    const page=Number(url.searchParams.get("after")||0);assert.ok(pages[page]);
    let link='<'+groupUrl+'/users'+url.search+'>; rel="self"';
    if (page+1<pages.length) link+=', <'+groupUrl+'/users?limit=50&after='+(page+1)+'>; rel="next"';
    return Response.json(pages[page],{headers:{link}});
  };
}
