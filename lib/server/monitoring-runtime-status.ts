import {db} from './db';

/** Runtime configuration is distinct from a successful collection or a healthy worker heartbeat. */
export const monitoringRuntimeActive=()=>process.env.REGPILOT_MONITORING_ENABLED==='true'&&process.env.REGPILOT_AUTOMATION_ENABLED==='true'&&(process.env.REGPILOT_CRON_ENABLED==='true'||process.env.REGPILOT_WORKER_ENABLED==='true');

type ObservedState='never-observed'|'running'|'healthy'|'degraded'|'stale';
type Run={state:string;startedAt:Date;finishedAt:Date|null;leaseUntil:Date};
export type MonitoringRuntimeStatus={
 configured:boolean;mode:'worker'|'cron'|'both'|'inactive';state:ObservedState|'inactive';
 lastStartedAt:string|null;lastFinishedAt:string|null;lastSuccessfulAt:string|null;
 cadenceMinutes:number|null;staleAfterMinutes:number|null;reason:string;
 channels:Array<{kind:'worker'|'cron';slot:number;state:ObservedState;lastStartedAt:string|null;lastFinishedAt:string|null;cadenceMinutes:number;staleAfterMinutes:number}>;
};
const select={state:true,startedAt:true,finishedAt:true,leaseUntil:true} as const;
function runState(run:Run|null,now:number,staleMinutes:number):ObservedState{
 if(!run)return 'never-observed';
 if(run.startedAt.getTime()>now+60000)return 'degraded';
 if(now-run.startedAt.getTime()>staleMinutes*60000)return 'stale';
 if(run.state==='RUNNING')return run.leaseUntil.getTime()>now?'running':'degraded';
 if(run.state!=='COMPLETED'||!run.finishedAt||run.finishedAt<run.startedAt||run.finishedAt.getTime()>now+60000)return 'degraded';
 return 'healthy';
}
/** Deployment-level run observations only. Never return another organisation's
 * queue counts, source identities, invocation keys, errors or run summaries. */
export async function monitoringRuntimeStatus(now=new Date()):Promise<MonitoringRuntimeStatus>{
 const inactive:MonitoringRuntimeStatus={configured:false,mode:'inactive',state:'inactive',lastStartedAt:null,lastFinishedAt:null,lastSuccessfulAt:null,
  cadenceMinutes:null,staleAfterMinutes:null,channels:[],reason:'Scheduled source checks are not activated in this environment. Saving a schedule does not start a background worker.'};
 if(!monitoringRuntimeActive())return inactive;
 const worker=process.env.REGPILOT_WORKER_ENABLED==='true',cron=process.env.REGPILOT_CRON_ENABLED==='true';
 const mode=worker&&cron?'both':worker?'worker':'cron';
 const base:MonitoringRuntimeStatus={...inactive,configured:true,mode,state:'never-observed',cadenceMinutes:worker?30:1440,staleAfterMinutes:worker?90:1620};
 const capacity=process.env.REGPILOT_WORKER_SLOTS??'1';
 if(worker&&!/^[1-8]$/.test(capacity))return {...base,state:'degraded',reason:'Background worker capacity is invalid. An operator must repair the configuration before monitoring can be verified.'};
 try{
  const definitions:Array<{kind:'worker'|'cron';slot:number;cadenceMinutes:number;staleAfterMinutes:number}>=[];
  if(worker)for(let slot=0;slot<Number(capacity);slot++)definitions.push({kind:'worker',slot,cadenceMinutes:30,staleAfterMinutes:90});
  if(cron)definitions.push({kind:'cron',slot:0,cadenceMinutes:1440,staleAfterMinutes:1620});
  const [runs,successful]=await Promise.all([
   Promise.all(definitions.map(c=>db.workerRun.findFirst({where:{slot:c.slot,invocationKey:{startsWith:c.kind==='worker'?'github:':'cron:'}},orderBy:[{startedAt:'desc'},{id:'desc'}],select}))),
   db.workerRun.findFirst({where:{state:'COMPLETED',finishedAt:{not:null,lte:now},OR:definitions.map(c=>({slot:c.slot,invocationKey:{startsWith:c.kind==='worker'?'github:':'cron:'}}))},orderBy:{finishedAt:'desc'},select:{finishedAt:true}})
  ]);
  const channels=definitions.map((c,i)=>({...c,state:runState(runs[i],now.getTime(),c.staleAfterMinutes),lastStartedAt:runs[i]?.startedAt.toISOString()||null,lastFinishedAt:runs[i]?.finishedAt?.toISOString()||null}));
  // Every configured worker slot and scheduler needs its own observation. A
  // healthy cron cannot conceal a stopped dedicated worker, or vice versa.
  const state=(['degraded','stale','never-observed','running'] as const).find(s=>channels.some(c=>c.state===s))||'healthy';
  const latest=runs.filter((r):r is Run=>r!==null).sort((a,b)=>b.startedAt.getTime()-a.startedAt.getTime())[0];
  const reason:Record<ObservedState,string>={
   'never-observed':'Background execution is configured, but at least one configured scheduler or worker slot has no recorded run. A successful source check has not been established by configuration.',
   running:'A background run is in progress. Check the individual publication results after it finishes; starting a run is not a successful collection.',
   healthy:'Every configured background scheduler or worker slot has a recent completed run. Individual publication failures, freshness and human review still need checking below.',
   degraded:'A recent background run failed, was interrupted or has an invalid completion record. Source failures remain open until a successful check; an operator may need to restore the worker.',
   stale:'At least one configured scheduler or worker slot has stopped reporting within its expected interval. An operator must check scheduling and restore execution.'
  };
  return {...base,state,channels,lastStartedAt:latest?.startedAt.toISOString()||null,lastFinishedAt:latest?.finishedAt?.toISOString()||null,lastSuccessfulAt:successful?.finishedAt?.toISOString()||null,reason:reason[state]};
 }catch{
  return {...base,state:'degraded',reason:'Background run history could not be retrieved. Monitoring execution is unverified; refresh the saved status or ask an operator to investigate.'};
 }
}
