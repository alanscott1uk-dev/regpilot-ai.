import {observationSchema,observationOutcome} from '../connectors/observation';
import {hashValue} from '../regulatory/intelligence';
/** A content hash alone cannot establish the shape or meaning of stored evidence. */
export function verifiedObservation(run:{result:unknown;resultHash:string;signalHash:string;outcome:string}|null|undefined){
 if(!run||hashValue(run.result)!==run.resultHash)return null;
 const parsed=observationSchema.safeParse(run.result);
 if(!parsed.success||hashValue({engine:parsed.data.engine,checks:parsed.data.checks})!==run.signalHash||observationOutcome(parsed.data)!==run.outcome)return null;
 return parsed.data;
}
