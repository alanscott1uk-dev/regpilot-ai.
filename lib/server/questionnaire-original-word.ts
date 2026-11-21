import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {QuestionnaireWorkbookError,type QuestionnaireExport} from './questionnaire-workbook.mjs';

export function completeOriginalWord(bytes:Uint8Array,filename:string,questions:QuestionnaireExport['questions']){
  const data=Uint8Array.from(bytes);
  return new Promise<Buffer>((resolve,reject)=>{
    const worker=new Worker(path.join(process.cwd(),'lib/server/questionnaire-original-worker.mjs'),{
      workerData:{bytes:data,filename,questions},transferList:[data.buffer],
      resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4},execArgv:[],env:{}
    });
    const timeout=setTimeout(()=>{
      reject(new QuestionnaireWorkbookError('The Word original exceeded the processing time limit.'));
      void worker.terminate();
    },8000);
    worker.once('message',message=>{
      clearTimeout(timeout);
      if(message.result instanceof Uint8Array)resolve(Buffer.from(message.result));
      else reject(new QuestionnaireWorkbookError(message.error,message.status));
    });
    worker.once('error',()=>{clearTimeout(timeout);reject(new QuestionnaireWorkbookError('Word processing is unavailable.'));});
    worker.once('exit',()=>{clearTimeout(timeout);reject(new QuestionnaireWorkbookError('The Word original could not be completed.'));});
  });
}
