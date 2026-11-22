import {collectPublicRegister,registerTargets} from './pharma-registers';
import {collectModelAccess,openAiProjectTarget,privateModelTarget} from './direct-model';
import {benchlingAccess} from './benchling-auth';
import {collectKeycloak,keycloakTarget} from './keycloak';
import {collectWorkflow,workflowTarget} from './workflow-evidence';
import { z } from "zod";
import { booleanCheck, providerReader, validCredential } from "./bounded-http";
import { CollectionError, type ConnectorCheck } from "./github";
import type { Observation } from "./observation";

import type { RecordProvider } from "./record-catalogue";

const guid = z.uuid().toLowerCase();
const slug = z.string().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/);
const number = z.string().regex(/^[1-9]\d{0,14}$/);
const azureScope = z.string().toLowerCase().refine(value => {
  const [org, project, ...rest] = value.split("/");
  return !rest.length && slug.safeParse(org).success && guid.safeParse(project).success;
});
export const calibrationBasis=z.string().max(120).refine(value=>{
 const [file,version,from,until,low,high,age,...extra]=value.split("/");
 const numeric=(s:string)=>/^-?\d{1,3}(?:\.\d{1,3})?$/.test(s);
 return !extra.length&&z.uuid().safeParse(file).success&&/^[1-9]\d{0,6}$/.test(version)&&z.iso.date().safeParse(from).success&&z.iso.date().safeParse(until).success&&from<until&&numeric(low)&&numeric(high)&&Number(low)<Number(high)&&/^[1-9]\d{0,3}$/.test(age)&&Number(age)<=1440;
});
export const recordTargets = {
  ...registerTargets,
  OPENAI_PROJECT_MODEL:openAiProjectTarget, PRIVATE_AI_MODEL:privateModelTarget,
  KEYCLOAK_REALM:keycloakTarget,
  GITHUB_WORKFLOW:workflowTarget,
  NANGO_SYNC:z.object({scope:z.string().max(201).regex(/^(?:regpilot-|rpw-)[A-Za-z0-9._-]{1,92}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),record:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/),reference:z.string().refine(v=>{const [provider,policy,...rest]=v.split('/');return !rest.length&&/^[a-z0-9][a-z0-9_-]{0,79}$/.test(provider)&&(policy===undefined||z.uuid().safeParse(policy).success);})}),
  UBIBOT:z.object({scope:number,record:z.string().regex(/^[A-Za-z0-9_-]{3,60}$/),reference:calibrationBasis}),
  BENCHLING:z.object({scope:slug,record:z.string().regex(/^(?:[a-z]{1,8}_[A-Za-z0-9]{1,48}|[a-f0-9-]{36})$/),reference:z.string().regex(/^etr_[A-Za-z0-9]{1,48}\/ent_[A-Za-z0-9]{1,48}$|^etr_[A-Za-z0-9]{1,48}\/usr_[A-Za-z0-9]{1,48}$/)}),
  JIRA: z.object({scope: guid, record: z.string().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}-[1-9]\d{0,10}$/)}),
  SERVICENOW: z.object({scope: slug, record: z.string().toLowerCase().regex(/^[a-f0-9]{32}$/)}),
  AZURE_DEVOPS: z.object({scope: azureScope, record: number, reference: z.string().toLowerCase().regex(/^[0-9a-f]{40}$/)}),
  CONFLUENCE: z.object({scope: guid, record: number, reference: number}),
  SAFETYCULTURE: z.object({scope: z.string().regex(/^template_[a-zA-Z0-9]{1,64}$/), record: z.string().regex(/^audit_[a-zA-Z0-9]{1,64}$/)})
} as const;

type Target = {scope: string; record: string; reference?: string};
export function recordKeys(provider: RecordProvider, target: Target) {
  if(provider==="NANGO_SYNC"){const [integration,connection]=target.scope.split("/");if((target.reference?.length??0)+1+target.record.length>120)throw new CollectionError("INVALID_TARGET");return {repository:"nango_sync:"+integration+":"+connection,branch:target.reference+":"+target.record};}
  return {repository: [provider.toLowerCase(), target.scope, target.record].join(":"), branch: target.reference ?? "record"};
}
export function readRecordKeys(provider: RecordProvider, repository: string, branch: string): Target {
  const [prefix, scope, record, ...extra] = repository.split(":");
  if (prefix !== provider.toLowerCase() || extra.length) throw new CollectionError("INVALID_TARGET");
  const [slug,model,...rest]=branch.split(":");
  if(provider==="NANGO_SYNC"&&rest.length)throw new CollectionError("INVALID_TARGET");
  const result = recordTargets[provider].strict().safeParse(provider==="NANGO_SYNC"?{scope:scope+"/"+record,record:model,reference:slug}:{scope, record, ...(branch === "record" ? {} : {reference: branch})});
  if (!result.success) throw new CollectionError("INVALID_TARGET");
  return result.data;
}

function check(id: string, label: string, value: boolean | undefined, nextStep: string, observed?: string) {
  const result = booleanCheck(id, label, value, true, nextStep);
  return observed === undefined ? result : {...result, observed};
}
function observation(engine: string, sourceUrl: string, checks: ConnectorCheck[], limits: string): Observation {
  return {engine: engine + "-1.0.0", capturedAt: new Date().toISOString(), sourceUrl, checks, limitations: [limits]};
}
function referencePresent(value: unknown, key: string): boolean | undefined {
  if (value === null || value === "") return false;
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const id = (value as Record<string, unknown>)[key];
  return typeof id === "string" && id.trim().length > 0 ? true : undefined;
}
const known = (value: unknown, values: string[]) => typeof value === "string" && values.includes(value);
function validTime(value: unknown): value is string {
  return typeof value === "string" && z.iso.datetime({offset:true}).safeParse(value).success && Date.parse(value) <= Date.now();
}

export async function collectOperationalRecord(provider: RecordProvider, target: Target, token: string, fetcher: typeof fetch = fetch, certificateHash?:string): Promise<Observation> {
  const parsed = recordTargets[provider].strict().safeParse(target);
  if (!parsed.success)throw new CollectionError("INVALID_TARGET");
  if(provider==="NHSBSA_MAPPING"||provider==="CLINICALTRIALS_GOV"||provider==="OPENFDA_RECALL"||provider==="DAILYMED_LABEL"||provider==="EUROPE_PMC"||provider==="MHRA_GUIDANCE")return collectPublicRegister(provider,parsed.data as Target,fetcher);
  if (!(provider==="BENCHLING"&&token.startsWith('{')?token.length<=1200:validCredential(token))) throw new CollectionError("INVALID_TARGET");
  const {scope, record, reference} = parsed.data as Target;
  if(provider==="BENCHLING")token=await benchlingAccess(scope,token,fetcher);
  const auth = provider === "AZURE_DEVOPS" ? "Basic " + Buffer.from(":" + token).toString("base64") : "Bearer " + token;
  const get = providerReader(fetcher, {Authorization: auth});

  switch (provider) {
    case "OPENAI_PROJECT_MODEL":case "PRIVATE_AI_MODEL":return collectModelAccess(provider,{scope,record},token,fetcher);
    case "KEYCLOAK_REALM":return collectKeycloak(keycloakTarget.parse(target),token,fetcher);
    case "GITHUB_WORKFLOW":return collectWorkflow(workflowTarget.parse(target),token,fetcher);
    case "NANGO_SYNC":throw new CollectionError("WORKSPACE_REQUIRED");
    case "UBIBOT": {
      const source="https://webapi.ubibot.com/channels/"+scope;
      const data=(await providerReader(fetcher,{})(source+"?"+new URLSearchParams({api_key:token})))!.body;
      const channel=Array.isArray(data?.channels)&&data.channels.length===1?data.channels[0]:data?.channel;
      if(data?.result!=="success"||String(channel?.channel_id)!==scope||channel?.serial!==record)throw new CollectionError("TARGET_MISMATCH");
      const [file,version,from,until,low,high,maxMinutes]=reference!.split("/");
      let values=channel.last_values;
      if(typeof values==="string"){try{values=JSON.parse(values);}catch{throw new CollectionError("INVALID_RESPONSE");}}
      const sample=values?.field1,value=sample?.value,stamp=sample?.created_at;
      const celsius=typeof value==="number"&&Number.isFinite(value)?value:undefined;
      const ms=typeof stamp==="number"&&Number.isInteger(stamp)&&stamp>0&&stamp<1e11?stamp*1000:NaN;
      const now=Date.now(),when=Number.isFinite(ms)?new Date(ms).toISOString():undefined;
      const calibrated=when&&certificateHash?from<=when.slice(0,10)&&when.slice(0,10)<until:undefined;
      return observation("ubibot-temperature",source,[
       check("logger-fresh","Reading within approved age",when?ms<=now&&now-ms<=Number(maxMinutes)*60000:undefined,"Check connectivity and collection interval.",when),
       check("logger-temperature","Latest internal temperature within limits",celsius===undefined?undefined:celsius>=Number(low)&&celsius<=Number(high),"Investigate excursions against the site procedure.",celsius===undefined?undefined:celsius+" °C · limits "+low+" to "+high+" °C"),
       check("logger-calibration","Reviewed certificate and calibration interval cover the reading",calibrated,"Check certificate identity, review revision and calibration dates.",file+" v"+version+" · "+(certificateHash??"certificate unavailable")+" · "+from+" to "+until)
      ],"Point reading for serial "+record+" from field1. The site binds the certificate and limits. Continuous interval coverage requires a logger window.");
    }
    case "BENCHLING": {
      const [entryId,reviewer]=reference!.split("/"),base="https://"+scope+".benchling.com/api/v2";
      const result=(await get(base+"/assay-results/"+record))!.body;
      if(result?.id!==record||result.entryId!==entryId)throw new CollectionError("TARGET_MISMATCH");
      const body=(await get(base+"/entries/"+entryId+"?returning=id,assignedReviewers,authors,archiveRecord,reviewRecord"))!.body;
      const entry=body?.entry??body;
      if(entry?.id!==entryId)throw new CollectionError("TARGET_MISMATCH");
      const review=entry.reviewRecord,processes=Array.isArray(review?.reviewProcesses)?review.reviewProcesses:[],assigned=Array.isArray(entry.assignedReviewers)?entry.assignedReviewers.some((r:{id?:string})=>r?.id===reviewer):undefined;
      const independent=Array.isArray(entry.authors)&&entry.authors.length>0&&entry.authors.every((r:{id?:string})=>typeof r?.id==="string"&&!!r.id)&&typeof result.creator?.id==="string"?result.creator.id!==reviewer&&!entry.authors.some((r:{id?:string})=>r?.id===reviewer):undefined;
      const process=processes.length===1?processes[0]:undefined;
      const approvalStages=Array.isArray(process?.stages)?process.stages.filter((s:any)=>s?.actionLabel==="APPROVE"):[];
      const approvers=new Set<string>();
      let stagesReadable=approvalStages.length>0;
      for(const stage of approvalStages){
        if(!Array.isArray(stage.reviewers)){stagesReadable=false;continue;}
        for(const person of stage.reviewers){
          if(!person?.id||typeof person.status!=="string")stagesReadable=false;
          else if(person.status==="FINISHED")approvers.add(person.id);
        }
      }
      const matched=stagesReadable&&process?.type!=="SELF_REVIEW"&&process?.completionStatus==="APPROVED"&&approvers.size===1&&approvers.has(reviewer)?process:undefined;
      const changes=z.array(z.object({id:z.string().min(1).max(100),createdAt:z.iso.datetime({offset:true}),action:z.string(),esigned:z.boolean().nullish()})).min(1).max(500).safeParse(review?.reviewChanges);
      const history=changes.success?[...changes.data].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)):[];
      const decision=history[0],unique=decision&&(!history[1]||Date.parse(history[1].createdAt)!==Date.parse(decision.createdAt));
      const afterResult=unique&&validTime(decision.createdAt)&&validTime(result.modifiedAt)?decision.action==="ACCEPT"&&Date.parse(decision.createdAt)>=Date.parse(result.modifiedAt):undefined;
      const reread=(await get(base+"/assay-results/"+record))!.body;
      const revision=(row:typeof result)=>JSON.stringify([row?.id,row?.entryId,row?.modifiedAt,row?.isReviewed,row?.archiveRecord?.reason??!!row?.archiveRecord,row?.creator?.id]);
      if(revision(reread)!==revision(result))throw new CollectionError("TARGET_MISMATCH");
      return observation("benchling-result-review",base+"/assay-results/"+record,[
       check("lab-result","Result is reviewed and active",typeof result.isReviewed==="boolean"?result.isReviewed&&!result.archiveRecord:undefined,"Check the result and any archive decision."),
       check("lab-entry","Linked entry has an accepted review",typeof review?.status==="string"?review.status==="ACCEPTED"&&!entry.archiveRecord:undefined,"Inspect the current notebook decision.",entryId+" · "+(review?.status??"unavailable")),
       check("lab-decision","Latest approval follows the result revision",afterResult,"Review the latest decision and timestamp against the result modification.",decision?decision.id+" · "+decision.action+" · "+decision.createdAt+" · e-signature "+(decision.esigned===true?"recorded":decision.esigned===false?"absent":"unreported"):"No decision confirmed"),
       check("lab-authority","Named independent reviewer approved the linked entry",assigned===false||independent===false?false:assigned===true&&independent===true?(processes.length===1&&stagesReadable&&approvers.size<=1?!!matched:undefined):undefined,"Verify the assigned reviewer, stage and source decision.",reviewer+" · process "+(matched?.id??"unconfirmed"))
      ],"Only the identified result and notebook review are traced. The provider's recorded review is distinct from product or batch release.");
    }
    case "JIRA": {
      const source = "https://api.atlassian.com/ex/jira/" + scope + "/rest/api/3/issue/" + record;
      const issue = (await get(source + "?fields=project,status,resolution,assignee"))!.body;
      if (issue?.key !== record || issue.fields?.project?.key !== record.split("-")[0]) throw new CollectionError("TARGET_MISMATCH");
      const fields = issue.fields;
      const state = fields.status?.statusCategory?.key;
      const done = known(state, ["new", "indeterminate", "done"]) ? state === "done" : undefined;
      return observation("jira-remediation", source, [
        check("issue-owner", "Issue has an assignee", referencePresent(fields.assignee, "accountId"), "Assign or confirm the accountable owner in Jira."),
        check("issue-done", "Workflow has reached Done", done, "Review the current workflow state in Jira.", done === undefined ? undefined : state),
        check("issue-resolution", "A resolution is recorded", referencePresent(fields.resolution, "id"), "Inspect the recorded resolution and verify its effect independently.")
      ], "Only the selected issue is checked. A Done category or resolution can include cancelled or declined work. Effectiveness needs separate evidence.");
    }
    case "SERVICENOW": {
      const origin = "https://" + scope + ".service-now.com";
      const incident = (await get(origin + "/api/now/v1/table/incident/" + record + "?sysparm_fields=sys_id,active,assigned_to,closed_at&sysparm_display_value=false&sysparm_exclude_reference_link=true"))!.body?.result;
      if (incident?.sys_id !== record) throw new CollectionError("TARGET_MISMATCH");
      const active = incident.active;
      const inactive = [true, false, "true", "false"].includes(active) ? active === false || active === "false" : undefined;
      const assigned = typeof incident.assigned_to === "object" && incident.assigned_to !== null ? incident.assigned_to.value : incident.assigned_to;
      const hasOwner = assigned === "" || assigned === null ? false : typeof assigned === "string" && /^[0-9a-f]{32}$/i.test(assigned) ? true : undefined;
      const closed = incident.closed_at;
      const closedAt = typeof closed === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(closed) ? closed.replace(" ", "T") + "Z" : undefined;
      return observation("servicenow-incident", origin + "/incident.do?sys_id=" + record, [
        check("incident-owner", "Incident has an assignee", hasOwner, "Review assignment in the incident record."),
        check("incident-inactive", "Incident is inactive", inactive, "Review the local incident workflow and any reopening."),
        check("incident-closure", "Incident has a closure timestamp", closed === "" || closed === null ? false : validTime(closedAt) ? true : undefined, "Review the incident closure history.", validTime(closedAt) ? closedAt : undefined)
      ], "The instance controls incident states and field visibility. Incident inactivity and a closure date require independent review of remediation.");
    }
    case "AZURE_DEVOPS": {
      const projectId = scope.split("/")[1];
      const base = "https://dev.azure.com/" + scope;
      const build = (await get(base + "/_apis/build/builds/" + record + "?api-version=7.1"))!.body;
      if (!Number.isSafeInteger(build?.id) || String(build.id) !== record || build.project?.id?.toLowerCase?.() !== projectId) throw new CollectionError("TARGET_MISMATCH");
      const revision = typeof build.sourceVersion === "string" && /^[a-f\d]{40}$/i.test(build.sourceVersion) ? build.sourceVersion.toLowerCase() : undefined;
      const finished = build.status === "completed";
      const resultKnown = known(build.result, ["succeeded","failed","partiallySucceeded","canceled"]);
      return observation("azure-devops-build", base + "/_build/results?buildId=" + record, [
        check("build-revision", "Build used the selected Git commit", revision ? revision === reference : undefined, "Check the intended release revision against the build.", revision),
        check("build-result", "Completed build succeeded", finished && resultKnown ? build.result === "succeeded" : undefined, "Inspect the pipeline and test results for this build.", finished && resultKnown ? build.result : undefined)
      ], "One build is matched to one expected Git revision. A successful build alone does not establish test coverage, deployment or release approval.");
    }
    case "CONFLUENCE": {
      const source = "https://api.atlassian.com/ex/confluence/" + scope + "/wiki/api/v2/pages/" + record;
      const page = (await get(source))!.body;
      if (page?.id !== record) throw new CollectionError("TARGET_MISMATCH");
      const rev = page.version?.number;
      return observation("confluence-revision", source, [
        check("page-current", "Page has current publication status", known(page.status, ["current","archived","draft","trashed","deleted","historical"]) ? page.status === "current" : undefined, "Review the page publication state in Confluence."),
        check("page-version", "Page matches the reviewed version", Number.isSafeInteger(rev) && rev > 0 ? String(rev) === reference : undefined, "Review the changed revision before updating the expected version.", Number.isSafeInteger(rev) && rev > 0 ? "Version " + rev : undefined)
      ], "Only page identity, publication status and version are examined. Document content, approval signatures and training completion require separate records.");
    }
    case "SAFETYCULTURE": {
      const source = "https://api.safetyculture.io/audits/" + record;
      const audit = (await get(source))!.body;
      if (audit?.audit_id !== record || audit.template_id !== scope) throw new CollectionError("TARGET_MISMATCH");
      const completed = audit.audit_data?.date_completed;
      return observation("safetyculture-inspection", source, [
        check("inspection-completed", "Inspection has a completion date", completed === null ? false : validTime(completed) ? true : undefined, "Inspect the original checklist and actions.", validTime(completed) ? completed : undefined),
        check("inspection-active", "Inspection is outside the archive", typeof audit.archived === "boolean" ? !audit.archived : undefined, "Confirm whether the inspection was archived or superseded.")
      ], "Reads one SafetyCulture audit using the legacy audit JSON endpoint. Answers, photographs and names are discarded. Inspection completion does not close findings.");
    }
  }
}
