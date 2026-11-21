import {z} from "zod";
import {readBoundedJson} from "./bounded-http";
import {resilientGet} from "./resilient-http";
import {CollectionError} from "./collection-error";
import {verifiedMicrosoftGraph,GRAPH} from "./microsoft-graph";
import {workforceCredentials,type WorkforceTarget} from "./workforce-target";
import type {Observation} from "./observation";
import type {ConnectorCheck} from "./github";

const basic=(name:string,password:string)=>"Basic "+Buffer.from(name+":"+password).toString("base64");
async function record(response:Response) {
  if(!response.ok){
    await response.body?.cancel();
    if(response.status===404)return null;
    throw new CollectionError([401,403].includes(response.status)?"CREDENTIAL_REJECTED":"PROVIDER_UNAVAILABLE");
  }
  return readBoundedJson(response,128*1024);
}
const aliases=(u:{mail?:unknown;userPrincipalName?:unknown;proxyAddresses?:unknown})=>[
  u.mail,u.userPrincipalName,...(Array.isArray(u.proxyAddresses)?u.proxyAddresses.filter(x=>typeof x==="string"&&/^smtp:/i.test(x)).map(x=>x.slice(5)):[])
].filter((x):x is string=>typeof x==="string").map(x=>x.toLowerCase());
const check=(id:string,label:string,status:ConnectorCheck["status"],observed:string,nextStep:string):ConnectorCheck=>({id,label,status,observed,nextStep});

export async function collectWorkforce(t:WorkforceTarget,credential:unknown,fetcher:typeof fetch=fetch):Promise<Observation>{
  const secrets=workforceCredentials.parse(credential);
  const hrOrigin="https://"+t.bambooSite+".bamboohr.com",jiraOrigin="https://"+t.jiraSite+".atlassian.net";
  const hrRead=resilientGet(fetcher,hrOrigin,{Authorization:basic(secrets.bambooKey,"x"),Accept:"application/json"});
  const jiraRead=resilientGet(fetcher,jiraOrigin,{Authorization:basic(secrets.jiraEmail,secrets.jiraToken),Accept:"application/json"});
  const hrPath="/api/v1/employees/"+t.employeeId;
  const hr=await record(await hrRead(hrOrigin+hrPath+"?fields=status,terminationDate,workEmail"));
  if(hr&&String(hr.id)!==t.employeeId)throw new CollectionError("TARGET_MISMATCH");
  const today=new Date().toISOString().slice(0,10);
  const left=hr?.status==="Inactive"&&z.iso.date().safeParse(hr.terminationDate).success&&hr.terminationDate<=today;
  const label="regpilot-"+t.bambooSite+"-"+t.employeeId;
  const ticket=await record(await jiraRead(jiraOrigin+"/rest/api/3/issue/"+t.issueKey+"?fields=status,labels,project"));
  if(ticket&&(ticket.key!==t.issueKey||ticket.fields?.project?.key!==t.issueKey.split("-")[0]))throw new CollectionError("TARGET_MISMATCH");
  const linked=Array.isArray(ticket?.fields?.labels)&&ticket.fields.labels.includes(label);
  const category=linked?ticket.fields?.status?.statusCategory?.key:undefined;
  const known=["new","indeterminate","done"].includes(category);
  const checks:ConnectorCheck[]=[
    check("hr-leaver","BambooHR termination is in effect",left?"PASS":"UNKNOWN",left?"Inactive with effective termination on "+hr.terminationDate:"Effective termination could not be verified","Check the employee ID, termination date and field permissions in BambooHR."),
    check("jira-remediation","Linked Jira remediation ticket is done",known?(category==="done"?"PASS":"FAIL"):"UNKNOWN",
      known?t.issueKey+" · "+category:"Missing issue, matching employee label or workflow status",
      "Review "+t.issueKey+" and its employee label "+label+" in the configured Jira site.")
  ];
  let identity="The HR record has no confirmed leaver and usable work email.";
  const userSource=GRAPH+"/v1.0/users/"+t.objectId;
  let disabled:boolean|undefined,matched=false,pointRead=false;
  if(left&&z.email().max(254).safeParse(hr.workEmail).success){
    const email=hr.workEmail.toLowerCase(),literal=email.replaceAll("'","''");
    const get=await verifiedMicrosoftGraph(t,secrets.clientSecret,fetcher,{"ConsistencyLevel":"eventual"});
    const params=new URLSearchParams({$filter:"mail eq '"+literal+"' or userPrincipalName eq '"+literal+"' or proxyAddresses/any(p:p eq 'smtp:"+literal+"')",$count:"true",$top:"2",$select:"id"});
    const candidates=await record(await get(GRAPH+"/v1.0/users?"+params));
    const rows=candidates?.value;
    if(!Array.isArray(rows)||candidates["@odata.nextLink"]||candidates["@odata.count"]!==rows.length){
      identity="The directory returned incomplete matching results.";
    }else if(rows.length!==1||String(rows[0]?.id).toLowerCase()!==t.objectId){
      identity=rows.length>1?"More than one directory identity matches the leaver.":"No unique match to the configured directory object.";
    }else{
      // Query the immutable object after reading the ticket. A closed ticket or an eventually consistent search cannot verify removal.
      const user=await record(await get(userSource+"?$select=id,userPrincipalName,mail,proxyAddresses,accountEnabled"));
      pointRead=true;
      matched=Boolean(user&&String(user.id).toLowerCase()===t.objectId&&aliases(user).includes(email));
      identity=matched?"Unique alias and immutable directory ID confirmed.":"The identity changed or disappeared during verification.";
      if(matched&&typeof user.accountEnabled==="boolean")disabled=!user.accountEnabled;
    }
  }
  checks.push(check("entra-identity","Matched Microsoft Entra identity",matched?"PASS":"UNKNOWN",identity,"Resolve the HR email and immutable directory object before relying on this check."),
    check("entra-disabled","Fresh Entra read confirms the account is disabled",disabled===undefined?"UNKNOWN":disabled?"PASS":"FAIL",
      disabled===undefined?"Account state could not be verified.":disabled?"Matched account is disabled.":"Matched account is still enabled.",
      "Recheck the Microsoft account after the operator acts on the ticket."));
  const ticketSource=jiraOrigin+"/browse/"+t.issueKey;
  const sources:Record<string,string>={"hr-leaver":hrOrigin+hrPath+"?fields=status,terminationDate","jira-remediation":ticketSource};
  if(pointRead){sources["entra-identity"]=userSource;sources["entra-disabled"]=userSource+"?$select=id,accountEnabled";}
  return {engine:"bamboo-entra-jira-leaver-1.0.0",sourceUrl:ticketSource,capturedAt:new Date().toISOString(),
    checks:checks.map(item=>sources[item.id]?{...item,sourceUrl:sources[item.id]}:item),
    limitations:["One named BambooHR employee, Entra object and Jira issue per connection. Checks cover account enablement, not session revocation or access to other systems."]};
}
