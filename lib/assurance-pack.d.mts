export type AssuranceFinding={key:string;group:string;kind:string;title:string;detail:string;href:string;severity:"follow-up"|"review"|"organise"};
export type AssuranceSnapshot={format:"regpilot-assurance-demo";version:number;company:string;reviewDate:string;generatedAt:string;sourceCoverage:string;summary:{actions:number;documents:number;controls:number;sourceDecisions:number;sourceChecksAvailable:number;findings:number;followUp:number;review:number;organise:number;overdueActions:number;completionExceptions:number;confirmedAttachmentMetadata:number;coveragePercent:number|null;unlinkedDocuments:number};actions:Array<Record<string,any>>;documents:Array<Record<string,any>>;controls:Array<Record<string,any>>;sourceDecisions:Array<Record<string,any>>;activity:Array<Record<string,string>>;findings:AssuranceFinding[]};
export const ASSURANCE_PACK_VERSION:number;
export function assembleAssurance(input:{company?:string;actions?:any[];documents?:any[];controls?:any[];reviews?:any[];sources?:any[];events?:any[]},today:string):AssuranceSnapshot;
export function serializeAssurance(snapshot:AssuranceSnapshot):string;
export function printableAssurance(snapshot:AssuranceSnapshot):string;
