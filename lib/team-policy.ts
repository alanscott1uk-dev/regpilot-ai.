export type TeamRole="OWNER"|"ADMIN"|"EDITOR"|"VIEWER";
export function mayManageRole(actor:string,target:string,next?:string){
 return actor==="OWNER"&&target!=="OWNER"||actor==="ADMIN"&&["EDITOR","VIEWER"].includes(target)&&(!next||["EDITOR","VIEWER"].includes(next));
}
export const TEAM_LIMITS={members:100,pending:50,dailyInvitations:20,expiryDays:7} as const;
