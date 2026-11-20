import {z} from 'zod';

export const DOCUMENT_QUESTION_LIMITS={questions:100,candidates:500,questionCharacters:1200,sourceCharacters:6000,selectionBytes:700000} as const;
export const documentSelectionSchema=z.object({
 unit:z.number().int().positive().max(500),start:z.number().int().min(0).max(80000),end:z.number().int().positive().max(80000),
 reference:z.string().trim().min(1).max(100),question:z.string().trim().min(10).max(1200),instructions:z.string().trim().max(4000).optional(),
}).strict().refine(v=>v.end>v.start&&v.end-v.start<=DOCUMENT_QUESTION_LIMITS.sourceCharacters,'Select one bounded source passage');
export const documentSelectionsSchema=z.array(documentSelectionSchema).min(1).max(100).refine(rows=>new Set(rows.map(r=>r.reference)).size===rows.length,'Use distinct question references').refine(rows=>new Set(rows.map(r=>[r.unit,r.start,r.end].join(':'))).size===rows.length,'Select each source passage once');
export type DocumentSelection=z.infer<typeof documentSelectionSchema>;
export type DocumentQuestionCandidate=DocumentSelection&{id:string;quote:string;label:string};
export type DocumentQuestionnaireInspection={
 version:'questionnaire-document-v1';filename:string;format:'PDF'|'DOCX'|'PNG'|'JPEG';sha256:string;extractionVersion:string;unitKind:'page'|'block';
 units:{unit:number;label:string;text:string}[];candidates:DocumentQuestionCandidate[];warnings:string[];blockingIssues:string[];canImport:boolean;candidateLimitReached:boolean;
};
