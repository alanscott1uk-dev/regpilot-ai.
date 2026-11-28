import {stockBlocker,type StockRecord} from '../../../lib/stock-reconciliation';
import css from './quality.module.css';

type CaseView={
 case:{ownerName:string;rootCause:string;status:string;handoverRecipientId:string|null;cycle:number};
 actions:{kind:string;task:{title:string;ownerName:string;href:string};completion?:{current:boolean}}[];
 latestReview:{cycle:number;status:string;current:boolean}|null;stockRecords:StockRecord[]|null;blockers:string[];
 canEdit:boolean;canAcceptHandover:boolean;canReview:boolean;closureCurrent:boolean;canReopen:boolean;
};
type Props={selected:CaseView;members:{id:string;email:string}[];busy:boolean;download:()=>void};
type Next={title:string;instruction:string;button?:string;target?:string;href?:string};
function nextStep(s:CaseView,members:Props['members']):Next{
 const row=s.case;
 if(row.status==='CLOSED'){
  if(!s.closureCurrent&&s.canReopen)return {title:'Reassess the closed case',instruction:'The evidence or responsible people have changed. Check the recorded decision and enter the reason for reopening.',target:'quality-reopen',button:'Open reassessment'};
  return {title:'Read the inspection summary',instruction:s.closureCurrent?'The independent closure is recorded. Download the chronology, actions and evidence references.':'The closure record needs reassessment by a quality administrator.',button:'Get inspection summary'};
 }
 if(row.handoverRecipientId){
  const person=members.find(m=>m.id===row.handoverRecipientId)?.email??'the named recipient';
  return {title:s.canAcceptHandover?'Accept the case handover':'Waiting for handover acceptance',instruction:'Review the outstanding checks. '+row.ownerName+' remains responsible until '+person+' accepts.',target:'quality-handover',button:'View handover'};
 }
 const stock=s.stockRecords?.at(-1);
 if(stock&&stockBlocker(stock))return {title:stock.review?'Follow up the stock count':'Check the stock review',instruction:stockBlocker(stock)!,target:'quality-stock',button:'Open stock reconciliation'};
 if(!row.rootCause)return {title:'Record the investigation',instruction:'Case owner: '+row.ownerName+'. Record what caused the issue, how it was contained and what would show the action worked.',target:s.canEdit?'quality-plan-form':'quality-investigation',button:'Open investigation'};
 if(!s.actions.some(a=>a.kind!=='CONTAINMENT'))return {title:'Choose a corrective or preventive action',instruction:'Case owner: '+row.ownerName+'. Assign a task to the person who will carry it out and describe the expected result.',target:s.canEdit?'quality-action-form':'quality-actions',button:'View corrective actions'};
 const pending=s.actions.find(a=>!a.completion?.current);
 if(pending)return {title:'Check the evidence for the action',instruction:'Task owner: '+pending.task.ownerName+'. Open “'+pending.task.title+'” and check what is outstanding.',href:pending.task.href,button:'Open the action task'};
 if(s.blockers.length)return {title:'Resolve an outstanding check',instruction:s.blockers[0],target:'quality-effectiveness',button:'View outstanding checks'};
 if(s.latestReview?.cycle===row.cycle&&s.latestReview.status==='PENDING'&&s.latestReview.current)return {title:s.canReview?'Decide whether the actions worked':'Awaiting independent effectiveness review',instruction:s.canReview?'Compare the observation and evidence with the planned criteria, then record your decision.':'A separate eligible quality administrator reviews the observation and records the decision.',target:s.canReview?'quality-review-decision':'quality-effectiveness',button:'View effectiveness review'};
 return {title:'Record the effectiveness observation',instruction:'Case owner: '+row.ownerName+'. Compare what happened with the planned criteria and attach reviewed evidence.',target:s.canEdit?'quality-prepare-form':'quality-effectiveness',button:'Open effectiveness assessment'};
}
export default function CaseNextStep({selected,members,busy,download}:Props){
 const next=nextStep(selected,members);
 function open(){
  if(!next.target){download();return;}
  const target=document.getElementById(next.target);
  if(!target)return;
  if(target instanceof HTMLDetailsElement)target.open=true;
  const focus=target instanceof HTMLDetailsElement?target.querySelector('summary'):target;
  focus?.focus({preventScroll:true});target.scrollIntoView({block:'start'});
 }
 return <section className={css.stockNotice} aria-label="Next step for this case"><h3>{next.title}</h3><p>{next.instruction}</p>
  {next.href?<a href={next.href}>{next.button}</a>:<button type="button" disabled={busy} onClick={open}>{next.button}</button>}
 </section>;
}
