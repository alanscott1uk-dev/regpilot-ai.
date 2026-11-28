import {z} from 'zod';
import {booleanCheck,providerReader} from './bounded-http';
import {CollectionError} from './collection-error';
import {atStep} from './collection-step';
import type {Observation} from './observation';

export const prometheusTarget=z.object({
 scope:z.string().max(100).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/).refine(host=>host===process.env.REGPILOT_PROMETHEUS_HOST),
 record:z.string().max(80).regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/),
 reference:z.string().max(100).regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
});

export async function collectPrometheus(target:z.infer<typeof prometheusTarget>,credential:string,fetcher:typeof fetch):Promise<Observation>{
 const {scope,record,reference}=prometheusTarget.parse(target);
 if(!/^[^:\s]+:.+$/.test(credential))throw new CollectionError('INVALID_TARGET',undefined,'prometheus-rule');
 const query=new URLSearchParams({type:'alert','rule_group[]':record,'rule_name[]':reference,exclude_alerts:'true'});
 const sourceUrl='https://'+scope+'/api/v1/rules?'+query;
 const get=providerReader(fetcher,{Authorization:'Basic '+Buffer.from(credential,'utf8').toString('base64')});
 const body=(await atStep('prometheus-rule',()=>get(sourceUrl)))!.body;
 if(body?.status!=='success'||!Array.isArray(body.data?.groups)||body.data.groupNextToken||body.warnings?.length)
  throw new CollectionError('INVALID_RESPONSE',undefined,'prometheus-rule');
 const [group]=body.data.groups;
 const rules=group?.rules;
 if(body.data.groups.length!==1||group?.name!==record||!Array.isArray(rules)||rules.length!==1||rules[0]?.name!==reference||rules[0].type!=='alerting')
  throw new CollectionError('TARGET_MISMATCH',undefined,'prometheus-rule');
 const rule=rules[0],now=Date.now(),evaluation=Date.parse(rule.lastEvaluation);
 const health=['ok','err','unknown'].includes(rule.health)?rule.health:undefined;
 const state=['inactive','pending','firing'].includes(rule.state)?rule.state:undefined;
 const interval=group.interval;
 const fresh=Number.isFinite(evaluation)&&evaluation>0&&Number.isFinite(interval)&&interval>0?
  evaluation<=now&&now-evaluation<=interval*2000+1000:undefined;
 return {engine:'prometheus-alert-rule-1',sourceUrl,capturedAt:new Date(now).toISOString(),checks:[
  booleanCheck('rule-health','Rule evaluated successfully',health&&health!=='unknown'?health==='ok':undefined,true,'Inspect the rule evaluation in Prometheus.'),
  booleanCheck('rule-fresh','Rule evaluated within two group intervals',fresh,true,'Check the rule group interval and last evaluation.'),
  {...booleanCheck('alert-clear','Alert is inactive',state?state==='inactive':undefined,true,'Review the pending or firing alert in Prometheus.'),observed:state??'Unknown'}
 ],limitations:['One alert rule at collection time. Alert instances, labels, expressions and provider error text are excluded.']};
}
