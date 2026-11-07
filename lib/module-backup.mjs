// Export/import helpers for non-sensitive, browser-only demo records.
// These are not a substitute for authenticated server persistence.
export const MAX_RECORDS = 250;
export function isDemoRecord(x) {
 return x && typeof x==="object" &&
 typeof x.id==="string" && x.id.length>0 && x.id.length<=100 &&
 typeof x.name==="string" && x.name.trim().length>0 && x.name.length<=160 &&
 typeof x.owner==="string" && x.owner.trim().length>0 && x.owner.length<=80 &&
 typeof x.due==="string" && /^\d{4}-\d{2}-\d{2}$/.test(x.due) &&
 !Number.isNaN(Date.parse(x.due+"T00:00:00Z")) &&
 ["Open","In progress","Complete"].includes(x.status) &&
 typeof x.notes==="string" && x.notes.length<=500;
}
export function parseModuleBackup(raw, expectedModuleId) {
 if (typeof raw!=="string" || raw.length>300000) throw new Error("Backup too large");
 const data=JSON.parse(raw);
 if(!data || data.version!==1 || data.moduleId!==expectedModuleId || !Array.isArray(data.records) || data.records.length>MAX_RECORDS)throw new Error("Invalid module backup");
 if(!data.records.every(isDemoRecord))throw new Error("Backup contains invalid records");
 if(new Set(data.records.map(x=>x.id)).size!==data.records.length)throw new Error("Duplicate record IDs");
 return data.records.map(x=>({id:x.id,name:x.name,owner:x.owner,due:x.due,status:x.status,notes:x.notes}));
}
export function createModuleBackup(moduleId,records) {
 if(typeof moduleId!=="string" || !/^[a-z-]{2,40}$/.test(moduleId) || !Array.isArray(records) || records.length>MAX_RECORDS || !records.every(isDemoRecord))throw new Error("Invalid demo records");
 return JSON.stringify({version:1,moduleId,exportedAt:new Date().toISOString(),records},null,2);
}
