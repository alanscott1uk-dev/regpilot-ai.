import { validateObligation } from "./obligations.mjs";
export const BACKUP_VERSION = 1;
export function exportRegisterBackup(items) {
  if (!Array.isArray(items) || items.length > 1000 || !items.every(validateObligation)) throw new Error("Invalid register");
  return JSON.stringify({ format:"regpilot-register", version:BACKUP_VERSION, exportedAt:new Date().toISOString(), items }, null, 2);
}
export function parseRegisterBackup(text) {
  if (typeof text !== "string" || text.length > 2_000_000) throw new Error("Backup is too large");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Invalid JSON file"); }
  if (!data || data.format !== "regpilot-register" || data.version !== BACKUP_VERSION || !Array.isArray(data.items) || data.items.length > 1000) throw new Error("Unsupported backup format");
  const ids = new Set();
  const items = data.items.map(item => {
    if (!validateObligation(item) || item.id.length > 80 || ids.has(item.id)) throw new Error("Invalid or duplicate action");
    ids.add(item.id);
    return {id:item.id,title:item.title,regulator:item.regulator,owner:item.owner,due:item.due,status:item.status,notes:item.notes};
  });
  return items;
}
