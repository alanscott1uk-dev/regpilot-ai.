export type ControlRecord={id:string;title:string;purpose:string;owner:string;status:"Designed"|"In operation"|"Under review"|"Retired";frequency:"Monthly"|"Quarterly"|"Six-monthly"|"Annual"|"Event-triggered";reviewDate:string;actionIds:string[];documentIds:string[]};
export type ControlCoverageRow=ControlRecord&{linkedActions:number;linkedDocuments:number;approvedFileMetadata:number;missingActionLinks:number;missingDocumentLinks:number;state:"retired"|"review-overdue"|"broken-links"|"evidence-unconfirmed"|"metadata-linked"|"needs-review";notes:string[]};
export const CONTROL_KEY:string;
export const CONTROL_STATUSES:readonly string[];
export const CONTROL_FREQUENCIES:readonly string[];
export function validControl(value:unknown):value is ControlRecord;
export function parseControls(raw:string):ControlRecord[];
export function controlCoverage(controls:ControlRecord[],actions:any[],documents:any[],today:string):ControlCoverageRow[];
export function controlSummary(rows:ControlCoverageRow[]):{total:number;active:number;reviewOverdue:number;missingEvidence:number;metadataLinked:number;retired:number};
