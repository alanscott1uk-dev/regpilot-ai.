export type RegisterAction={id:string;title:string;regulator:string;owner:string;due:string;status:"Open"|"In progress"|"Complete";notes:string};
export const BACKUP_VERSION:number;
export function exportRegisterBackup(items:RegisterAction[]):string;
export function parseRegisterBackup(text:string):RegisterAction[];
