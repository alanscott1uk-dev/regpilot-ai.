export type TickPart={state:"disabled"|"completed"|"failed"|"attention"|"backlog";processed:number;outcomeCount?:number;attention:number};
export declare function validCronSecret(header:unknown,secret:unknown):boolean;
export declare function executeScheduledTick(work:{sources?:()=>Promise<{processed:number;outcomes?:unknown[]}>;connectors?:()=>Promise<{processed:number;outcomes?:unknown[]}>;controlReviews?:()=>Promise<{processed:number;attention?:number}>;}):Promise<{ok:boolean;modules:{sources:TickPart;connectors:TickPart;controlReviews:TickPart}}>;
