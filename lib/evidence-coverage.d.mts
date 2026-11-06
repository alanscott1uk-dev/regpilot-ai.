export type EvidenceState="evidence-linked"|"attachment-unverified"|"review-expired"|"pending-review"|"missing";
export type CoverageRow={id:string;title:string;owner:string;due:string;status:string;linked:number;verifiedAttachments:number;state:EvidenceState};
export function evidenceCoverage(actions:unknown[],documents:unknown[],today:string):CoverageRow[];
export function evidenceCoverageSummary(rows:CoverageRow[]):Record<string,number>;
