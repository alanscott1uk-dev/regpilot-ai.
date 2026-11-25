import type {RecordProvider} from "../../lib/connectors/record-catalogue";

export const cloud = "8bb4a9de-7359-4067-ba72-36394e8a663f";
export const commit = "3".repeat(40);
export const token = "fictional-connector-token";
const sysId = "2".repeat(32);
type Case = {
  provider: RecordProvider; target: {scope:string;record:string;reference?:string};
  url: string; good: object; changed: object; wrong: object; changedCheck: string;
};
export const records: Case[] = [
  {provider:"JIRA", target:{scope:cloud,record:"QA-13"}, url:"https://api.atlassian.com/ex/jira/"+cloud+"/rest/api/3/issue/QA-13?fields=project,status,resolution,assignee",
    good:{key:"QA-13",fields:{project:{key:"QA"},assignee:{accountId:"private-owner"},status:{statusCategory:{key:"done"}},resolution:{id:"1"}}},
    changed:{key:"QA-13",fields:{project:{key:"QA"},assignee:null,status:{statusCategory:{key:"new"}},resolution:null}},wrong:{key:"QA-14"},changedCheck:"issue-done"},
  {provider:"SERVICENOW",target:{scope:"fictional",record:sysId},url:"https://fictional.service-now.com/api/now/v1/table/incident/"+sysId+"?sysparm_fields=sys_id,active,assigned_to,closed_at&sysparm_display_value=false&sysparm_exclude_reference_link=true",
    good:{result:{sys_id:sysId,active:"false",assigned_to:"4".repeat(32),closed_at:"2025-01-01 12:00:00"}},
    changed:{result:{sys_id:sysId,active:true,assigned_to:"",closed_at:""}},wrong:{result:{sys_id:"other"}},changedCheck:"incident-inactive"},
  {provider:"AZURE_DEVOPS",target:{scope:"fictional/"+cloud,record:"93",reference:commit},url:"https://dev.azure.com/fictional/"+cloud+"/_apis/build/builds/93?api-version=7.1",
    good:{id:93,project:{id:cloud},sourceVersion:commit,status:"completed",result:"succeeded"},
    changed:{id:93,project:{id:cloud},sourceVersion:"4".repeat(40),status:"completed",result:"partiallySucceeded"},wrong:{id:93,project:{id:"other"}},changedCheck:"build-revision"},
  {provider:"CONFLUENCE",target:{scope:cloud,record:"842",reference:"3"},url:"https://api.atlassian.com/ex/confluence/"+cloud+"/wiki/api/v2/pages/842",
    good:{id:"842",status:"current",version:{number:3}},changed:{id:"842",status:"current",version:{number:4}},wrong:{id:"841"},changedCheck:"page-version"},
  {provider:"SAFETYCULTURE",target:{scope:"template_abc",record:"audit_cde"},url:"https://api.safetyculture.io/audits/audit_cde",
    good:{audit_id:"audit_cde",template_id:"template_abc",archived:false,audit_data:{date_completed:"2025-01-01T12:00:00Z"}},
    changed:{audit_id:"audit_cde",template_id:"template_abc",archived:true,audit_data:{date_completed:null}},
    wrong:{audit_id:"audit_cde",template_id:"template_other"},changedCheck:"inspection-completed"},
  {"provider":"GITHUB_SCIM","target":{"scope":"fictional","record":"identity-19","reference":"inactive"},"url":"https://api.github.com/scim/v2/organizations/fictional/Users/identity-19","good":{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"id":"identity-19","active":false},"changed":{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"id":"identity-19","active":true},"wrong":{"id":"other"},"changedCheck":"expected-state"},
  {"provider":"ATLASSIAN_SCIM","target":{"scope":"8bb4a9de-7359-4067-ba72-36394e8a663f","record":"identity-19","reference":"inactive"},"url":"https://api.atlassian.com/scim/directory/8bb4a9de-7359-4067-ba72-36394e8a663f/Users/identity-19","good":{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"id":"identity-19","active":false},"changed":{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"id":"identity-19","active":true},"wrong":{"id":"other"},"changedCheck":"expected-state"},
  {"provider":"STATUSPAGE_COMPONENT","target":{"scope":"page0001","record":"comp0001","reference":"operational"},"url":"https://api.statuspage.io/v1/pages/page0001/components/comp0001","good":{"id":"comp0001","page_id":"page0001","status":"operational"},"changed":{"id":"comp0001","page_id":"page0001","status":"major_outage"},"wrong":{"id":"comp0001","page_id":"page0002"},"changedCheck":"expected-state"},
  {"provider":"ZENDESK_TICKET","target":{"scope":"fictional","record":"721","reference":"solved"},"url":"https://fictional.zendesk.com/api/v2/tickets/721.json","good":{"ticket":{"id":721,"status":"solved","assignee_id":31}},"changed":{"ticket":{"id":721,"status":"open","assignee_id":null}},"wrong":{"ticket":{"id":720}},"changedCheck":"expected-state"}
];
