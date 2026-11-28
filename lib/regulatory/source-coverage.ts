import type {RegulatorySource} from "../regulatory-sources.mjs";
import {matchesPublicationText} from "./publication-query.mjs";
export const TERRITORIES=["England","Scotland","Wales","Northern Ireland"] as const;
export const SOURCE_ACTIVITIES={"employing-staff":"Employing people","personal-data":"Personal information","limited-company":"Running a company","consumer-sales":"Selling to consumers","food-business":"Food business","commercial-waste":"Business waste","premises":"Business premises","medicines":"Medicines manufacturing and wholesale","supply-chain":"Supplier and supply-chain duties","sponsored-workers":"Sponsored workers","medical-devices":"Medical devices","clinical-trials":"Clinical trial sponsors and research","aml-regulated":"Anti-money laundering supervision","packaging":"Packaging producer responsibilities"} as const;
export type MonitoringAttempt={id:string;at:string;action:string;outcome:string|null;failureCode:string|null;attempt:number|null;paused:boolean|null};
export type SourceCoverage={sourceId:string;manualCheck?:{id:string;at:string;by:string}|null;snapshotId:string|null;reviewStatus:string|null;lastCheckedAt:string|null;monitoring:string;reviewHref?:string;schedule?:null|{version?:number;enabled:boolean;intervalHours:number;failureCode:string|null;nextCheckAt:string;lastSuccessAt:string|null;lastOutcome:string|null;attempts:number;active:boolean;state?:string;lastAttemptAt?:string|null;checking?:boolean;recoveryPending?:boolean;retryAvailable?:boolean;retryReason?:string|null;history?:MonitoringAttempt[];historyLimited?:boolean}};
export function matchingSources(sources:readonly RegulatorySource[],territory:string,activity:string,query:string){
 const text=query.trim().toLowerCase();
 // Unclassified sources remain visible: missing metadata is never a not-applicable decision.
 return sources.filter(s=>(!territory||!s.jurisdictions?.length||s.jurisdictions.includes(territory))&&(!activity||!s.activities?.length||s.activities.includes(activity))&&matchesPublicationText([s.title,s.agency,s.topic].join(" "),text));
}
export function sourceNextStep(row?:SourceCoverage){
 if(!row)return "Coverage status unavailable";
 if(row.monitoring==="Manual refresh"&&row.reviewStatus!=="NEEDS_REVIEW")return row.manualCheck?"Manual check recorded":"Open publication for manual check";
 if(!row.snapshotId)return "Capture a first baseline";
 if(row.reviewStatus==="NEEDS_REVIEW")return "Independent source review needed";
 if(row.reviewStatus==="NOT_APPLICABLE")return "Not applicable at last source review";
 return "Source reviewed — assess requirements and mappings";
}
