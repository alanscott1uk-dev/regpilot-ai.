import {z} from "zod";
import {readBoundedJson} from "./bounded-http";
import {CollectionError,type ConnectorCheck} from "./github";
import {resilientGet} from "./resilient-http";
import type {Observation} from "./observation";

const origin = "https://api.scorecard.dev";
export const scorecardTarget = z.object({repository:z.string().trim()
  .regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\/[a-z\d_.-]{1,100}$/i)
  .refine(value => ![".",".."].includes(value.split("/")[1]))
  .transform(value => value.toLowerCase()),
  deployedCommit:z.string().regex(/^[a-f\d]{40}$/i).transform(value=>value.toLowerCase()).optional()});
const reportSchema = z.object({
  repo:z.object({name:z.string(),commit:z.string().regex(/^[a-f\d]{40}$/i)}),
  date:z.union([z.iso.datetime({offset:true}),z.iso.date()]),scorecard:z.object({version:z.string().regex(/^v?\d+\.\d+\.\d+(?:[-+][\w.-]{1,40})?$/)}),
  checks:z.array(z.object({name:z.string().max(100),score:z.number().int().min(-1).max(10)})).max(100)
});
const policies = [
  ["Security-Policy","Published security policy"],["Code-Review","Code review"],
  ["Pinned-Dependencies","Pinned dependencies"],["Signed-Releases","Signed releases"]
] as const;

async function publishedReport(read:(url:string)=>Promise<Response>,url:string,repository:string,commit?:string) {
  const response = await read(url);
  if (response.status === 404) { await response.body?.cancel(); return undefined; }
  if (!response.ok) { await response.body?.cancel(); throw new CollectionError("PROVIDER_UNAVAILABLE"); }
  const parsed = reportSchema.safeParse(await readBoundedJson(response,512000));
  if (!parsed.success) throw new CollectionError("INVALID_RESPONSE");
  const report = parsed.data;
  if (report.repo.name.toLowerCase() !== "github.com/"+repository ||
      (commit && report.repo.commit.toLowerCase() !== commit)) throw new CollectionError("TARGET_MISMATCH");
  if (new Set(report.checks.map(check=>check.name)).size !== report.checks.length) throw new CollectionError("INVALID_RESPONSE");
  return report;
}

export async function collectScorecard(input:z.input<typeof scorecardTarget>, fetcher:typeof fetch=fetch, now=Date.now()):Promise<Observation> {
  const {repository,deployedCommit} = scorecardTarget.parse(input);
  const url = origin+"/projects/github.com/"+repository;
  const read = resilientGet(fetcher,origin,{Accept:"application/json"});
  const latest = await publishedReport(read,url,repository);
  const latestCommit = latest?.repo.commit.toLowerCase();
  const report = deployedCommit && deployedCommit !== latestCommit
    ? await publishedReport(read,url+"?commit="+deployedCommit,repository,deployedCommit) : latest;
  const age = report ? now-Date.parse(report.date) : NaN;
  const fresh = age >= -300000 && age <= 14*86400000;
  const checks:ConnectorCheck[] = policies.map(([name,label])=>{
    const score = report?.checks.find(check=>check.name===name)?.score;
    return {id:"scorecard-"+name.toLowerCase(),label:label+" meets the full OpenSSF score",
      status:!fresh || score===undefined || score<0 ? "UNKNOWN" : score===10 ? "PASS" : "FAIL",
      observed:score===undefined || score<0 ? "No conclusive published score" : `${score}/10 published by OpenSSF`,
      nextStep:"Review the published check for the assessed commit and record any supplier exception."};
  });
  checks.unshift({id:"scorecard-freshness",label:"Supplier report published within 14 days",status:fresh?"PASS":"UNKNOWN",
    observed:report?`Published ${report.date} using Scorecard ${report.scorecard.version}`:"No published report for the selected revision or repository",
    nextStep:"Check the supplier’s published report and confirm which revision your organisation uses."});
  if (deployedCommit) checks.unshift({
    id:"scorecard-deployed-revision",label:"Deployed revision has a published assessment",status:report ? "PASS" : "UNKNOWN",
    observed:"Deployed "+deployedCommit+". Latest assessed upstream revision: "+(latestCommit ?? "unavailable")+".",
    nextStep:"Review the deployed revision separately when upstream has moved. Missing revision evidence requires supplier follow-up."
  });
  const revision=deployedCommit??report?.repo.commit;
  return {engine:"openssf-scorecard-1.0.0",sourceUrl:revision ? url+"?commit="+revision : url,
    capturedAt:new Date(now).toISOString(),checks,limitations:[
      "The selected checks assess a public repository at the reported commit. Review whether the deployed component matches this revision.",
      "RegPilot flags scores below 10 for review. An unavailable, inconclusive or stale result cannot establish supplier assurance."
    ]};
}
