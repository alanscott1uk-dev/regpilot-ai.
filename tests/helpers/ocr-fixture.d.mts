export const OCR_IMAGE:{width:number;height:number};
export const OCR_QUESTION:string;
export const OCR_RECOGNISED:string;
export function fixtureOcrPixels():Buffer;
export function fixtureOcrPng():Buffer;
export function fixtureScannedPdf():Buffer;
export function fixtureAzureOcr(format?:string,text?:string):{status:string;analyzeResult:{apiVersion:string;modelId:string;stringIndexType:string;content:string;pages:{pageNumber:number;width:number;height:number;unit:string;angle:number;lines:{content:string;polygon:number[];spans:{offset:number;length:number}[]}[]}[]}};

export function fixtureOcrJpeg():Buffer;
