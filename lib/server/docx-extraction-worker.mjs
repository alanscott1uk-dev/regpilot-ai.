import {parentPort,workerData} from "node:worker_threads";
import {parseDocx} from "./docx-parser.mjs";
// Time/memory-bounded thread, not an operating-system security sandbox.
try{parentPort.postMessage({ok:true,document:await parseDocx(workerData)});}
catch{parentPort.postMessage({ok:false});}
