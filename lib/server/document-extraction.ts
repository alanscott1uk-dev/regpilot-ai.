import {Worker} from "node:worker_threads";
import path from "node:path";
import {checkDocument,EvidenceError} from "../evidence/file-guard.mjs";
import {extractPdf} from "./pdf-extraction";
import type {ExtractedDocument} from "../documents/coverage";

export async function extractDocument(bytes:Uint8Array,filename:string,options:{allowEmpty?:boolean}={}):Promise<ExtractedDocument>{
  const file=checkDocument(bytes,filename);
  if(file.format==="PDF")return {...await extractPdf(file.bytes,options),format:"PDF",unitKind:"page"};
  const data=Uint8Array.from(file.bytes);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(process.cwd(),"lib/server/docx-extraction-worker.mjs"),{workerData:data,transferList:[data.buffer],resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4},execArgv:[],env:{},stdout:true,stderr:true});
    worker.stdout?.resume();worker.stderr?.resume();let settled=false;
    const done=(error:Error|null,value?:ExtractedDocument)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(value!);};
    const timer=setTimeout(()=>done(new EvidenceError("Word extraction timed out; use a smaller document",422)),8000);
    worker.once("message",message=>{
      if(message?.ok===true&&Array.isArray(message.document?.pages)&&(message.document.characters>0||options.allowEmpty))done(null,message.document);
      else done(new EvidenceError("Word file is unreadable, unsafe, unsupported or exceeds extraction limits. Use a standard .docx without macros, embedded files or external templates.",422));
    });
    worker.once("error",()=>done(new EvidenceError("Word extraction unavailable",422)));
    worker.once("exit",()=>{if(!settled)done(new EvidenceError("Word extraction ended without a usable result",422));});
  });
}
