import type {RegulatorySource} from "../regulatory-sources.mjs";
export const TERRITORIES=["England","Scotland","Wales","Northern Ireland"] as const;
export const SOURCE_ACTIVITIES={"employing-staff":"Employing people","personal-data":"Personal information","limited-company":"Running a company","consumer-sales":"Selling to consumers","food-business":"Food business","commercial-waste":"Business waste","premises":"Business premises","regulated-medicines":"Medicines manufacturing and wholesale","supply-chain":"Supplier and supply-chain duties","sponsored-workers":"Sponsored workers"} as const;
export type SourceCoverage={sourceId:string;snapshotId:string|null;reviewStatus:string|null;lastCheckedAt:string|null;monitoring:string;schedule?:null|{enabled:boolean;intervalHours:number;failureCode:string|null;nextCheckAt:string;lastSuccessAt:string|null;lastOutcome:string|null;attempts:number;active:boolean}};
export function matchingSources(sources:readonly RegulatorySource[],territory:string,activity:string,query:string){
 const text=query.trim().toLowerCase();
 // Unclassified sources remain visible: missing metadata is never a not-applicable decision.
 return sources.filter(s=>(!territory||!s.jurisdictions?.length||s.jurisdictions.includes(territory))&&(!activity||!s.activities?.length||s.activities.includes(activity))&&(!text||[s.title,s.agency,s.topic].join(" ").toLowerCase().includes(text)));
}
export function sourceNextStep(row?:SourceCoverage){
 if(!row)return "Coverage status unavailable";
 if(!row.snapshotId)return "Capture a first baseline";
 if(row.reviewStatus==="NEEDS_REVIEW")return "Independent source review needed";
 if(row.reviewStatus==="NOT_APPLICABLE")return "Not applicable at last source review";
 return "Source reviewed — assess requirements and mappings";
}
