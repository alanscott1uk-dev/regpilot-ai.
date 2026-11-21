export function writeOfficeZip(parts: Array<[string,string | Buffer]>): Buffer;
export const QUESTIONNAIRE_FILE_LIMITS:Readonly<{
  fileBytes:number;requestBytes:number;entries:number;entryBytes:number;inflatedBytes:number;
  compressionRatio:number;sheets:number;rows:number;rowNumber:number;columns:number;cells:number;
  cellCharacters:number;characters:number;questions:number;
}>;
export class QuestionnaireWorkbookError extends Error {status:number;constructor(message:string,status?:number);}
export type QuestionnaireWorkbook={
  version:'questionnaire-workbook-v1';filename:string;format:'CSV'|'XLSX';sha256:string;
  sheets:Array<{id:string;name:string;hidden:boolean;rowCount:number;columnCount:number;rows:Array<{number:number;cells:string[];hidden:boolean}>}>;
  warnings:string[];limits:typeof QUESTIONNAIRE_FILE_LIMITS;
};
export type QuestionnaireMapping={
  sheetId:string;headerRow?:number;questionColumn:number;referenceColumn?:number|null;answerColumn?:number|null;
  contextColumns?:number[];firstRow?:number;lastRow?:number;instructions?:string;
};
export type SpreadsheetQuestionnaireSource={
  filename:string;sha256:string;format:'CSV'|'XLSX';sheet:string;row:number;
  questionCell:string;referenceCell?:string;answerCell?:string;contextCells?:string[];
};
export type DocumentQuestionnaireSource={filename:string;sha256:string;format:'PDF'|'DOCX';unitKind:'page'|'block';unit:number;start:number;end:number;quote:string;extractionVersion:string;unitLabel?:string};
export type QuestionnaireSource=SpreadsheetQuestionnaireSource|DocumentQuestionnaireSource|import('../ocr').OcrQuestionSource;
export type OriginalAnswerMapping={sheet:string;productId?:string|null;answerColumn:number};
export type QuestionnaireImportRow={reference:string;question:string;instructions:string;suppliedAnswer:string;source:SpreadsheetQuestionnaireSource};
export type QuestionnaireExport={
  title?:string;recipient?:string;scope?:string;approvedHash?:string|null;approvedAt?:string|Date|null;
  questions:Array<{product?:{id:string;code:string;name:string;version:number}|null;reference:string;question:string;answer:string;instructions?:string;suppliedAnswer?:string;source?:QuestionnaireSource;
    evidence?:Array<{filename:string;sha256:string}>}>;
};
export function inspectQuestionnaireFile(bytes:Uint8Array,filename:string):Promise<QuestionnaireWorkbook>;
export function mapQuestionnaireWorkbook(workbook:QuestionnaireWorkbook,mappings:unknown):QuestionnaireImportRow[];
export function questionnaireColumnLabel(number:number):string;
export function readQuestionnaireForm(request:Request):Promise<FormData>;
export function questionnaireFormFile(form:FormData):File;
export function writeQuestionnaireXlsx(value:QuestionnaireExport):Buffer;
export function writeQuestionnaireCsv(value:QuestionnaireExport):string;

export function writeQuestionnaireOriginalXlsx(bytes:Uint8Array,filename:string,value:QuestionnaireExport,mappings:unknown):Promise<Buffer>;

export const writeOriginalSpreadsheet: typeof writeQuestionnaireOriginalXlsx;
