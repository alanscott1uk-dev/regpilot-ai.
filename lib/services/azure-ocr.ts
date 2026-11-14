import {serviceReady,azureOrigin} from "./config";
import {boundedJson,checkedJson,ProviderError} from "./http";
const PREFIX="/documentintelligence/documentModels/prebuilt-read/analyzeResults/";
export type OcrResult={engine:string;pages:Array<{page:number;text:string}>;pageCount:number;characters:number;limitations:string[]};
export function safeOperation(url:string){const u=new URL(url);if(u.origin!==azureOrigin()||u.username||u.password||u.hash||!u.pathname.startsWith(PREFIX)||!/^[-a-f0-9]{36}$/.test(u.pathname.slice(PREFIX.length))||u.search!=="?api-version=2024-11-30")throw new ProviderError("UNSAFE_OPERATION_URL");return u.href;}
export async function startOcr(bytes:Uint8Array,pages:number,fetcher:typeof fetch=fetch){
 if(!serviceReady("OCR"))throw new ProviderError("SERVICE_DISABLED");if(bytes.length>5_000_000||!Number.isInteger(pages)||pages<1||pages>40)throw new ProviderError("DOCUMENT_LIMIT");
 const response=await fetcher(azureOrigin()+"/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&pages=1-"+pages,{method:"POST",headers:{"Ocp-Apim-Subscription-Key":process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY!,"Content-Type":"application/json"},body:JSON.stringify({base64Source:Buffer.from(bytes).toString("base64")}),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});
 if(response.status!==202){if(response.ok){await response.body?.cancel();throw new ProviderError("INVALID_RESPONSE");}await checkedJson(response);}
 const operation=response.headers.get("operation-location");await response.body?.cancel();if(!operation)throw new ProviderError("MISSING_OPERATION");return safeOperation(operation);
}
export async function pollOcr(operation:string,pages:number,fetcher:typeof fetch=fetch):Promise<OcrResult|null>{
 if(!serviceReady("OCR"))throw new ProviderError("SERVICE_DISABLED");const response=await fetcher(safeOperation(operation),{headers:{"Ocp-Apim-Subscription-Key":process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY!},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)}),data=await checkedJson(response,2_000_000);
 if(["running","notStarted"].includes(data.status))return null;if(data.status!=="succeeded")throw new ProviderError("OCR_FAILED");
 const result=data.analyzeResult;if(result?.modelId!=="prebuilt-read"||result.apiVersion!=="2024-11-30"||!Array.isArray(result.pages)||result.pages.length!==pages)throw new ProviderError("INCOMPLETE_OCR");
 let characters=0;const units=result.pages.map((p:any,i:number)=>{if(p.pageNumber!==i+1||!Array.isArray(p.lines)||p.lines.some((l:any)=>typeof l.content!=="string"))throw new ProviderError("INCOMPLETE_OCR");const text=p.lines.map((l:any)=>l.content).join("\n");characters+=text.length;if(characters>80_000)throw new ProviderError("OCR_TEXT_LIMIT");return {page:p.pageNumber,text};});
 if(!characters)throw new ProviderError("EMPTY_OCR");return {engine:"azure-read-2024-11-30",pages:units,pageCount:pages,characters,limitations:["Machine-generated OCR draft. Compare every relevant passage with the original; text recognition can be wrong.","This draft is not approved evidence, a signature check or a compliance verdict. It is not automatically used in programme or assurance decisions."]};
}
