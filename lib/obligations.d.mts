export function isValidDate(value: unknown): boolean;
export function validateObligation(input: unknown): boolean;
export function isOverdue(item: { status: string; due: string }, today: string): boolean;
export function csvEscape(value: unknown): string;
export function exportObligationsCsv(items: Array<{ title: string; regulator: string; owner: string; due: string; status: string; notes: string }>): string;
