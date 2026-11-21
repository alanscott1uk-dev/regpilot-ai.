export function canonicalSourceText(value:unknown):string;
export function sourceTextHash(value:string):string;
export function compareSourceText(before:string,after:string):{state:"BASELINE"|"UNCHANGED"|"CONTENT_CHANGED";added:string[];removed:string[];changed:boolean};
export function publicSnapshot(record:any):Record<string,any>;
