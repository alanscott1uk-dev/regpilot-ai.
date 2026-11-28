import {z} from 'zod';

const instant=z.iso.datetime();
const reference=z.string().min(1).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
export const loggerWindow=z.object({
  kind:z.literal('LOGGER_WINDOW'), siteRef:reference, sensorRef:reference, calibrationRef:reference,
  calibratedAt:instant, calibrationDue:instant, windowStart:instant, windowEnd:instant,
  unit:z.enum(['CELSIUS','PERCENT_RH']), minimum:z.number().finite(), maximum:z.number().finite(),
  maxGapSeconds:z.number().int().min(1).max(86400), rawFileSha256:z.string().regex(/^[a-f0-9]{64}$/),
  samples:z.array(z.object({at:instant,value:z.number().finite()}).strict()).max(288)
}).strict().superRefine((record,ctx)=>{
  const start=Date.parse(record.windowStart), end=Date.parse(record.windowEnd);
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(start>=end || end-start>7*86400000)issue('Select a positive monitoring window of at most seven days');
  if(record.minimum>=record.maximum || Date.parse(record.calibratedAt)>=Date.parse(record.calibrationDue))issue('Check the operating and calibration limits');
  let previous=-Infinity;
  for(const sample of record.samples){
    const at=Date.parse(sample.at);
    if(at<start || at>end || at<=previous){issue('Samples must be unique, in time order and inside the selected window');break;}
    previous=at;
  }
});
export type LoggerWindow=z.infer<typeof loggerWindow>;

/** Counts samples, not excursion duration. Gaps include both boundaries of the requested window. */
export function assessLoggerWindow(record:LoggerWindow){
  const start=Date.parse(record.windowStart), end=Date.parse(record.windowEnd);
  let previous=start, gaps=0, longestGapMs=0, excursions=0;
  let firstExcursion:string|undefined;
  function measureGap(until:number){
    const gap=until-previous;
    longestGapMs=Math.max(longestGapMs,gap);
    if(gap>record.maxGapSeconds*1000)gaps++;
    previous=until;
  }
  for(const sample of record.samples){
    measureGap(Date.parse(sample.at));
    if(sample.value<record.minimum || sample.value>record.maximum){
      excursions++;
      firstExcursion??=sample.at;
    }
  }
  measureGap(end);
  const calibrationCoversWindow=Date.parse(record.calibratedAt)<=start && end<Date.parse(record.calibrationDue);
  const outcome=excursions?'FAIL':!calibrationCoversWindow || gaps || record.samples.length<2?'UNKNOWN':'PASS';
  return {outcome:outcome as 'PASS'|'UNKNOWN'|'FAIL',samples:record.samples.length,excursions,firstExcursion,gaps,longestGapSeconds:longestGapMs/1000,calibrationCoversWindow};
}

export function describeLoggerWindow(record:LoggerWindow){
  const a=assessLoggerWindow(record);
  return record.siteRef+' / '+record.sensorRef+' · '+a.samples+' samples, '+a.excursions+' outside limits'+
    (a.firstExcursion?' (first at '+a.firstExcursion+')':'')+', '+a.gaps+' gaps over '+record.maxGapSeconds+
    ' s (longest interval '+a.longestGapSeconds+' s). '+(a.calibrationCoversWindow?'Calibration covers the window.':'Check calibration coverage.');
}
