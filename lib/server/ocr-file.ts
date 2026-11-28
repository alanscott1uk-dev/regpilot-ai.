import {crc32} from 'node:zlib';
import {EvidenceError,evidenceHash,scanWithClamd} from '../evidence/file-guard.mjs';
import {extractPdf} from './pdf-extraction';
import {OCR_LIMITS,type OcrFormat} from '../ocr';

const invalid=()=>new EvidenceError('Use a complete, readable PDF, PNG or JPEG within the OCR limits.',422);
function dimensions(width:number,height:number){if(!Number.isInteger(width)||!Number.isInteger(height)||width<50||height<50||width>10000||height>10000||width*height>40000000)throw new EvidenceError('OCR images must be 50–10,000 pixels on each side and at most 40 megapixels.',422);return {width,height};}
function png(b:Buffer){
 if(!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw invalid();
 let p=8,count=0,meta:{width:number;height:number}|null=null,data=false,end=false;
 while(p<b.length){if(++count>2000||p+12>b.length)throw invalid();const size=b.readUInt32BE(p),type=b.toString('ascii',p+4,p+8),next=p+size+12;if(next>b.length||!/^[a-zA-Z]{4}$/.test(type)||crc32(b.subarray(p+4,next-4))!==b.readUInt32BE(next-4))throw invalid();
  if(count===1){if(type!=='IHDR'||size!==13)throw invalid();meta=dimensions(b.readUInt32BE(p+8),b.readUInt32BE(p+12));const depth=b[p+16],color=b[p+17],valid:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};if(!valid[color]?.includes(depth)||b[p+18]!==0||b[p+19]!==0||b[p+20]>1)throw invalid();}
  else if(type==='IHDR'||['acTL','fcTL','fdAT'].includes(type))throw new EvidenceError('Animated or multi-frame images are not supported for OCR intake.',422);
  if(type==='IDAT')data=true;
  if(type==='IEND'){if(size!==0||next!==b.length)throw invalid();end=true;break;}
  p=next;
 }
 if(!meta||!data||!end)throw invalid();return meta;
}
function jpeg(b:Buffer){
 if(b[0]!==0xff||b[1]!==0xd8||b[b.length-2]!==0xff||b[b.length-1]!==0xd9)throw invalid();
 let p=2,count=0,meta:{width:number;height:number}|null=null,sos=false;
 while(p<b.length-2){if(++count>2000||b[p++]!==0xff)throw invalid();while(b[p]===0xff)p++;const marker=b[p++];if(marker===0xd8||marker===0xd9||marker===0x00||marker===0x01)throw invalid();
  if(p+2>b.length)throw invalid();const length=b.readUInt16BE(p);if(length<2||p+length>b.length-2)throw invalid();
  if([0xc0,0xc1,0xc2].includes(marker)){if(meta||length<8)throw invalid();meta=dimensions(b.readUInt16BE(p+5),b.readUInt16BE(p+3));}
  else if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))throw new EvidenceError('Use a baseline or progressive JPEG for OCR.',422);
  if(marker===0xda){sos=true;break;}p+=length;
 }
 if(!meta||!sos)throw invalid();return meta;
}
export type OcrInspectedFile={filename:string;format:OcrFormat;contentType:string;sha256:string;sizeBytes:number;pageCount:number;sourceMeta:{version:'ocr-upload-v1';width?:number;height?:number}};
export async function inspectOcrFile(bytes:Uint8Array,filename:string):Promise<OcrInspectedFile>{
 if(bytes.byteLength<30||bytes.byteLength>OCR_LIMITS.fileBytes)throw new EvidenceError('Choose an OCR source no larger than 3 MiB.',413);
 if(!/^[^\x00-\x1f\x7f/\\]{1,180}\.(pdf|png|jpe?g)$/i.test(filename)||filename.length>180)throw new EvidenceError('Choose a PDF, PNG or JPEG with a safe filename.',400);
 const b=Buffer.from(bytes),extension=filename.split('.').at(-1)!.toLowerCase(),format:OcrFormat=extension==='pdf'?'PDF':extension==='png'?'PNG':'JPEG';let pageCount=1,meta:{width?:number;height?:number}={};
 if(format==='PDF'){const document=await extractPdf(b,{allowEmpty:true});if(document.truncated||document.totalPages<1||document.totalPages>OCR_LIMITS.pages||document.pages.length!==document.totalPages)throw new EvidenceError('OCR supports complete PDFs of up to 40 pages. Split this source before uploading.',422);pageCount=document.totalPages;}
 else meta=format==='PNG'?png(b):jpeg(b);
 return {filename,format,contentType:format==='PDF'?'application/pdf':format==='PNG'?'image/png':'image/jpeg',sha256:evidenceHash(b),sizeBytes:b.length,pageCount,sourceMeta:{version:'ocr-upload-v1',...meta}};
}
export async function scanOcrFile(bytes:Uint8Array){const port=Number(process.env.REGPILOT_CLAMD_PORT||3310);if(!Number.isInteger(port)||port<1||port>65535)throw new EvidenceError('Invalid scanner configuration',503);return scanWithClamd(bytes,{host:process.env.REGPILOT_CLAMD_HOST||'',port});}
