import {Worker} from "node:worker_threads";
import path from "node:path";
import {checkPdf,EvidenceError} from "../evidence/file-guard.mjs";
export type ExtractedPdf={version:string;totalPages:number;pages:{page:number;text:string}[];characters:number;truncated:boolean;skippedPages:number[];requiresVisualReview:true};
export async function extractPdf(bytes:Uint8Array,options:{allowEmpty?:boolean}={}):Promise<ExtractedPdf>{
  const data=Uint8Array.from(checkPdf(bytes,"evidence.pdf"));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(process.cwd(),"lib/server/pdf-extraction-worker.mjs"),{workerData:data,transferList:[data.buffer],resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32,stackSizeMb:4},execArgv:[],env:{},stdout:true,stderr:true});
    // Drop parser diagnostics: documents and paths must not leak into application logs.
    worker.stdout?.resume();worker.stderr?.resume();let settled=false;
    const done=(error:Error|null,value?:ExtractedPdf)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(value!);};
    const timer=setTimeout(()=>done(new EvidenceError("PDF extraction timed out; use a smaller document",422)),8000);
    worker.once("message",message=>{
      if(message?.ok===true&&(message.document?.characters>0||options.allowEmpty===true)&&Array.isArray(message.document.pages))done(null,message.document);
      else done(new EvidenceError(message?.code==="PASSWORD_REQUIRED"?"Password-protected PDFs require an unlocked copy":"PDF has no readable text or could not be parsed; provide a text-based copy or review it manually",422));
    });
    worker.once("error",()=>done(new EvidenceError("PDF extraction unavailable",422)));
    worker.once("exit",()=>{if(!settled)done(new EvidenceError("PDF extraction ended without a usable result",422));});
  });
}
