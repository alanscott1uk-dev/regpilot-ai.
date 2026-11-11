/**
 * RegPilot recognition evidence policy.
 * This catalogue is a roadmap, NOT a certificate registry or regulator endorsement.
 * No customer GxP approval, ISO accreditation, government certification, or medical
 * device registration is inferred from developer tests, a badge or self-declaration.
 */
export const RECOGNITION_TRACKS=Object.freeze([
 {id:"mhra-advice",title:"MHRA regulatory advice",kind:"REGULATOR_ADVICE",
  issuer:"MHRA",purpose:"Clarify nonclinical intended use, regulated GxP supplier responsibilities, and the appropriate regulatory contact.",
  requirements:["Versioned nonclinical intended-use definition","System architecture and AI data flow","GxP use-case boundaries and validation questions","Written MHRA response or reference"],publicNote:"Advice does not mean approval or endorsement."},
 {id:"pharma-validation",title:"Pharmaceutical computerised-system validation readiness",kind:"GXP_CUSTOMER",
  issuer:"Independent pharmaceutical QA / customer licensee",
  purpose:"Provide supplier documentation customers can use for their own risk-based intended-use qualification.",
  requirements:["User requirements and functional specifications","Data-integrity impact and GxP risk assessment","Traceable IQ/OQ/PQ or suitable risk-based test evidence","Audit trails, access, backup/restore and retention verification","Customer QA review and approved intended-use evidence"],
  publicNote:"A customer's validation is restricted to its installation and intended use; it is not MHRA product approval."},
 {id:"iso-42001",title:"ISO/IEC 42001 AI management system",kind:"ISO_CERTIFICATE",
  issuer:"UKAS-accredited certification body",purpose:"Independently certify the governance of RegPilot's AI development and operation.",
  requirements:["AI management system scope and leadership","Model inventory, impact and risk assessments","Supplier, dataset and model change controls","Internal audit, management review and independent Stage 1/2 audit","In-scope certificate and accredited issuer verification"],
  publicNote:"A certified AI management system is not approval of AI outputs or pharmaceutical quality decisions."},
 {id:"iso-27001",title:"ISO/IEC 27001 information security management",kind:"ISO_CERTIFICATE",
  issuer:"Accredited certification body",purpose:"Certify organisational information-security management.",
  requirements:["Scoped ISMS and security risk treatment","Asset, access, supplier and incident controls","Penetration testing, backup and recovery","Internal and accredited independent audits","Verifiable current certificate"],
  publicNote:"An ISMS certificate does not certify RegPilot's regulatory interpretations."},
 {id:"cyber-essentials-plus",title:"Cyber Essentials Plus",kind:"UK_CYBER",
  issuer:"IASME-licensed certification body",purpose:"Demonstrate government-backed independently tested cyber controls.",
  requirements:["Cyber Essentials scope and self-assessment","MFA, patching and secure devices","Independent Cyber Essentials Plus technical assessment","Certificate and expiry verification"],
  publicNote:"Government-backed scheme, not government approval of AI."},
 {id:"ico-gdpr",title:"ICO-approved UK GDPR certification (where eligible)",kind:"ICO_SCHEME",
  issuer:"Accredited body under an ICO-approved scheme",purpose:"Assess whether an approved Article 42 scheme covers RegPilot's actual personal-data processing.",
  requirements:["Applicable approved scheme and processing scope","Lawful basis, Article 28 agreements and data-subject rights","DPIA, transfers, retention and deletion validation","Accredited certification body verification"],
  publicNote:"ICO fee registration is not GDPR certification; scheme eligibility is not automatic."},
 {id:"gcloud",title:"UK G-Cloud framework supplier admission",kind:"PROCUREMENT",
  issuer:"UK Government Commercial Agency / Digital Marketplace",purpose:"Qualify to list RegPilot as a SaaS supplier when applications reopen.",
  requirements:["Live framework application window","Supplier declarations, finance and security details","Accessible service description and transparent pricing","Executed agreement and confirmed live framework listing"],
  publicNote:"Framework admission is procurement access, not an endorsement or assurance of individual AI outputs."}
]);
const trackIds=new Set(RECOGNITION_TRACKS.map(x=>x.id));
export const isRecognitionTrack=id=>typeof id==="string"&&trackIds.has(id);
/** Pure policy: issuer-originated and independently reviewed evidence is mandatory.
 * A Github commit, customer assertion, self-created PDF, or a URL alone is not verification.
 */
export function evaluateRecognitionEvidence(trackId,evidence,now=new Date().toISOString()){
 const track=RECOGNITION_TRACKS.find(x=>x.id===trackId);
 if(!track)return {valid:false,reason:"Unknown recognition pathway"};
 if(!evidence||typeof evidence!=="object"||Array.isArray(evidence))return {valid:false,reason:"No independently verified evidence"};
 const required=["issuer","reference","scope","documentHash","issuedAt","verificationUrl","reviewedAt","reviewerId","recordedById"];
 for(const key of required)if(typeof evidence[key]!=="string"||!evidence[key].trim())return {valid:false,reason:"Incomplete independent evidence: "+key};
 if(evidence.reviewerId===evidence.recordedById)return {valid:false,reason:"Independent reviewer must differ from the submitter"};
 if(!/^[a-f0-9]{64}$/i.test(evidence.documentHash))return {valid:false,reason:"Evidence digest must be SHA-256"};
 const ts=s=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(s)&&Number.isFinite(Date.parse(s))?Date.parse(s):NaN;
 const issued=ts(evidence.issuedAt),reviewed=ts(evidence.reviewedAt),clock=ts(now);
 if(!Number.isFinite(issued)||!Number.isFinite(reviewed)||!Number.isFinite(clock)||issued>clock||reviewed>clock||reviewed<issued)
  return {valid:false,reason:"Evidence dates are inconsistent"};
 if(clock-reviewed>180*86400000)return {valid:false,reason:"Issuer evidence must be independently rechecked"};
 if(track.kind!=="REGULATOR_ADVICE"&&track.kind!=="PROCUREMENT"&&track.kind!=="GXP_CUSTOMER"){
  const expiry=ts(evidence.expiresAt);
  if(!Number.isFinite(expiry)||expiry<=clock)return {valid:false,reason:"Current certificate and expiry must be verified"};
 }
 if(track.kind==="GXP_CUSTOMER"&&(!evidence.customerIntendedUse||!evidence.validationVersion))
  return {valid:false,reason:"A named customer-specific intended use and validation version are required"};
 let url;try{url=new URL(evidence.verificationUrl)}catch{return {valid:false,reason:"Issuer verification URL missing"}}
 if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname==="localhost"||url.hostname.endsWith(".local")||url.hostname.endsWith(".invalid")||url.hostname.endsWith(".test")||url.hostname==="127.0.0.1")
  return {valid:false,reason:"Verification must use an external HTTPS issuer reference"};
 if(evidence.verificationSource!=="INDEPENDENT_ISSUER")return {valid:false,reason:"Self-attestation is not external assurance"};
 if(evidence.assuranceApproved!==true)return {valid:false,reason:"Independent assurance approval is not recorded"};
 return {valid:true,reason:"Evidence meets RegPilot's publication gates; issuer confirmation must still be maintained",kind:track.kind};
}
export function recognitionPublicStatus(trackId,evidence,now){
 const track=RECOGNITION_TRACKS.find(x=>x.id===trackId);
 if(!track)return null;
 const assessment=evaluateRecognitionEvidence(trackId,evidence,now);
 const record={id:track.id,title:track.title,kind:track.kind,purpose:track.purpose,publicNote:track.publicNote};
 if(!assessment.valid)return {...record,status:"NOT_VERIFIED",statusLabel:"No independently verified recognition",isCertified:false,
    issuer:null,verificationUrl:null,scope:null,validUntil:null};
 const statusLabel=track.kind==="REGULATOR_ADVICE"?"Regulatory advice documented — not approval":
   track.kind==="PROCUREMENT"?"Government procurement admission verified — not endorsement":
   track.kind==="GXP_CUSTOMER"?"Customer-specific validation independently reviewed":
   "Current external certification evidence";
 return {...record,status:"EXTERNALLY_EVIDENCED",statusLabel,isCertified:["ISO_CERTIFICATE","UK_CYBER","ICO_SCHEME"].includes(track.kind),
  issuer:evidence.issuer,scope:evidence.scope,verificationUrl:evidence.verificationUrl,validUntil:evidence.expiresAt||null};
}
export function buildRecognitionRegister(evidenceMap={},now=new Date().toISOString()){
 const records=RECOGNITION_TRACKS.map(x=>recognitionPublicStatus(x.id,evidenceMap[x.id],now));
 return {records,verified:records.filter(x=>x.status==="EXTERNALLY_EVIDENCED").length,
  pending:records.filter(x=>x.status==="NOT_VERIFIED").length,
  notice:"RegPilot does not claim MHRA or UK government approval. Certificates, procurement status and advice have different legal effects. External verification is specific to issuer, scope and expiry."};
}
