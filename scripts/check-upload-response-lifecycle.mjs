/** Targeted Chromium transport reproduction; the real evidence journey verifies the product. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const confirmation={evidence:{id:'fictional',filename:'training-record.pdf',reviewStatus:'PENDING_REVIEW'}};
const server=createServer(async(request,response)=>{
 if(request.method==='POST'){
  for await(const _chunk of request){};
  response.writeHead(201,{'content-type':'application/json','cache-control':'no-store'});
  response.end(JSON.stringify(confirmation));
 }else{
  const consume=request.url==='/?consume=true';
  response.writeHead(200,{'content-type':'text/html'});
  response.end(`<button onclick="fetch('/evidence',{method:'POST',body:'fictional file'})${consume?'.then(response=>response.json())':''}.then(()=>document.querySelector('p').textContent='stored')">Upload</button><p></p>`);
 }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const cases=[];
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const consume of [false,true]){
  const page=await browser.newPage();
  try{
   await page.goto(base+'/?consume='+consume);
   const [response]=await Promise.all([
    page.waitForResponse(item=>item.request().method()==='POST'),
    page.getByRole('button',{name:'Upload',exact:true}).click()
   ]);
   await page.getByText('stored',{exact:true}).waitFor();
   let timer,result;
   try{
    result=await Promise.race([
     response.json().then(body=>({responseBodyRead:true,body})),
     new Promise(resolve=>{timer=setTimeout(()=>resolve({responseBodyRead:false}),2_000);})
    ]);
   }finally{clearTimeout(timer);}
   assert.equal(result.responseBodyRead,consume,'consuming the browser response must finish the JSON confirmation');
   if(consume)assert.deepEqual(result.body,confirmation);
   cases.push({clientConsumesJson:consume,ui:'stored',status:response.status(),responseBodyRead:result.responseBodyRead});
  }finally{await page.close();}
 }
 const report={passed:true,node:process.version,chromium:browser.version(),cases};
 await mkdir('artifacts/usability',{recursive:true});
 await writeFile('artifacts/usability/upload-response-lifecycle.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}
