import {z} from "zod";

const site = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/);
export const workforceTarget = z.object({
  bambooSite: site, bambooCompanyId:z.string().regex(/^[1-9]\d{0,14}$/).optional(), employeeId: z.string().regex(/^[1-9]\d{0,14}$/),
  jiraSite: site, issueKey: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}-[1-9]\d{0,10}$/),
  tenantId: z.uuid().toLowerCase(), clientId: z.uuid().toLowerCase(), objectId: z.uuid().toLowerCase()
});
export type WorkforceTarget = z.infer<typeof workforceTarget>;
const secret = z.string().min(16).max(512).regex(/^[^\s\x00-\x1f\x7f]+$/);
export const workforceCredentials = z.object({
  bambooKey: secret.refine(v=>!v.includes(":")), jiraEmail: z.email().max(254), jiraToken: secret, clientSecret: secret
}).strict();
export function workforceKeys(t: WorkforceTarget) {
  return {repository:["leaver",t.bambooSite,t.employeeId,t.jiraSite,t.issueKey,...(t.bambooCompanyId?[t.bambooCompanyId]:[])].join(":"),branch:[t.tenantId,t.clientId,t.objectId].join(":")};
}
export function readWorkforceKeys(repository:string,branch:string) {
  const [kind,bambooSite,employeeId,jiraSite,issueKey,bambooCompanyId,...extra]=repository.split(":");
  const [tenantId,clientId,objectId,...rest]=branch.split(":");
  if(kind!=="leaver"||extra.length||rest.length)return null;
  const parsed=workforceTarget.safeParse({...(bambooCompanyId?{bambooCompanyId}:{}),bambooSite,employeeId,jiraSite,issueKey,tenantId,clientId,objectId});
  return parsed.success?parsed.data:null;
}
