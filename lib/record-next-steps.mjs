// Deterministic, non-legal next-step suggestions based on the user's saved record.
// These never infer statutory compliance or fabricate regulatory requirements.
export function suggestRecordNextSteps(record, today){
 if(!record||typeof record!=="object")return [];
 const suggestions=[];
 const due=typeof record.due_date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(record.due_date)?record.due_date:null;
 if(record.status==="COMPLETE"){
  suggestions.push({id:"completion",level:"info",text:"Work is marked complete. Check that any required evidence has been independently reviewed."});
 } else if(due&&due<today){
  suggestions.push({id:"overdue",level:"urgent",text:"This task is past its review date. Confirm a revised deadline and responsible person."});
 } else if(due&&due<=new Date(Date.parse(today+"T00:00:00Z")+7*86400000).toISOString().slice(0,10)){
  suggestions.push({id:"due-soon",level:"attention",text:"This task is due within seven days. Review progress and supporting records."});
 } else if(!due){
  suggestions.push({id:"no-date",level:"info",text:"Consider adding a review date so the task can be prioritised."});
 }
 if(record.evidence_status!=="APPROVED"){
  suggestions.push({id:"evidence",level:"attention",text:"Supporting evidence is not approved. Review the linked document checklist; this is not a compliance verdict."});
 }
 return suggestions;
}
