import {z} from 'zod';

export const OCR_LIMITS={fileBytes:3*1024*1024,pages:40,characters:80000,lines:2000,lineCharacters:4000,runs:100,dailyStarts:20,polls:80,reviews:20,requestBytes:900000,leaseMs:45000,pollIntervalMs:5000,operationHours:20} as const;
const cleanText=z.string().refine(value=>value.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value),'OCR text contains unsupported characters');
const sha=z.string().regex(/^[a-f0-9]{64}$/),positive=z.number().int().positive();
export const ocrFormatSchema=z.enum(['PDF','PNG','JPEG']);
export type OcrFormat=z.infer<typeof ocrFormatSchema>;
const polygon=z.array(z.number().finite().min(0)).length(8),span=z.object({offset:z.number().int().min(0).max(OCR_LIMITS.characters),length:positive.max(OCR_LIMITS.lineCharacters)}).strict();
export const ocrLineSchema=z.object({id:z.string().regex(/^p[1-9][0-9]?-l[1-9][0-9]{0,3}$/),text:cleanText.min(1).max(OCR_LIMITS.lineCharacters),polygon,spans:z.array(span).min(1).max(10)}).strict();
export const ocrPageSchema=z.object({page:positive.max(OCR_LIMITS.pages),width:z.number().finite().positive().max(10000),height:z.number().finite().positive().max(10000),unit:z.enum(['pixel','inch']),angle:z.number().finite().min(-180).max(180),lines:z.array(ocrLineSchema).max(OCR_LIMITS.lines)}).strict().superRefine((p,ctx)=>{
 for(const [i,line] of p.lines.entries())if(line.id!==`p${p.page}-l${i+1}`||line.polygon.some((v,n)=>v>(n%2?p.height:p.width)))ctx.addIssue({code:'custom',message:'OCR region lies outside its page'});
});
export const ocrRawResultSchema=z.object({version:z.literal('regpilot-ocr-regions-v1'),engine:z.literal('azure-read-2024-11-30'),stringIndexType:z.literal('utf16CodeUnit'),content:cleanText.min(1).max(OCR_LIMITS.characters),pages:z.array(ocrPageSchema).min(1).max(OCR_LIMITS.pages)}).strict().superRefine((r,ctx)=>{
 let lines=0;const occupied:Array<[number,number]>=[];
 for(const [i,p] of r.pages.entries()){
  if(p.page!==i+1)ctx.addIssue({code:'custom',message:'OCR pages must be complete and ordered'});
  lines+=p.lines.length;
  for(const l of p.lines){let end=-1;for(const s of l.spans){if(s.offset<end||s.offset+s.length>r.content.length)ctx.addIssue({code:'custom',message:'Invalid OCR text span'});end=s.offset+s.length;occupied.push([s.offset,end]);}if(l.spans.map(s=>r.content.slice(s.offset,s.offset+s.length)).join('')!==l.text)ctx.addIssue({code:'custom',message:'OCR text does not match the provider span'});}
 }
 occupied.sort((a,b)=>a[0]-b[0]);if(occupied.some((s,i)=>i>0&&s[0]<occupied[i-1][1]))ctx.addIssue({code:'custom',message:'OCR line spans overlap'});
 if(!lines||lines>OCR_LIMITS.lines)ctx.addIssue({code:'custom',message:'OCR line limit exceeded or no text recognised'});
});
export type OcrRawResult=z.infer<typeof ocrRawResultSchema>;
export const ocrCorrectionSchema=z.array(z.object({id:z.string().min(1).max(32),text:cleanText.min(1).max(OCR_LIMITS.lineCharacters)}).strict()).min(1).max(OCR_LIMITS.lines).refine(v=>new Set(v.map(x=>x.id)).size===v.length,'Each recognised line must appear once');
export const ocrReviewedResultSchema=z.object({version:z.literal('regpilot-ocr-reviewed-v1'),pages:z.array(z.object({page:positive.max(OCR_LIMITS.pages),text:z.string().max(OCR_LIMITS.characters),lines:z.array(z.object({id:z.string(),recognizedText:cleanText.min(1).max(OCR_LIMITS.lineCharacters),text:cleanText.min(1).max(OCR_LIMITS.lineCharacters),start:z.number().int().min(0),end:positive}).strict()).max(OCR_LIMITS.lines)}).strict()).min(1).max(OCR_LIMITS.pages)}).strict();
export type OcrReviewedResult=z.infer<typeof ocrReviewedResultSchema>;
/** Corrections never overwrite machine text, source regions or provider offsets. */
export function reviewOcrText(raw:OcrRawResult,input:unknown):OcrReviewedResult{
 const edits=ocrCorrectionSchema.parse(input),all=raw.pages.flatMap(p=>p.lines),map=new Map(edits.map(l=>[l.id,l.text]));
 if(edits.length!==all.length||all.some(l=>!map.has(l.id)))throw new Error('Review every recognised line exactly once');
 let total=0;
 const pages=raw.pages.map(p=>{let cursor=0;const lines=p.lines.map((l,i)=>{const text=map.get(l.id)!;if(text.includes('\0')||/[\uD800-\uDFFF]/u.test(text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g,'')))throw new Error('Use valid text in OCR corrections');const start=cursor;cursor+=text.length+(i<p.lines.length-1?1:0);return {id:l.id,recognizedText:l.text,text,start,end:start+text.length};});const text=lines.map(l=>l.text).join('\n');total+=text.length;return {page:p.page,text,lines};});
 if(total>OCR_LIMITS.characters)throw new Error('Reviewed OCR text exceeds the character limit');return ocrReviewedResultSchema.parse({version:'regpilot-ocr-reviewed-v1',pages});
}
export const ocrRegionSchema=z.object({lineId:z.string(),recognizedText:cleanText.min(1).max(OCR_LIMITS.lineCharacters),correctedText:cleanText.min(1).max(OCR_LIMITS.lineCharacters),start:z.number().int().min(0),end:positive,polygon,spans:z.array(span).min(1).max(10)}).strict();
export const ocrQuestionSourceSchema=z.object({method:z.literal('OCR'),filename:z.string().min(1).max(180),sha256:sha,format:ocrFormatSchema,unitKind:z.literal('page'),unit:positive.max(OCR_LIMITS.pages),start:z.number().int().min(0).max(OCR_LIMITS.characters),end:positive.max(OCR_LIMITS.characters),quote:z.string().min(10).max(6000),recognizedQuote:z.string().min(1).max(OCR_LIMITS.characters),extractionVersion:z.literal('azure-read-2024-11-30'),unitLabel:z.string().max(240),ocrRunId:z.uuid(),ocrReviewId:z.uuid(),ocrReviewHash:sha,rawHash:sha,pageWidth:z.number().positive().max(10000),pageHeight:z.number().positive().max(10000),pageUnit:z.enum(['pixel','inch']),regions:z.array(ocrRegionSchema).min(1).max(200)}).strict().refine(s=>s.end>s.start&&s.end-s.start===s.quote.length,'OCR quote must match its selected page offsets').refine(source=>new TextEncoder().encode(JSON.stringify(source)).byteLength<=12000,'Select a shorter OCR source passage to keep its exact region provenance within 12,000 bytes');
export type OcrQuestionSource=z.infer<typeof ocrQuestionSourceSchema>;
export function ocrSourceForSelection(source:{id:string;filename:string;sha256:string;format:OcrFormat;rawHash:string},review:{id:string;resultHash:string;result:OcrReviewedResult},raw:OcrRawResult,selection:{unit:number;start:number;end:number}):OcrQuestionSource{
 const page=raw.pages.find(p=>p.page===selection.unit),p=review.result.pages.find(p=>p.page===selection.unit);
 if(!page||!p||selection.start<0||selection.end>p.text.length||selection.end<=selection.start)throw new Error('Select a passage within the reviewed OCR page');
 const lines=p.lines.filter(l=>l.end>selection.start&&l.start<selection.end),regions=lines.map(l=>{const original=page.lines.find(o=>o.id===l.id);if(!original)throw new Error('OCR line provenance is incomplete');return {lineId:l.id,recognizedText:l.recognizedText,correctedText:l.text,start:l.start,end:l.end,polygon:original.polygon,spans:original.spans};});
 return ocrQuestionSourceSchema.parse({method:'OCR',filename:source.filename,sha256:source.sha256,format:source.format,unitKind:'page',unit:selection.unit,start:selection.start,end:selection.end,quote:p.text.slice(selection.start,selection.end),recognizedQuote:lines.map(l=>l.recognizedText).join('\n'),extractionVersion:raw.engine,unitLabel:`Page ${selection.unit} · independently reviewed OCR`,ocrRunId:source.id,ocrReviewId:review.id,ocrReviewHash:review.resultHash,rawHash:source.rawHash,pageWidth:page.width,pageHeight:page.height,pageUnit:page.unit,regions});
}
export const ocrActionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('START'),version:positive,paidConsent:z.literal(true),confirm:z.literal(true)}).strict(),
 z.object({action:z.enum(['POLL','RECOVER']),version:positive}).strict(),
 z.object({action:z.literal('PREPARE_REVIEW'),version:positive,requestKey:z.uuid(),corrections:ocrCorrectionSchema,confirm:z.literal(true)}).strict(),
 z.object({action:z.literal('APPROVE'),version:positive,reviewId:z.uuid(),resultHash:sha,notes:z.string().trim().min(20).max(1600),confirm:z.literal(true)}).strict(),
 z.object({action:z.literal('WITHDRAW'),version:positive,notes:z.string().trim().min(20).max(1600),confirm:z.literal(true)}).strict(),
]);
