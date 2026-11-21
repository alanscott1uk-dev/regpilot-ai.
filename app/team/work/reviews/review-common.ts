export const reviewLabels={
 NO_RECORDED_CHANGES:'No recorded changes detected',
 NEEDS_REVIEW:'Needs another review',
 UNAVAILABLE:'Review unavailable',
 SPECIALIST:'Use the linked review workflow'
} as const;

export function reviewDate(value:string|null|undefined){
 return value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}):'Not recorded';
}

export function downloadReviewJson(filename:string,value:unknown){
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=filename+'.json';link.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
