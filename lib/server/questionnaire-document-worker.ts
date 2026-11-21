import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {QuestionnaireWorkbookError,type QuestionnaireExport} from './questionnaire-workbook.mjs';

export type PdfAnswerField={name:string;page:number;multiline:boolean;maxLength:number|null};
export type PdfResponse={id:string;page:number;answer:string};
type Job=
 | {mode:'word';filename:string;questions:QuestionnaireExport['questions']}
 | {mode:'inspect';questions:PdfResponse[];mappings:null}
 | {mode:'pdf';questions:PdfResponse[];mappings:unknown};

export function originalDocumentJob(bytes:Uint8Array,job:Extract<Job,{mode:'inspect'}>):Promise<PdfAnswerField[]>;
export function originalDocumentJob(bytes:Uint8Array,job:Exclude<Job,{mode:'inspect'}>):Promise<Buffer>;
export function originalDocumentJob(bytes:Uint8Array,job:Job):Promise<Buffer|PdfAnswerField[]>{
  const data=Uint8Array.from(bytes);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(process.cwd(),'lib/server/questionnaire-original-worker.mjs'),{
      workerData:{...job,bytes:data},transferList:[data.buffer],
      resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4},execArgv:[],env:{},stdout:true,stderr:true
    });
    worker.stdout?.resume();worker.stderr?.resume();
    const timeout=setTimeout(()=>{
      reject(new QuestionnaireWorkbookError('The original exceeded the processing time limit.'));
      void worker.terminate();
    },8000);
    worker.once('message',message=>{
      clearTimeout(timeout);
      if(job.mode==='inspect'&&Array.isArray(message.fields))resolve(message.fields);
      else if(job.mode!=='inspect'&&message.result instanceof Uint8Array)resolve(Buffer.from(message.result));
      else reject(new QuestionnaireWorkbookError(message.error,message.status));
    });
    worker.once('error',()=>{clearTimeout(timeout);reject(new QuestionnaireWorkbookError('Document processing is unavailable.'));});
    worker.once('exit',()=>{clearTimeout(timeout);reject(new QuestionnaireWorkbookError('The original could not be processed.'));});
  });
}
