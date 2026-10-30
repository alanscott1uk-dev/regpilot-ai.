import { validModules } from "./compliance-modules.mjs";
import { validateModuleDetails } from "./module-fields.mjs";
import { isIsoDate } from "./action-priority.mjs";

export function validateModuleRecordInput(value) {
 if (!value || typeof value !== "object" || Array.isArray(value)) return {ok:false,error:"Invalid record"};
 const {moduleId,title,ownerName,dueDate,status,notes,details}=value;
 if (!validModules([moduleId])) return {ok:false,error:"Unknown module"};
 if (typeof title!=="string" || !title.trim() || title.length>160) return {ok:false,error:"Invalid title"};
 if (typeof ownerName!=="string" || !ownerName.trim() || ownerName.length>80) return {ok:false,error:"Invalid owner"};
 if (!isIsoDate(dueDate)) return {ok:false,error:"Invalid review date"};
 if (!["OPEN","IN_PROGRESS","COMPLETE"].includes(status)) return {ok:false,error:"Invalid status"};
 if (typeof notes!=="string" || notes.length>500) return {ok:false,error:"Invalid notes"};
 if (!validateModuleDetails(moduleId,details)) return {ok:false,error:"Invalid module details"};
 return {ok:true,value:{moduleId,title:title.trim(),ownerName:ownerName.trim(),dueDate,status,notes,details}};
}
export function canEditModuleRecord(role) {
 return ["OWNER","ADMIN","EDITOR"].includes(role);
}
export function canDeleteModuleRecord(role) {
 return ["OWNER","ADMIN"].includes(role);
}
