export type Industry={id:string;name:string;departments:string[]};
export const INDUSTRIES:readonly Industry[];
export function getIndustry(id:string):Industry;
export function validateDepartments(names:unknown):boolean;
