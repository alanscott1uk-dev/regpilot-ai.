export declare const AI_PURPOSE:"business-compliance-assistance";
export declare const AI_DATA_CLASSES:readonly ["synthetic","non-sensitive-business"];
export declare const AI_RECORD_PURPOSE:"working-draft";
export declare const AI_SAFETY_BOUNDARY:{intendedUse:string;disallowed:readonly string[];limitation:string};
export declare class RegulatedUseError extends Error {constructor(message:string);}
export type AiUseDeclaration={purpose:"business-compliance-assistance";dataCategory:"synthetic"|"non-sensitive-business";recordPurpose:"working-draft";humanReviewAcknowledged:true;solelyAutomatedDecision:false;externalProcessingAcknowledged:true};
export declare function assessAiUseDeclaration(value:unknown):AiUseDeclaration&{humanReviewRequired:true};
export declare function aiBoundarySummary():{purpose:string;acceptedDataClasses:string[];recordPurpose:string;intendedUse:string;disallowed:readonly string[];limitation:string;regulatedGxpUseValidated:false;medicalDeviceAuthorised:false};
