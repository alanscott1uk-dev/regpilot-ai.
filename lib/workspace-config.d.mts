export type Workspace={company:string;industry:string;departments:string[];modules:string[]};
export const WORKSPACE_KEY:string;
export function defaultWorkspace(industry?:string):Workspace;
export function parseWorkspace(value:unknown):Workspace|null;
export function moduleHref(id:string):string|null;
