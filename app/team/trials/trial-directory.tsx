import {useState} from 'react';
import {allTrialTracks} from '../../../lib/capability-trials';
import type {trialWorkspace} from '../../../lib/server/capability-trial-service';
import {WorkspaceIcon} from '../../components/workspace-nav';
import styles from './trials.module.css';

type Trial=Awaited<ReturnType<typeof trialWorkspace>>['trials'][number];
export const trialHref=(organizationId:string,values:Record<string,string>={})=>'/team/trials?'+new URLSearchParams({organizationId,...values});
const paths=[
 {participant:'operator',title:'Set up an integration',description:'Choose a product, connect it and verify its first reading.',icon:'connections'},
 {participant:'github',title:'Review GitHub evidence',description:'Inspect a recorded read and hand it to an assessor.',icon:'evidence'},
 {participant:'site',title:'Qualify a site',description:'Test a site configuration against its acceptance criteria.',icon:'tasks'}
];
export function LaunchTrials({org}:{org:string}){
 return <section aria-labelledby="start-title"><div className={styles.sectionHead}><h2 id="start-title">Start a trial</h2><a href={trialHref(org,{screen:'new'})}>All trial types <span aria-hidden="true">→</span></a></div>
 <div className={styles.launchGrid}>{paths.map(p=><a className={styles.launch} key={p.participant} href={trialHref(org,{participant:p.participant})}>
 <span className={styles.symbol} aria-hidden="true"><WorkspaceIcon name={p.icon}/></span><strong>{p.title}</strong><span>{p.description}</span></a>)}</div></section>;
}
export function trialStatus(t:Trial){
 if(t.elapsedSeconds===null)return t.stoppedAt?'Ready to record':'In progress';
 if(!t.current)return 'Needs reassessment';
 if(t.accepted)return 'Accepted';
 if(t.reviewCount>=t.required)return 'Review rejected';
 return 'Awaiting review';
}
export function TrialList({trials,org,history,limited}:{trials:Trial[];org:string;history?:boolean;limited?:boolean}){
 const [term,setTerm]=useState(''),[status,setStatus]=useState('');
 const items=history?trials.filter(t=>(!status||trialStatus(t)===status)&&(allTrialTracks[t.track].title+' '+t.intendedUse+' '+t.release).toLowerCase().includes(term.trim().toLowerCase())):trials.slice(0,5);
 return <section aria-labelledby="runs-title"><div className={styles.sectionHead}><h2 id="runs-title">{history?'Trial history':'Recent trials'}</h2>
 {!history&&<a href={trialHref(org,{screen:'history'})}>View history <span aria-hidden="true">→</span></a>}</div>
 {history&&<div className={styles.filters}><label>Find a trial<input type="search" value={term} onChange={e=>setTerm(e.target.value)} placeholder="Trial, intended use or release"/></label>
 <label>Status<select aria-label="Status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['In progress','Ready to record','Awaiting review','Accepted','Review rejected','Needs reassessment'].map(s=><option key={s}>{s}</option>)}</select></label></div>}
 <div className={styles.list}>{items.length?<ul>{items.map(t=><li key={t.id}><a href={trialHref(org,{trialId:t.id})}><div><strong>{allTrialTracks[t.track].title}</strong>
 <small>{new Date(t.startedAt).toLocaleString('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} UTC</small></div>
 <span className={styles.status} data-state={trialStatus(t)}>{trialStatus(t)}</span><span aria-hidden="true">→</span></a></li>)}</ul>:<p>{trials.length?'No loaded trials match these filters.':'No trials recorded in this view.'}</p>}</div>
 {history&&limited&&<p>Search covers the loaded trials. Load earlier trials to include them.</p>}</section>;
}
