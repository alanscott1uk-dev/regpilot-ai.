import {parentPort,workerData} from "node:worker_threads";
// No rendering, scripts, annotations, attachments, external URLs or document actions.
// Runs in a separate, time/memory-bounded thread; this is not an OS security sandbox.
try{
  const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading=getDocument({data:new Uint8Array(workerData),useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false,stopAtErrors:true,isEvalSupported:false,verbosity:0});
  let pdf;
  try{
    pdf=await loading.promise;
    const pages=[],skippedPages=[];let characters=0,truncated=pdf.numPages>40;
    for(let n=1;n<=Math.min(pdf.numPages,40);n++){
      if(characters>=80000){truncated=true;break;}
      const page=await pdf.getPage(n),content=await page.getTextContent();
      const raw=content.items.filter(i=>typeof i.str==="string").map(i=>i.str+(i.hasEOL?"\n":" ")).join("");
      const text=raw.normalize("NFKC").replace(/[\t ]+/g," ").replace(/ *\n */g,"\n").trim();
      const remaining=Math.min(20000,80000-characters),bounded=text.slice(0,remaining);
      if(text.length>bounded.length)truncated=true;
      if(bounded.length<20)skippedPages.push(n);
      pages.push({page:n,text:bounded});characters+=bounded.length;page.cleanup();
    }
    parentPort.postMessage({ok:true,document:{version:"pdf-text-1.0.0",totalPages:pdf.numPages,pages,characters,truncated,skippedPages,requiresVisualReview:true}});
  }finally{await loading.destroy();}
}catch(error){
  parentPort.postMessage({ok:false,code:error?.name==="PasswordException"?"PASSWORD_REQUIRED":"PDF_UNREADABLE"});
}
