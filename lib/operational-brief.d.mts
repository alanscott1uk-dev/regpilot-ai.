export type BriefChange={id:string;sourceId:string;title:string;sourceUrl:string;detectedAt:string;status:string;summary:string;href:string};
export type BriefPending={id:string;sourceId:string;title:string;checkedAt:string;href:string};
export type BriefCollection={sourceId:string;title:string;status:string;failureCode:string|null;lastSuccessAt:string|null;href:string};
export type BriefConnector={id:string;provider:string;target:string;status:string;lastSuccessAt:string|null;href:string};
export type BriefTask={id:string;title:string;owner:string;dueDate:string;overdue:boolean;status:string;href:string};
export type ComplianceBrief={format:string;generatedAt:string;windowStart:string;windowEnd:string;summary:{changedPublications:number;awaitingReview:number;sourceCheckIssues:number;connectorIssues:number;dueWork:number;overdueWork:number};changes:BriefChange[];pending:BriefPending[];collections:BriefCollection[];connectors:BriefConnector[];tasks:BriefTask[];limitations:string[]};
export declare function prepareComplianceBrief(inputs:unknown,now?:string):ComplianceBrief;
export declare function exportBriefCsv(brief:ComplianceBrief):string;
