// Run: node logger-csv.mjs readings.csv logger-window-config.json > envelope.json
// Check the saved envelope before submitting it with partner-connector.mjs.
// CSV format: UTF-8, timestamp,value header, ISO timestamps with explicit time zone and decimal numbers.
// Normalise a vendor export to these columns without rounding, converting units or dropping missing periods.
import {createHash,randomUUID} from 'node:crypto';
import {open,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const maxBytes=131072;
function timestamp(text) {
  const match=/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/.exec(text);
  if(!match || !Number.isFinite(Date.parse(text)))throw Error('Use a valid ISO timestamp with Z or a numeric offset');
  const wall=match[1]+'T'+match[2]+(match[3]||'')+'Z';
  if(new Date(wall).toISOString().slice(0,19)!==wall.slice(0,19))throw Error('Invalid calendar date or time');
  return new Date(text).toISOString();
}
export function loggerEnvelope(bytes,config) {
  if(bytes.length>maxBytes)throw Error('CSV exceeds the 128 KiB import limit');
  const csv=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const lines=csv.trimEnd().split(/\r?\n/);
  if(lines.shift()?.trim()!=='timestamp,value')throw Error('Expected the header timestamp,value');
  if(lines.length>288)throw Error('Prepare a window of at most 288 readings');
  const {siteRef,sensorRef,calibrationRef,unit,minimum,maximum,maxGapSeconds,controlId,recordId,revision,previousHash,sourceSystem,sourceVersion,decisionOwnerRef,sourceUrl}=config;
  const windowStart=timestamp(config.windowStart),windowEnd=timestamp(config.windowEnd),calibratedAt=timestamp(config.calibratedAt),calibrationDue=timestamp(config.calibrationDue);
  if(windowStart>=windowEnd || Date.parse(windowEnd)-Date.parse(windowStart)>7*86400000 || calibratedAt>=calibrationDue)throw Error('Check monitoring and calibration dates');
  if(![minimum,maximum].every(Number.isFinite)||minimum>=maximum||!Number.isInteger(maxGapSeconds)||maxGapSeconds<1||maxGapSeconds>86400)throw Error('Check limits and maximum gap');
  if(!['CELSIUS','PERCENT_RH'].includes(unit))throw Error('Select the unit used in the source file');
  let previous='';
  const samples=lines.map((line,i)=>{
    const cells=line.split(',').map(s=>s.trim());
    if(cells.length!==2||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(cells[1])||!Number.isFinite(Number(cells[1])))throw Error('Invalid numeric reading on row '+(i+2));
    const at=timestamp(cells[0]);
    if(at<=previous||at<windowStart||at>windowEnd)throw Error('Check timestamp order and window bounds on row '+(i+2));
    previous=at;return {at,value:Number(cells[1])};
  });
  const record={kind:'LOGGER_WINDOW',siteRef,sensorRef,calibrationRef,calibratedAt,calibrationDue,windowStart,windowEnd,unit,minimum,maximum,maxGapSeconds,rawFileSha256:createHash('sha256').update(bytes).digest('hex'),samples};
  return {requestKey:randomUUID(),observation:{controlId,externalId:recordId+'-r'+revision,observedAt:windowEnd,validUntil:timestamp(config.validUntil),
    summary:'Logger CSV submitted for independent review of readings, calibration and coverage.',
    checks:[{key:'logger-export',label:'CSV export received',status:'PASS',observed:samples.length+' rows'}],
    partnerRecord:{schemaVersion:1,recordId,revision,previousHash,sourceSystem,sourceVersion,sourceUrl,decisionOwnerRef,state:'CURRENT',record}}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const file=await open(process.argv[2],'r');
    try{
      const buffer=Buffer.alloc(maxBytes+1);
      let size=0;
      while(size<buffer.length){const {bytesRead}=await file.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;}
      if(size>maxBytes)throw Error('CSV exceeds the 128 KiB import limit');
      const config=JSON.parse(await readFile(process.argv[3],'utf8'));
      console.log(JSON.stringify(loggerEnvelope(buffer.subarray(0,size),config),null,2));
    }finally{await file.close();}
  }catch(error){console.error(error.message);process.exitCode=1;}
}
