import { isValidDate } from "./obligations.mjs";
export function parseDemoBackup(text) {
  if (typeof text !== "string" || text.length > 2_000_000) throw new Error("Backup exceeds allowed size");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("Invalid JSON backup"); }
  if (!Array.isArray(parsed) || parsed.length > 1000) throw new Error("Expected a list of up to 1000 actions");
  const ids = new Set();
  return parsed.map(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) ||
      ids.has(item.id) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 ||
      typeof item.owner !== "string" || !item.owner.trim() || item.owner.length > 80 ||
      !isValidDate(item.due) || typeof item.done !== "boolean") {
      throw new Error("Backup contains an invalid or duplicate action");
    }
    ids.add(item.id);
    return { id: item.id, title: item.title, owner: item.owner, due: item.due, done: item.done };
  });
}
