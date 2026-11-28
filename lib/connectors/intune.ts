import {z} from "zod";
import {CollectionError, type ConnectorCheck} from "./github";
import {GRAPH, verifiedMicrosoftGraph, type MicrosoftTarget} from "./microsoft-graph";
import {readBoundedJson} from "./bounded-http";
import type {Observation} from "./observation";

const path = "/v1.0/deviceManagement/managedDevices";
const fields = "id,isEncrypted,complianceState,lastSyncDateTime";
const syncDate = z.iso.datetime({offset:true});
const week = 7 * 86400000;

function devicePage(value:unknown) {
  if (typeof value !== "string" || value.length > 8192) throw new CollectionError("UNSAFE_PAGINATION");
  let url:URL;
  try { url = new URL(value); } catch { throw new CollectionError("UNSAFE_PAGINATION"); }
  if (url.origin !== GRAPH || url.pathname !== path || url.username || url.password || url.hash ||
      [...url.searchParams.keys()].some(key => !["$select","$skiptoken","$skip","$top"].includes(key)) ||
      url.searchParams.getAll("$select").some(select => select !== fields)) throw new CollectionError("UNSAFE_PAGINATION");
  return url.href;
}

export async function collectIntune(target:MicrosoftTarget, secret:string, fetcher:typeof fetch=fetch, now=Date.now()):Promise<Observation> {
  const get = await verifiedMicrosoftGraph(target,secret,fetcher);
  const ids = new Set<string>(), pages = new Set<string>();
  let next = GRAPH + path + "?$select=" + fields;
  let complete = true, stale = 0, missingSync = 0, plain = 0, encrypted = 0, compliant = 0, noncompliant = 0;
  while (next) {
    if (pages.has(next)) throw new CollectionError("PAGINATION_LOOP");
    if (pages.size >= 10 || ids.size >= 2000) { complete = false; break; }
    pages.add(next);
    const response = await get(next);
    if (!response.ok) {
      await response.body?.cancel();
      throw new CollectionError(response.status === 403 ? "ACCESS_OR_RATE_LIMIT" : "PROVIDER_UNAVAILABLE");
    }
    const page = await readBoundedJson(response,250000);
    if (!Array.isArray(page?.value)) throw new CollectionError("INVALID_RESPONSE");
    for (const device of page.value) {
      if (ids.size >= 2000) { complete = false; break; }
      const id = device?.id;
      if (typeof id !== "string" || !id.trim() || id.length > 128 || ids.has(id.toLowerCase())) throw new CollectionError("INVALID_RESPONSE");
      ids.add(id.toLowerCase());
      const synced = syncDate.safeParse(device.lastSyncDateTime);
      const at = synced.success ? Date.parse(synced.data) : NaN;
      if (!Number.isFinite(at) || at > now + 300000) { missingSync++; continue; }
      if (now - at > week) { stale++; continue; }
      if (device.isEncrypted === true) encrypted++;
      if (device.isEncrypted === false) plain++;
      if (device.complianceState === "compliant") compliant++;
      if (device.complianceState === "noncompliant") noncompliant++;
    }
    next = page["@odata.nextLink"] === undefined ? "" : devicePage(page["@odata.nextLink"]);
  }
  const total = ids.size, current = total - stale - missingSync;
  function coverage(id:string,label:string,positive:number,negative:number,nextStep:string):ConnectorCheck {
    return {id,label,status:negative ? "FAIL" : complete && total > 0 && positive === total ? "PASS" : "UNKNOWN",
      observed:`${positive} confirmed, ${negative} exceptions, ${total-positive-negative} unconfirmed across ${total} managed devices returned`,nextStep};
  }
  return {engine:"microsoft-intune-fleet-1.0.0",sourceUrl:"https://intune.microsoft.com/",capturedAt:new Date(now).toISOString(),
    checks:[
      coverage("intune-encryption","Managed devices report encryption",encrypted,plain,"Review disk encryption on devices with a recent unencrypted report."),
      coverage("intune-compliance","Managed devices report Intune policy compliance",compliant,noncompliant,"Review noncompliant devices and resolve devices without a current policy decision."),
      coverage("intune-sync","Managed devices synced within seven days",current,stale,"Check device enrolment and investigate missed check-ins."),
      {id:"intune-inventory",label:"Managed-device enumeration completed",status:complete && total ? "PASS" : "UNKNOWN",
       observed:`${total} devices over ${pages.size} pages. ${complete ? "End of list reached" : "Collection limit reached"}.`,nextStep:"Reconcile the returned managed-device population with the organisation’s asset register."}
    ],limitations:["Only devices returned by this Intune tenant are covered. Unenrolled devices require separate evidence.",
      "Encryption and policy status use devices seen within seven days. Unknown, future-dated and stale records cannot establish an all-device pass. Device and user identifiers are excluded from saved evidence."]};
}
