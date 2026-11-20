import {readWorkforceKeys} from "../../../lib/connectors/workforce-target";

const scopeFields=[
  ["bambooSite","BambooHR company subdomain"],["employeeId","BambooHR employee ID"],
  ["jiraSite","Jira Cloud site subdomain"],["issueKey","Jira remediation issue key"],
  ["tenantId","Microsoft directory ID"],["clientId","Read-only application ID"],["objectId","Leaver’s Microsoft object ID"]
] as const;
const secretFields=[["bambooKey","BambooHR read-only API key"],["jiraEmail","Jira service account email"],["jiraToken","Jira read-only account API token"],["clientSecret","Microsoft application secret"]] as const;

export function workforceFormData(form:HTMLFormElement,data:FormData){
  const scope=Object.fromEntries(scopeFields.map(([key])=>[key,data.get(key)]));
  const credentials=Object.fromEntries(secretFields.map(([key])=>[key,data.get(key)]));
  for(const [key] of secretFields)(form.elements.namedItem(key) as HTMLInputElement).value="";
  return {...scope,...(data.get("bambooCompanyId")?{bambooCompanyId:data.get("bambooCompanyId")} : {}),...(Object.values(credentials).some(Boolean)?{credentials}:{})};
}
export function WorkforceFields({connection}:{connection?:{repository:string;branch:string}}){
  const saved=connection?readWorkforceKeys(connection.repository,connection.branch):null;
  return <>
    {scopeFields.map(([key,label])=><label key={key}>{label}<input name={key} required defaultValue={saved?.[key]} maxLength={60}/></label>)}
    <label>BambooHR numeric company ID (for event delivery)<input name="bambooCompanyId" pattern="[1-9][0-9]{0,14}" defaultValue={saved?.bambooCompanyId}/></label>
    <p>Use a BambooHR account that can read status, termination date and work email. In Jira, label the existing issue regpilot-&#123;BambooHR subdomain&#125;-&#123;employee ID&#125;. Give the Microsoft application User.Read.All and Organization.Read.All with administrator consent.</p>
    {secretFields.map(([key,label])=><label key={key}>{label}<input type={key==="jiraEmail"?"email":"password"} name={key} required={!connection} autoComplete="off" maxLength={512}/></label>)}
    {connection&&<p>To rotate credentials, enter a complete new set.</p>}
  </>;
}

export function BambooEvents({id,version,busy,save}:{id:string;version:number;busy:boolean;save:(v:Record<string,unknown>)=>void}){
  const path="/api/integrations/webhooks/bamboohr/"+id;
  return <details><summary>BambooHR event delivery</summary>
    <p>Register an event-based JSON webhook in the configured BambooHR company. Select employee updates to status, work email and termination date, and employee deletions. Use this callback URL.</p>
    <code>{typeof window==="undefined"?path:window.location.origin+path}</code>
    <form onSubmit={event=>{
      event.preventDefault();const field=event.currentTarget.elements.namedItem("signingKey") as HTMLInputElement;
      const secret=field.value;field.value="";save({version,enabled:true,secret});
    }}><label>BambooHR-issued signing key<input type="password" autoComplete="off" name="signingKey" required minLength={16} maxLength={128}/></label>
      <button disabled={busy}>Enable or rotate event verification</button></form>
    <button type="button" disabled={busy} onClick={()=>save({version,enabled:false})}>Disable event delivery</button></details>;
}
