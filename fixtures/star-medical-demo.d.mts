export type PilotAction = {id:string;title:string;owner:string;due:string;done:boolean;category:string};
export const pilot: {organization:string;sector:string;generatedFor:string;disclaimer:string;actions:PilotAction[]};
export function toPrototypeActions(source?:typeof pilot): Array<{id:string;title:string;owner:string;due:string;done:boolean}>;
