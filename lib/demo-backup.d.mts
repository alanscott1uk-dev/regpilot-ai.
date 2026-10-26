export type DemoAction = { id: string; title: string; owner: string; due: string; done: boolean };
export function parseDemoBackup(text: string): DemoAction[];
