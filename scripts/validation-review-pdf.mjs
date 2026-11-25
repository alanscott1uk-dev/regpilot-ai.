import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';

// The PDF accompanies the machine-readable trace matrix and original execution log.
export async function validationReviewPdf(pack){
 const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),mono=await pdf.embedFont(StandardFonts.Courier);
 pdf.setTitle('RegPilot pharmaceutical release validation '+pack.revision.slice(0,12));pdf.setAuthor('RegPilot');
 pdf.setCreationDate(new Date(pack.finishedAt));pdf.setModificationDate(new Date(pack.finishedAt));
 const ink=rgb(.12,.17,.20),green=rgb(.02,.35,.28),muted=rgb(.28,.34,.38),width=595,height=842,margin=46;
 let page,y;
 function next(){
  page=pdf.addPage([width,height]);y=height-56;
  page.drawText('RegPilot  /  Supplier quality',{x:margin,y,size:10,font:bold,color:green});y-=24;
 }
 function fit(amount){if(!page||y-amount<58)next();}
 function paragraph(value,font=regular,size=10,color=ink){
  const text=String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[–—]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\x20-\x7e]/g,' ').trim();
  let line='';
  function draw(){if(!line)return;fit(size+5);page.drawText(line,{x:margin,y,font,size,color});y-=size+5;line='';}
  for(const word of text.split(/\s+/)){
   if(line&&font.widthOfTextAtSize(line+' '+word,size)>width-2*margin)draw();
   if(font.widthOfTextAtSize(word,size)<=width-2*margin){line+=(line?' ':'')+word;continue;}
   for(const ch of word){if(font.widthOfTextAtSize(line+ch,size)>width-2*margin)draw();line+=ch;}
  }
  draw();
 }
 next();paragraph('Pharmaceutical release validation',bold,22);
 paragraph(pack.commitSubject,bold,13);y-=8;
 paragraph('Software revision',bold);paragraph(pack.revision,mono,9);
 paragraph('Comparison baseline',bold);paragraph(pack.parent,mono,9);
 paragraph('Execution '+pack.startedAt+' to '+pack.finishedAt);
 if(pack.runId)paragraph('GitHub Actions run '+pack.runId+'   Attempt '+pack.attempt);
 paragraph(pack.environment);paragraph(pack.scope);y-=12;
 paragraph('Executed requirements',bold,15);
 for(const result of pack.requirements){
  fit(102);paragraph(result.id+'   '+result.result,bold,12,green);
  paragraph(result.requirement,bold);paragraph(result.test);
  paragraph(result.file+' line '+result.line+'   '+Math.round(result.durationMs)+' ms',mono,9,muted);
  paragraph('Test file SHA-256  '+result.testFileSha256,mono,8,muted);y-=8;
 }
 fit(80);paragraph('Changes since the baseline',bold,15);
 for(const change of pack.changes)paragraph(change.replace(/\t/g,'  '),mono,8);
 const pages=pdf.getPages();
 pages.forEach((p,i)=>{p.drawLine({start:{x:margin,y:42},end:{x:width-margin,y:42},thickness:.6,color:muted});p.drawText(pack.revision.slice(0,12)+'   /   '+(i+1)+' of '+pages.length,{x:margin,y:27,size:9,font:mono,color:muted});});
 return Buffer.from(await pdf.save());
}
