// Pure preflight checks for the future private evidence upload workflow.
// Client-side validation is advisory only. The server and storage policies must repeat checks.
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EVIDENCE_TYPES = Object.freeze({
 "application/pdf": ["pdf"],
 "image/png": ["png"],
 "image/jpeg": ["jpg","jpeg"]
});
export function validateEvidenceCandidate({name,size,type} = {}) {
 const errors=[];
 if(typeof name!=="string"||name.length<1||name.length>180||/[\\/\x00-\x1f]/.test(name)) errors.push("Invalid filename");
 if(!Number.isSafeInteger(size)||size<=0||size>MAX_EVIDENCE_BYTES) errors.push("File must be between 1 byte and 10 MB");
 const ext=typeof name==="string"?name.split(".").pop()?.toLowerCase():"";
 if(!Object.hasOwn(ALLOWED_EVIDENCE_TYPES,type)||!ALLOWED_EVIDENCE_TYPES[type].includes(ext)) errors.push("Only PDF, PNG and JPEG are allowed");
 return {ok:errors.length===0,errors};
}
export function evidenceObjectKey({organizationId,documentId,version}) {
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(organizationId)||!uuid.test(documentId)||!Number.isSafeInteger(version)||version<1)throw new Error("Invalid evidence identity");
 return organizationId+"/"+documentId+"/v"+version;
}
export function evidenceCanBeApproved({uploaded,scanned,reviewedBy,uploadedBy,integrityVerified}) {
 return uploaded===true&&scanned===true&&integrityVerified===true&&
 typeof reviewedBy==="string"&&reviewedBy.length>0&&reviewedBy!==uploadedBy;
}
