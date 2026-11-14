export type RequestTicket=Readonly<{scope:string;version:number;signal:AbortSignal}>;
export type RequestScope={capture():RequestTicket;current(ticket:RequestTicket|null|undefined):boolean;invalidate(nextScope?:string):number};
export declare function createRequestScope(initialScope?:string):RequestScope;
