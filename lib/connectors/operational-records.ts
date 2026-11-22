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
export const recordTargets = {
  JIRA: z.object({scope: guid, record: z.string().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}-[1-9]\d{0,10}$/)}),
  SERVICENOW: z.object({scope: slug, record: z.string().toLowerCase().regex(/^[a-f0-9]{32}$/)}),
  AZURE_DEVOPS: z.object({scope: azureScope, record: number, reference: z.string().toLowerCase().regex(/^[0-9a-f]{40}$/)}),
  CONFLUENCE: z.object({scope: guid, record: number, reference: number}),
  SAFETYCULTURE: z.object({scope: z.string().regex(/^template_[a-zA-Z0-9]{1,64}$/), record: z.string().regex(/^audit_[a-zA-Z0-9]{1,64}$/)})
} as const;

type Target = {scope: string; record: string; reference?: string};
export function recordKeys(provider: RecordProvider, target: Target) {
  return {repository: [provider.toLowerCase(), target.scope, target.record].join(":"), branch: target.reference ?? "record"};
}
export function readRecordKeys(provider: RecordProvider, repository: string, branch: string): Target {
  const [prefix, scope, record, ...extra] = repository.split(":");
  if (prefix !== provider.toLowerCase() || extra.length) throw new CollectionError("INVALID_TARGET");
  const result = recordTargets[provider].strict().safeParse({scope, record, ...(branch === "record" ? {} : {reference: branch})});
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

export async function collectOperationalRecord(provider: RecordProvider, target: Target, token: string, fetcher: typeof fetch = fetch): Promise<Observation> {
  const parsed = recordTargets[provider].strict().safeParse(target);
  if (!parsed.success || !validCredential(token)) throw new CollectionError("INVALID_TARGET");
  const {scope, record, reference} = parsed.data as Target;
  const auth = provider === "AZURE_DEVOPS" ? "Basic " + Buffer.from(":" + token).toString("base64") : "Bearer " + token;
  const get = providerReader(fetcher, {Authorization: auth});

  switch (provider) {
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
