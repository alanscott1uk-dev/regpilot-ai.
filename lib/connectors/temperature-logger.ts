import {booleanCheck} from './bounded-http';
import type {Observation} from './observation';

export function temperatureObservation(input:{
 engine:string; source:string; reference:string; celsius?:number; sampleMs:number;
 limitation:string; certificateHash?:string; temperatureLabel:string
}):Observation{
 const [file,version,from,until,low,high,maxMinutes]=input.reference.split('/');
 const {celsius,sampleMs,certificateHash}=input,now=Date.now();
 const when=Number.isFinite(sampleMs)?new Date(sampleMs).toISOString():undefined;
 const fresh=when?sampleMs<=now&&now-sampleMs<=Number(maxMinutes)*60000:undefined;
 const inRange=celsius===undefined?undefined:celsius>=Number(low)&&celsius<=Number(high);
 const covered=when&&certificateHash?from<=when.slice(0,10)&&when.slice(0,10)<until:undefined;
 const freshness=booleanCheck('logger-fresh','Reading within approved age',fresh,true,'Check connectivity and collection interval.');
 const temperature=booleanCheck('logger-temperature',input.temperatureLabel,inRange,true,'Investigate excursions against the site procedure.');
 const certificate=booleanCheck('logger-calibration','Reviewed certificate and calibration interval cover the reading',covered,true,'Check certificate identity, review revision and calibration dates.');
 return {engine:input.engine,capturedAt:new Date(now).toISOString(),sourceUrl:input.source,limitations:[input.limitation],checks:[
  {...freshness,observed:when??freshness.observed},
  {...temperature,observed:celsius===undefined?temperature.observed:celsius+' °C · limits '+low+' to '+high+' °C'},
  {...certificate,observed:file+' v'+version+' · '+(certificateHash??'certificate unavailable')+' · '+from+' to '+until}
 ]};
}
