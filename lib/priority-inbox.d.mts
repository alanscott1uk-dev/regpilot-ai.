export type InboxItem = {id:string; kind:string; weight:number; title:string; detail:string; href:string; due:string};
export type InboxResult = {items:InboxItem[];urgent:number;unresolved:number;shownTaskLimit:boolean;generatedAt:string|null};
export type StartStep = {key:string;label:string;detail:string;tab?: "controls"|"programme"|"connections";href?:string};
export declare function priorityInbox(workspace: unknown, today?:string): InboxResult;
export declare function firstRunSteps(workspace: unknown): StartStep[];
