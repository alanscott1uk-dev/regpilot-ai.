// User-facing workflow helpers: deterministic, never a legal compliance verdict.
export function parseDate(value) {
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const time=Date.parse(value+"T00:00:00Z");
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:null;
}
export function recordUrgency(record,today) {
 if(record.status==="COMPLETE")return "complete";
 const due=parseDate(record.due_date),current=parseDate(today);
 if(due===null||current===null)return "undated";
 const days=Math.round((due-current)/86400000);
 return days<0?"overdue":days<=7?"due-soon":days<=30?"upcoming":"later";
}
export function sortRecords(records,today) {
 const priority={"overdue":0,"due-soon":1,"upcoming":2,"later":3,"undated":4,"complete":5};
 return [...records].sort((a,b)=>{
  const diff=priority[recordUrgency(a,today)]-priority[recordUrgency(b,today)];
  return diff || (parseDate(a.due_date)??Infinity)-(parseDate(b.due_date)??Infinity) || a.title.localeCompare(b.title);
 });
}
export function filterRecords(records,{module="all",query="",urgency="all",today}) {
 const q=query.trim().toLowerCase();
 return sortRecords(records.filter(r=>(module==="all"||r.module_id===module)&&
  (urgency==="all"||recordUrgency(r,today)===urgency)&&
  (!q||[r.title,r.owner_name,r.module_id,r.status].join(" ").toLowerCase().includes(q))),today);
}
