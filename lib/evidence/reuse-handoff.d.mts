export type EvidenceReuseHandoff={organizationId:string;taskId:string;evidenceId:string;error:string};
export function evidenceReuseHandoff(search:string):EvidenceReuseHandoff|null;
export function resolveEvidenceReuse(handoff:EvidenceReuseHandoff|null,organizationId:string,taskId:string,evidence:readonly {id:string;filename:string;scanStatus:string}[]):{evidenceId:string;filename:string;error:string};
