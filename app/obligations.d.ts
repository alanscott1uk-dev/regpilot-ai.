declare module "../lib/obligations.mjs" {
  export function validateObligation(value: unknown): boolean;
  export function isOverdue(value: { status: string; due: string }, today: string): boolean;
  export function exportObligationsCsv(items: Array<{ title: string; regulator: string; owner: string; due: string; status: string; notes: string }>): string;
}
