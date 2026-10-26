export type ComplianceModule={id:string;name:string;sectors:string[]};
export const COMPLIANCE_MODULES:readonly ComplianceModule[];
export function recommendedModules(industryId:string):string[];
export function validModules(ids:unknown):boolean;
