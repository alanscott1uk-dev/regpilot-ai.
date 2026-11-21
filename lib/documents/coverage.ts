/** Stored v1 reviews use `page`/`totalPages` as coordinates. For Word these
 * are stable extraction block ordinals, NEVER rendered Word page numbers.
 * Keep the legacy keys readable; all new consumers must use unitKind/label. */
export type DocumentUnit={page:number;text:string;label?:string;kind?:"paragraph"|"table-row";part?:string};
export type ExtractedDocument={version:string;format?:"PDF"|"DOCX";unitKind?:"page"|"block";totalPages:number;pages:DocumentUnit[];characters:number;truncated:boolean;skippedPages:number[];requiresVisualReview:true;blockingIssues?:string[];warnings?:string[]};
export type DocumentCoverage={totalPages:number;extractedPages:number;truncated:boolean;skippedPages:number[];unitKind?:"page"|"block";format?:"PDF"|"DOCX";blockingIssues?:string[]};
export function extractionBlocked(d:Pick<DocumentCoverage,"truncated"|"skippedPages"|"blockingIssues">){return d.truncated||d.skippedPages.length>0||!!d.blockingIssues?.length;}
export function coverageOf(d:ExtractedDocument):DocumentCoverage{return {totalPages:d.totalPages,extractedPages:d.pages.length,truncated:d.truncated,skippedPages:d.skippedPages,unitKind:d.unitKind||"page",format:d.format||"PDF",blockingIssues:d.blockingIssues||[]};}
export function locationLabel(unit:number,kind?:"page"|"block",label?:string){return label||(kind==="block"?"Word block ":"Page ")+unit;}
