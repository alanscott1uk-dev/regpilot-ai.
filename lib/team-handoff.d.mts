export type TeamHandoff={organizationId:string;invitationId:string;taskId:string;error:string};
export function teamHandoff(search?:string):TeamHandoff;
export function teamInvitationHref(organizationId:string,invitationId:string,taskId?:string):string|null;
