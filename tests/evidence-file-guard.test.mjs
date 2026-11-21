import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {checkPdf,evidenceHash,contentDispositionFilename,objectKey,scanWithClamd,EvidenceError} from "../lib/evidence/file-guard.mjs";
const pdf=Buffer.from("%PDF-1.7\n1 0 obj\n<</Type /Catalog>>\nendobj\n%%EOF");
test("PDF validation blocks false signatures, extensions and oversize files",()=>{
 assert.equal(checkPdf(pdf,"sample.pdf").byteLength,pdf.length);
 assert.throws(()=>checkPdf(pdf,"sample.html"),EvidenceError);
 assert.throws(()=>checkPdf(Buffer.from("not a PDF"),"bad.pdf"),EvidenceError);
 assert.throws(()=>checkPdf(Buffer.alloc(5000001), "huge.pdf"),EvidenceError);
});
test("file names, organisation keys and hashes are bounded",()=>{
 assert.match(contentDispositionFilename('../../secrets"bad.pdf'),/\.pdf$/);
 assert.ok(!contentDispositionFilename('../file\r\n.pdf').includes("\n"));
 const key=objectKey("123e4567-e89b-42d3-a456-426614174000");
 assert.match(key,/^123e4567-e89b-42d3-a456-426614174000\/[a-f0-9-]+\.pdf$/);
 assert.equal(evidenceHash(pdf).length,64);
});
async function clamd(reply){
 const server=net.createServer(socket=>{
  let input=Buffer.alloc(0);
  socket.on("data",block=>{
   input=Buffer.concat([input,block]);
   if(input.length>10&&input.subarray(-4).equals(Buffer.alloc(4))){
    socket.write(reply+"\0");socket.end();
   }
  });
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=server.address().port;
 try{return await scanWithClamd(pdf,{host:"127.0.0.1",port,timeoutMs:1500});}
 finally{await new Promise(resolve=>server.close(resolve))}
}
test("valid ClamAV CLEAN verdict permits upload",async()=>assert.equal((await clamd("stream: OK")).status,"CLEAN"));
test("ClamAV virus verdict never permits upload",async()=>await assert.rejects(()=>clamd("stream: Eicar-Test-Signature FOUND"),EvidenceError));
test("ClamAV ERROR fails closed",async()=>await assert.rejects(()=>clamd("stream: ERROR"),EvidenceError));
test("scanner must be configured",()=>assert.throws(()=>scanWithClamd(pdf,{host:""}),EvidenceError));
