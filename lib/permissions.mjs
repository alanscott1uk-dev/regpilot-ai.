export const ROLES = Object.freeze(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
export const ACTIONS = Object.freeze(["obligation:read", "obligation:write", "membership:manage", "evidence:review"]);
const grants = Object.freeze({
  OWNER: ACTIONS,
  ADMIN: ACTIONS,
  EDITOR: ["obligation:read", "obligation:write"],
  VIEWER: ["obligation:read"]
});
export function can(role, action) {
  return typeof role === "string" && typeof action === "string" &&
    Object.prototype.hasOwnProperty.call(grants, role) && grants[role].includes(action);
}
