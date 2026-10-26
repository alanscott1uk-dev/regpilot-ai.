export type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
export type Action = "obligation:read" | "obligation:write" | "membership:manage" | "evidence:review";
export const ROLES: readonly Role[];
export const ACTIONS: readonly Action[];
export function can(role: string, action: string): boolean;
