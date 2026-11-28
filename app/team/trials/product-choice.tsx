import {useState} from 'react';
import {productReads} from '../../../lib/connectors/product-recipes';
import styles from './trials.module.css';

const choices=[{key:'DAILYMED_LABEL',label:'DailyMed test label'},...productReads.map(p=>({key:p.app+'/'+p.action,label:p.name+' · '+p.action}))];
export default function ProductChoice(){
 const [query,search]=useState(''),[key,select]=useState('github/list-repositories');
 const matches=choices.filter(p=>(p.label+' '+p.key).toLowerCase().includes(query.trim().toLowerCase()));
 const value=matches.some(p=>p.key===key)?key:matches.length===1?matches[0].key:'';
 return <div className={styles.filters}><label>Find an integration<input type="search" placeholder="Product or action" value={query} onChange={e=>search(e.target.value)}/></label>
 <label>Integration to set up<select required name="operatorProduct" value={value} onChange={e=>select(e.target.value)}>
 <option disabled value="">{matches.length?'Choose a matching integration':'No matching integrations'}</option>
 {matches.map(p=><option value={p.key} key={p.key}>{p.label}</option>)}</select></label></div>;
}
