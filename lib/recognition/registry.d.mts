export type RecognitionTrack={id:string;title:string;kind:string;issuer:string;purpose:string;requirements:readonly string[];publicNote:string};
export declare const RECOGNITION_TRACKS:readonly RecognitionTrack[];
export declare function isRecognitionTrack(id:unknown):boolean;
export declare function evaluateRecognitionEvidence(trackId:string,evidence:unknown,now?:string):{valid:boolean;reason:string;kind?:string};
export declare function recognitionPublicStatus(trackId:string,evidence:unknown,now?:string):null|{id:string;title:string;kind:string;purpose:string;publicNote:string;status:string;statusLabel:string;isCertified:boolean;issuer:string|null;verificationUrl:string|null;scope:string|null;validUntil:string|null};
export declare function buildRecognitionRegister(evidenceMap?:Record<string,unknown>,now?:string):{records:NonNullable<ReturnType<typeof recognitionPublicStatus>>[];verified:number;pending:number;notice:string};
