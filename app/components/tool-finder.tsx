'use client';
import {useRef,useState} from 'react';
import {searchTools,toolGroups,type WorkspaceTool} from './workspace-tools';
import css from './workspace-nav.module.css';

export default function ToolFinder({current,scoped}:{current:string;scoped:(href:string)=>string}){
  const dialog=useRef<HTMLDialogElement>(null), input=useRef<HTMLInputElement>(null);
  const [query,setQuery]=useState('');
  const searching=Boolean(query.trim());
  const groups=searching?searchTools(query):toolGroups;
  const count=groups.reduce((sum,group)=>sum+group.tools.length,0);
  function links(tools:WorkspaceTool[]){
    return <ul>{tools.map(item=><li key={item.href}><a href={scoped(item.href)}
      onClick={()=>dialog.current?.close()} aria-current={current===item.href?'page':undefined}>{item.label}</a></li>)}</ul>;
  }
  return <>
    <button type="button" className={css.findButton} aria-haspopup="dialog" onClick={()=>{
      setQuery('');dialog.current?.showModal();input.current?.focus();
    }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg>Find a tool</button>
    <dialog ref={dialog} className={css.finder} aria-labelledby="regpilot-finder-title">
      <div className={css.finderTop}><h2 id="regpilot-finder-title">Find a workspace tool</h2>
        <button type="button" onClick={()=>dialog.current?.close()}>Close</button></div>
      <label className={css.searchLabel}>Search by task or tool
        <input type="search" ref={input} value={query} maxLength={100} placeholder="Try SOP, stock count or MHRA"
          onChange={event=>setQuery(event.target.value)}/></label>
      <div className={css.directory}>
        {searching&&<p role="status">{count===0?'No matching tools. Try a shorter search or browse by area.':count===1?'1 matching tool':count+' matching tools'}</p>}
        {searching&&count===0&&<button type="button" onClick={()=>{setQuery('');input.current?.focus();}}>Browse all tools</button>}
        {groups.map(group=>searching?
          <section key={group.name}><h3>{group.name}</h3>{links(group.tools)}</section>:
          <details key={group.name} open={group.tools.some(tool=>tool.href===current)}><summary>{group.name}</summary>{links(group.tools)}</details>)}
      </div>
    </dialog>
  </>;
}
