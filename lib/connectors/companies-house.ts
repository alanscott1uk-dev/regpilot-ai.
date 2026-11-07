import {z} from "zod";
import {CollectionError} from "./github";
import type {Observation} from "./observation";
import {providerReader,validCredential,booleanCheck} from "./bounded-http";
export const companiesHouseTarget=z.object({companyNumber:z.string().regex(/^(?:\d{8}|[A-Z]{2}\d{6})$/)});
export async function collectCompaniesHouse(target:z.infer<typeof companiesHouseTarget>,token:string,fetcher:typeof fetch=fetch):Promise<Observation>{
 const parsed=companiesHouseTarget.safeParse(target);if(!parsed.success||!validCredential(token)||token.includes(":"))throw new CollectionError("INVALID_TARGET");const t=parsed.data,get=providerReader(fetcher,{Authorization:"Basic "+Buffer.from(token+":").toString("base64")}),p=(await get("https://api.company-information.service.gov.uk/company/"+t.companyNumber))!.body;
 if(!p||p.company_number!==t.companyNumber||typeof p.company_name!=="string"||!p.company_name.trim()||p.company_name.length>300)throw new CollectionError("TARGET_MISMATCH");
 const statuses=["active","dissolved","liquidation","receivership","administration","voluntary-arrangement","converted-closed","insolvency-proceedings","registered","removed","closed","open"],status=typeof p.company_status==="string"&&statuses.includes(p.company_status)?p.company_status:null;
 const detail=typeof p.company_status_detail==="string"&&p.company_status_detail.length<=100?p.company_status_detail:null;
 return {engine:"companies-house-profile-1.0.0",sourceUrl:"https://find-and-update.company-information.service.gov.uk/company/"+t.companyNumber,capturedAt:new Date().toISOString(),checks:[
  {id:"registered-name",label:"Registered company name",status:"PASS",observed:p.company_name,nextStep:"Confirm the company number and registered name match the supplier's legal entity; a name alone is not sufficient."},
  {id:"company-status",label:"Register reports active company status",status:status===null?"UNKNOWN":status==="active"?"PASS":"FAIL",observed:status||"Not established",nextStep:"Review the register and supplier context. A non-active status requires investigation, not an automatic credit or legal conclusion."},
  {id:"status-detail",label:"Additional status warning returned",status:detail?"FAIL":p.company_status_detail==null?"PASS":"UNKNOWN",observed:detail||"No additional detail reported",nextStep:"Inspect any status detail in the official register and decide proportionate follow-up."},
  booleanCheck("accounts-overdue","Next accounts are not reported overdue",p.accounts?.next_accounts?.overdue,false,"Check the filing record and any exemptions with the supplier; missing fields are not a pass."),
  booleanCheck("confirmation-overdue","Confirmation statement is not reported overdue",p.confirmation_statement?.overdue,false,"Confirm the filing position and relevant entity requirements."),
  booleanCheck("insolvency-history","No insolvency history reported",p.has_insolvency_history,false,"Inspect the reported history and current position before drawing conclusions.")
 ],limitations:["Public register observation for the exact company number, not a credit score, sanctions search, beneficial-ownership check or prediction of supplier failure.","No officers, personal addresses, filing documents or raw response are retained. An active company or absence of a reported warning does not establish trustworthiness.","The register can be delayed or incomplete. Optional missing fields remain unknown; statutory deadlines are not inferred. Human supplier review remains required."]};
}
