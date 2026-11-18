import {WorkInputError,workUuid} from './work-hub.mjs';

export const COMPLETION_EVIDENCE_LIMIT=10;
export const COMPLETION_SCOPE='A record of the task outcome and the reviewed evidence checked at completion. It is not legal certification or a guarantee of continuing compliance. The receipt hash checks content integrity; it is not a digital signature.';

/** A single human-confirmed completion. There is deliberately no batch or exception option. */
export function parseWorkCompletion(input) {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['token','evidenceIds','confirm','notes'].includes(key)))throw new WorkInputError('Choose a single task and review its completion details.');
 if(input.confirm!==true)throw new WorkInputError('Confirm that the task outcome and selected evidence have been checked.');
 if(typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token))throw new WorkInputError('Refresh the completion check before confirming.');
 if(!Array.isArray(input.evidenceIds)||input.evidenceIds.length<1||input.evidenceIds.length>COMPLETION_EVIDENCE_LIMIT||input.evidenceIds.some(id=>!workUuid(id)))throw new WorkInputError('Choose between 1 and 10 reviewed evidence files.');
 const evidenceIds=input.evidenceIds.map(id=>id.toLowerCase()).sort();
 if(new Set(evidenceIds).size!==evidenceIds.length)throw new WorkInputError('Each selected evidence file must be unique.');
 const notes=typeof input.notes==='string'?input.notes.trim():'';
 if(notes.length<20||notes.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(notes))throw new WorkInputError('Describe what was completed in 20 to 500 characters.');
 return {token:input.token,evidenceIds,confirm:true,notes};
}

/** Enforce the exact accepted-assessment manifest for source work; other work may select a subset. */
export function selectedCompletionEvidence(evidence,ids,mandatory=false) {
 const selected=evidence.filter(file=>ids.includes(file.id));
 if(selected.length!==ids.length||mandatory&&(selected.length!==evidence.length||evidence.some(file=>!ids.includes(file.id))))throw new WorkInputError(mandatory?'Use all files from the current accepted assessment. Refresh the completion check.':'Selected evidence changed or is not independently approved. Refresh the completion check.',409);
 return selected;
}
