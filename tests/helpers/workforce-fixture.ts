import assert from "node:assert/strict";

export const leaver={bambooSite:"sample-employer",bambooCompanyId:"17",employeeId:"42",jiraSite:"sample-it",issueKey:"OPS-42",
  tenantId:"f3cf2811-b9cf-4522-b5d9-28c55adddd37",clientId:"8d54cb3c-5e26-4673-8d4e-37437f84381c",objectId:"7030c933-f1b8-4f75-8f37-ad270833be3f"};
export const credentials={bambooKey:"fictional-bamboo-key",jiraEmail:"reader@example.invalid",jiraToken:"fictional-jira-token",clientSecret:"fictional-microsoft-secret"};
export function workforceTransport(){
  const state={enabled:true,issue:"done",linked:true,aliases:1,partial:false,revoked:false,absent:false,wrongObject:false,missingEmail:false,termination:"2024-11-01"};
  const calls:string[]=[],mail="former@example.invalid";
  const fetcher:typeof fetch=async(input,init)=>{
    const u=new URL(String(input));calls.push(u.host+u.pathname);
    assert.equal(init?.redirect,"error");
    if(u.host==="sample-employer.bamboohr.com"){
      assert.equal(u.pathname,"/api/v1/employees/42");return state.revoked?new Response(null,{status:401}):Response.json({id:"42",status:"Inactive",terminationDate:state.termination,...(!state.missingEmail?{workEmail:mail}:{})});
    }
    if(u.host==="sample-it.atlassian.net"){
      assert.equal(u.pathname,"/rest/api/3/issue/OPS-42");return Response.json({key:"OPS-42",fields:{labels:state.linked?["regpilot-sample-employer-42"]:[],project:{key:"OPS"},status:{statusCategory:{key:state.issue}}}});
    }
    if(u.host==="login.microsoftonline.com"){assert.equal(init?.method,"POST");return Response.json({token_type:"Bearer",access_token:"fictional-auth-token"});}
    assert.equal(u.host,"graph.microsoft.com");
    if(u.pathname==="/v1.0/organization")return Response.json({value:[{id:leaver.tenantId}]});
    if(u.pathname==="/v1.0/users"){
      assert.match(u.searchParams.get("$filter")||"",/proxyAddresses/);
      return Response.json({value:Array.from({length:state.aliases},(_,i)=>({id:i?"46c2fb00-e102-48bf-929f-ace67793c5a7":leaver.objectId})),
        "@odata.count":state.aliases,...(state.partial?{"@odata.nextLink":"https://graph.microsoft.com/v1.0/users?next=..."}:{})});
    }
    assert.equal(u.pathname,"/v1.0/users/"+leaver.objectId);
    return state.absent?new Response(null,{status:404}):Response.json({id:state.wrongObject?leaver.clientId:leaver.objectId,userPrincipalName:"different@example.invalid",proxyAddresses:["SMTP:"+mail],accountEnabled:state.enabled});
  };
  return {state,calls,fetcher};
}
