import {parentPort,workerData} from 'node:worker_threads';
import {writeOriginalDocx} from './questionnaire-original-docx.mjs';
import {QuestionnaireWorkbookError} from './questionnaire-workbook.mjs';
try{
  const {bytes,filename,questions}=workerData;
  const result=Uint8Array.from(await writeOriginalDocx(bytes,filename,questions));
  parentPort.postMessage({result},[result.buffer]);
}catch(error){
  const known=error instanceof QuestionnaireWorkbookError;
  parentPort.postMessage({error:known?error.message:'The Word original could not be verified. Use a clean, editable document.',status:known?error.status:422});
}
