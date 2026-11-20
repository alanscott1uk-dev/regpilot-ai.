import {z} from "zod";

export const distributionActivities=["Procurement","Holding","Supply","Export"] as const;
const activity=z.enum(distributionActivities);
export const annexCodes=["2.6","2.6a","2.6b","3.1.1","3.1.2","3.1.3","3.3"] as const;
export const annexLabels:Record<typeof annexCodes[number],string>={
  "2.6":"Imports from listed countries","2.6a":"Imports certified under Article 51","2.6b":"Imports without Article 51 certification",
  "3.1.1":"Narcotic or psychotropic products","3.1.2":"Medicines derived from blood","3.1.3":"Immunological medicines","3.3":"Cold chain products"
};
const annexEntries=z.array(z.enum(annexCodes)).max(annexCodes.length).refine(v=>new Set(v).size===v.length).optional();
const premises=z.string().trim().min(10).max(450);
const number=z.string().trim().regex(/^\d{1,8}$/);
export const licenceScope=z.object({
  companyNumber:z.string().trim().toUpperCase().regex(/^(?:\d{8}|[A-Z]{2}\d{6})$/),
  number,premises,activity,reviewerId:z.uuid(),requiredAnnexEntries:annexEntries
}).strict();
const source=z.string().trim().max(450).regex(/^https:\/\/cms\.mhra\.gov\.uk\/(?:index\.php\/)?mhra\/wda\/uk-wdah-\d{1,8}(?:-\d+)?\/?$/);
const observed=z.object({
  state:z.enum(["LISTED","SUSPENDED","WITHDRAWN"]),number,source,holder:z.string().trim().min(2).max(250),
  premises,annexEntries,activities:z.array(activity).max(4).refine(v=>new Set(v).size===v.length),
  conditions:z.string().trim().min(4).max(1000),checkedOn:z.iso.date(),reviewBy:z.iso.date(),evidenceId:z.uuid()
}).strict().refine(v=>new URL(v.source).pathname.match(/uk-wdah-(\d+)/)?.[1]===v.number,"The record URL must identify the same authorisation");
export const licenceImport=z.union([observed,z.object({
  state:z.literal("UNAVAILABLE"),source:z.literal("https://cms.mhra.gov.uk/mhra").or(source),
  checkedOn:z.iso.date(),reason:z.string().trim().min(12).max(1000)
}).strict()]);
export type LicenceScope=z.infer<typeof licenceScope>;
export type LicenceRecord=z.infer<typeof licenceImport>;
export const identityReceipt=z.object({provider:z.enum(["COMPANIES_HOUSE","GLEIF"]),connectorId:z.uuid(),configVersion:z.number().int().positive(),runId:z.uuid(),signalHash:z.string().length(64),sourceUrl:z.url(),capturedAt:z.iso.datetime()});
export const savedLicence=z.object({identities:z.array(identityReceipt).max(2).default([]),record:licenceImport,importedBy:z.uuid(),importedAt:z.iso.datetime(),fileHash:z.string().regex(/^[0-9a-f]{64}$/).nullable(),fileVersion:z.number().int().positive().nullable()});
export type SavedLicence=z.infer<typeof savedLicence>;
const normalise=(s:string)=>s.normalize("NFKC").toLowerCase().replace(/[.,]/g," ").replace(/\s+/g," ").trim();

export function compareLicence(scope:LicenceScope,record:LicenceRecord|null,identity:{companyNumber:string;name:string}|null,today:string){
  const reasons:string[]=[];
  if(!identity||identity.companyNumber!==scope.companyNumber)reasons.push("A current company-register identity for the expected company number is required.");
  if(!record)return [...reasons,"Import the MHRA record for the expected premises."];
  if(record.state==="UNAVAILABLE")return [...reasons,"The reviewer could not retrieve the MHRA record."];
  if(record.state!=="LISTED")reasons.push("The recorded authorisation is "+record.state.toLowerCase()+".");
  if(record.number!==scope.number)reasons.push("The authorisation number differs from the expected number.");
  if(identity&&normalise(record.holder)!==normalise(identity.name))reasons.push("The holder differs from the registered legal name.");
  if(normalise(record.premises)!==normalise(scope.premises))reasons.push("The recorded premises differ from the expected site.");
  if(!record.activities.includes(scope.activity))reasons.push("The site annex does not list the required activity.");
  for(const code of scope.requiredAnnexEntries||[]){
    if(!record.annexEntries?.includes(code))reasons.push("The site record needs evidence for annex entry "+code+" ("+annexLabels[code]+").");
  }
  if(record.checkedOn>today||record.reviewBy<today)reasons.push("The register evidence is outside its review period.");
  return reasons;
}
