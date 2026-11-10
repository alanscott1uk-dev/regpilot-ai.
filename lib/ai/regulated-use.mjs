/**
 * UK RegPilot AI intended-use boundary.
 * This is a fail-closed pilot control, NOT a determination of legal compliance
 * and not a classifier capable of detecting every category of sensitive data.
 */
export const AI_PURPOSE="business-compliance-assistance";
export const AI_DATA_CLASSES=Object.freeze(["synthetic","non-sensitive-business"]);
export const AI_RECORD_PURPOSE="working-draft";
export const AI_SAFETY_BOUNDARY=Object.freeze({
 intendedUse:"Non-clinical business compliance research, policy drafting and operational triage for independent human review.",
 disallowed:["Diagnosis, prognosis, treatment, dosing or prescribing decisions","Solely automated legal or similarly significant decisions about people","Patient or health records and special-category personal information","Controlled GxP source records or legally authoritative regulated quality records"],
 limitation:"Self-declared data scope does not replace a DPIA, privacy assessment, data minimisation or customer computerised-system validation."
});
export class RegulatedUseError extends Error{
 constructor(message){super(message);this.name="RegulatedUseError";}
}
export function assessAiUseDeclaration(value){
 if(!value||typeof value!=="object"||Array.isArray(value))throw new RegulatedUseError("A declared AI purpose and data category is required");
 if(value.purpose!==AI_PURPOSE)
  throw new RegulatedUseError("Clinical, employment, financial and other significant decision-making are outside this AI service's intended use");
 if(!AI_DATA_CLASSES.includes(value.dataCategory))
  throw new RegulatedUseError("Do not submit personal, health, patient, special-category or other sensitive data to this pilot AI service");
 if(value.recordPurpose!==AI_RECORD_PURPOSE)
  throw new RegulatedUseError("Controlled GxP original records and authoritative records are excluded pending customer-specific validation");
 if(value.humanReviewAcknowledged!==true||value.solelyAutomatedDecision!==false)
  throw new RegulatedUseError("A meaningful authorised human review is required; this service cannot take solely automated significant decisions");
 if(value.externalProcessingAcknowledged!==true)
  throw new RegulatedUseError("Confirm that external model processing is authorised for this non-sensitive example content");
 return {
  purpose:AI_PURPOSE,
  dataCategory:value.dataCategory,
  recordPurpose:AI_RECORD_PURPOSE,
  humanReviewRequired:true,
  solelyAutomatedDecision:false,
  externalProcessingAcknowledged:true
 };
}
export function aiBoundarySummary(){
 return {purpose:AI_PURPOSE,acceptedDataClasses:[...AI_DATA_CLASSES],recordPurpose:AI_RECORD_PURPOSE,
  ...AI_SAFETY_BOUNDARY,regulatedGxpUseValidated:false,medicalDeviceAuthorised:false};
}
