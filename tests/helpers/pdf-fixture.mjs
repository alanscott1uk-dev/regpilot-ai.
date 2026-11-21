/** Minimal valid, text-only PDF built from fictional test strings. */
export function fixturePdf(pages){
  const escape=(s)=>s.replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
  const objects=["<< /Type /Catalog /Pages 2 0 R >>",`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(" ")}] >>`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for(const [i,lines] of pages.entries()){
    const content="BT /F1 11 Tf 14 TL 40 780 Td "+lines.map((line,n)=>(n?"T* ":"")+"("+escape(line)+") Tj").join(" ")+" ET";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let pdf="%PDF-1.7\n",offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,"0")} 00000 n \n`;
  return Buffer.from(pdf+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

/** A buyer-authored questionnaire with one printable answer field per page. */
export async function fixtureFillablePdf(...questions){
  const {PDFDocument}=await import('pdf-lib');
  const doc=await PDFDocument.create();
  for(const [index,question] of questions.entries()){
    const page=doc.addPage([595,842]);
    page.drawText(question,{x:40,y:780,size:11});
    const field=doc.getForm().createTextField(index?'Buyer response '+(index+1):'Buyer response');
    field.enableMultiline();
    field.addToPage(page,{x:40,y:440,width:500,height:250});
  }
  return Buffer.from(await doc.save());
}

/** Read the returned field values with a separate PDF implementation. */
export async function readPdfAnswerFields(bytes,pageNumber=1){
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false,useSystemFonts:false,verbosity:0});
  try{
    const doc=await task.promise,page=await doc.getPage(pageNumber);
    return (await page.getAnnotations()).filter(a=>a.fieldName).map(a=>({name:a.fieldName,value:a.fieldValue}));
  }finally{await task.destroy();}
}
