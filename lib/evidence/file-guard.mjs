import {createHash,randomUUID} from "node:crypto";
import net from "node:net";
export const MAX_EVIDENCE_BYTES=5_000_000;
export const MAX_ORG_EVIDENCE_BYTES=100_000_000;
export const MAX_ORG_EVIDENCE_FILES=120;
export const DOCX_MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export class EvidenceError extends Error{
 constructor(message,status=400){super(message);this.name="EvidenceError";this.status=status;}
}
export function checkPdf(bytes,filename){
 const buf=Buffer.from(bytes||[]);
 if(buf.length<30||buf.length>MAX_EVIDENCE_BYTES)throw new EvidenceError("PDF must be 30 bytes to 5 MB",413);
 if(typeof filename!=="string"||filename.length>160||!filename.toLowerCase().endsWith(".pdf"))throw new EvidenceError("Only PDF files are accepted for the pilot",415);
 if(buf.toString("ascii",0,5)!=="%PDF-")throw new EvidenceError("Invalid PDF header",415);
 if(!buf.includes(Buffer.from("%%EOF")))throw new EvidenceError("PDF is missing its end marker",415);
 return buf;
}
/** Cheap envelope check only. DOCX packages MUST also pass the bounded parser. */
export function checkDocument(bytes,filename){
 if(typeof filename!=="string"||filename.length>160)throw new EvidenceError("Invalid document filename",415);
 if(filename.toLowerCase().endsWith(".pdf"))return {bytes:checkPdf(bytes,filename),format:"PDF",contentType:"application/pdf"};
 if(!filename.toLowerCase().endsWith(".docx"))throw new EvidenceError("Choose a PDF or a standard Word .docx file",415);
 const buf=Buffer.from(bytes||[]);
 if(buf.length<30||buf.length>MAX_EVIDENCE_BYTES)throw new EvidenceError("Document must be 30 bytes to 5 MB",413);
 if(buf.readUInt32LE(0)!==0x04034b50)throw new EvidenceError("Invalid Word document header",415);
 return {bytes:buf,format:"DOCX",contentType:DOCX_MIME};
}
export function evidenceHash(bytes){return createHash("sha256").update(bytes).digest("hex");}
export function contentDispositionFilename(filename){
 const extension=String(filename).toLowerCase().endsWith(".docx")?".docx":".pdf";
 const safe=String(filename).normalize("NFKC").replace(/[^a-zA-Z0-9_. -]/g,"_").replace(/[\\/\r\n"]/g,"_").trim().replace(/\.(pdf|docx)$/i,"").slice(0,105)||"document";
 return safe+extension;
}
export function objectKey(organisationId,format="PDF"){
 if(!/^[0-9a-f-]{36}$/i.test(organisationId))throw new EvidenceError("Invalid organisation");
 if(!["PDF","DOCX"].includes(format))throw new EvidenceError("Unsupported document format");
 return organisationId+"/"+randomUUID()+(format==="DOCX"?".docx":".pdf");
}
/** ClamAV INSTREAM protocol: requires an explicit CLEAN response. No scanner means no upload. */
export function scanWithClamd(bytes,{host,port=3310,timeoutMs=10000}={}){
 if(typeof host!=="string"||host.length===0)throw new EvidenceError("Virus scanner unavailable",503);
 const buffer=Buffer.from(bytes);
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection({host,port});
  let complete=false,answer="";
  const finish=(err)=>{
   if(complete)return;complete=true;socket.destroy();
   if(err)reject(err);
   else if(/^(?:stream|instream): OK$/i.test(answer.replace(/\0/g,"").trim()))resolve({status:"CLEAN",engine:"clamd"});
   else reject(new EvidenceError("Virus scan could not verify a clean result",422));
  };
  socket.setTimeout(timeoutMs);
  socket.once("timeout",()=>finish(new EvidenceError("Virus scanner timed out",503)));
  socket.once("error",()=>finish(new EvidenceError("Virus scanner connection failed",503)));
  socket.on("data",data=>{
   answer+=data.toString("utf8");
   if(answer.length>1024)return finish(new EvidenceError("Invalid scanner response",503));
   if(answer.includes("\0")||answer.includes("\n"))finish();
  });
  socket.once("end",()=>finish());
  socket.once("connect",()=>{
   socket.write("zINSTREAM\0");
   for(let offset=0;offset<buffer.length;offset+=65536){
    const block=buffer.subarray(offset,offset+65536),len=Buffer.alloc(4);
    len.writeUInt32BE(block.length);socket.write(len);socket.write(block);
   }
   socket.write(Buffer.alloc(4));
  });
 });
}
