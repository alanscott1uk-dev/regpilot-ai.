import {hourlyTemperature} from './temperature-window';
import {z} from 'zod';

export const temperaturePoint=z.object({
 runId:z.uuid(),resultHash:z.string().regex(/^[a-f0-9]{64}$/),at:z.iso.datetime(),
 celsius:z.number().finite(),status:z.enum(['PASS','FAIL'])
});
export const temperatureHistory=z.object({
 from:z.iso.datetime(),through:z.iso.datetime(),version:z.number().int().positive(),
 limited:z.boolean(),hourlyTemperature:hourlyTemperature.optional(),points:z.array(temperaturePoint).max(101)
}).refine(h=>h.points.length>0||!!h.hourlyTemperature?.hours.length);
export type TemperatureHistory=z.infer<typeof temperatureHistory>;

export function temperatureSummary(history:TemperatureHistory){
 const samples=new Map<string,Set<number>>();
 for(const point of history.points){
  const values=samples.get(point.at)??new Set<number>();
  values.add(point.celsius);
  samples.set(point.at,values);
 }
 const ordered=[...samples.keys()].sort();
 const conflicts=[...samples.values()].filter(values=>values.size>1).length;
 const values=history.points.map(point=>point.celsius);
 const gaps=ordered.slice(1).map((at,index)=>Date.parse(at)-Date.parse(ordered[index]));
 return {samples:samples.size,conflicts,minimum:values.length?Math.min(...values):null,maximum:values.length?Math.max(...values):null,
  largestGapMinutes:gaps.length?Math.max(...gaps)/60000:null};
}

export function temperatureCsv(history:TemperatureHistory){
 const rows=[['Sample UTC','Temperature (C)','Within approved limits','Collection ID','Result SHA-256']];
 for(const point of history.points)rows.push([point.at,String(point.celsius),point.status,point.runId,point.resultHash]);
 return rows.map(row=>row.join(',')).join('\r\n')+'\r\n';
}
