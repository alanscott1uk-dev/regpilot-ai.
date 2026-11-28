import {z} from 'zod';

export const reportedHour=z.object({start:z.iso.datetime(),minimum:z.number().finite(),maximum:z.number().finite(),samples:z.number().int().positive()});
export type ReportedHour=z.infer<typeof reportedHour>;
export const hourlyTemperature=z.object({
 from:z.iso.datetime(),through:z.iso.datetime(),complete:z.boolean(),instrumentSerial:z.string().max(60).optional(),
 hours:z.array(reportedHour).max(24)
});
export type HourlyTemperature=z.infer<typeof hourlyTemperature>;

export function completeLoggerWindow(observation:{engine:string;hourlyTemperature?:HourlyTemperature;checks:readonly {id:string;status:string}[]}){
 if(observation.engine!=='ubibot-temperature-history-1')return true;
 return observation.hourlyTemperature?.complete===true&&
  observation.checks.some(c=>c.id==='logger-hourly-coverage'&&c.status==='PASS')&&
  observation.checks.some(c=>c.id==='logger-hourly-range'&&(c.status==='PASS'||c.status==='FAIL'));
}

export function temperatureWindowCsv(window:HourlyTemperature){
 const rows=[['Hour start UTC','Hour end UTC (exclusive)','Minimum Celsius','Maximum Celsius','Reported samples']];
 for(const h of window.hours)rows.push([h.start,new Date(Date.parse(h.start)+3600000).toISOString(),String(h.minimum),String(h.maximum),String(h.samples)]);
 return rows.map(row=>row.join(',')).join('\r\n')+'\r\n';
}
