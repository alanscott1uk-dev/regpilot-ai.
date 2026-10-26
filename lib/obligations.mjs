// Pure demo-domain helpers. No database access or regulatory determinations.
export const STATUSES = Object.freeze(["Open", "In progress", "Complete"]);

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateObligation(input) {
  if (!input || typeof input !== "object") return false;
  return typeof input.id === "string" && input.id.length > 0 &&
    typeof input.title === "string" && input.title.trim().length > 0 && input.title.length <= 160 &&
    typeof input.owner === "string" && input.owner.trim().length > 0 && input.owner.length <= 80 &&
    typeof input.regulator === "string" && input.regulator.length <= 80 &&
    typeof input.notes === "string" && input.notes.length <= 500 &&
    isValidDate(input.due) && STATUSES.includes(input.status);
}

export function isOverdue(item, today) {
  return item.status !== "Complete" && isValidDate(item.due) && isValidDate(today) && item.due < today;
}

export function csvEscape(value) {
  const text = String(value ?? "");
  // Guard against formula execution in spreadsheet software.
  const safe = /^[\s]*[=+@\-\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function exportObligationsCsv(items) {
  const header = ["Title", "Regulator / category", "Owner", "Due date", "Status", "Notes"];
  const rows = items.map(item => [item.title, item.regulator, item.owner, item.due, item.status, item.notes]);
  return [header, ...rows].map(row => row.map(csvEscape).join(",")).join("\r\n");
}
