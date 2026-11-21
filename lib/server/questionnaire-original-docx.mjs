import {createHash} from 'node:crypto';
import {SaxesParser} from 'saxes';
import {partsOf,inspectDocxParts} from './docx-parser.mjs';
import {writeOfficeZip,QuestionnaireWorkbookError} from './questionnaire-workbook.mjs';

function reject(message,status=422){throw new QuestionnaireWorkbookError(message,status);}
const supportedPart=/^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:app|core)\.xml|docProps\/thumbnail\.jpe?g|customXml\/(?:item(?:Props)?\d+\.xml|_rels\/item\d+\.xml\.rels)|word\/(?:document|styles(?:WithEffects)?|settings|webSettings|numbering|fontTable|header\d+|footer\d+|footnotes|endnotes)\.xml|word\/theme\/theme\d+\.xml|word\/_rels\/document\.xml\.rels)$/;
function checkEditable(parts){
  for(const [path,bytes] of parts){
    if(!supportedPart.test(path))reject('Use an unsigned Word questionnaire with plain text paragraphs or two-column tables.');
    if(/^docProps\/thumbnail\.jpe?g$/.test(path)){
      const end=bytes.lastIndexOf(Buffer.from([0xff,0xd9]));
      if(bytes[0]!==0xff||bytes[1]!==0xd8||end<2||bytes.subarray(end+2).some(b=>b!==0))reject('Unsupported Word thumbnail.');
      continue;
    }
    const bibliography=/^customXml\/item\d+\.xml$/.test(path);
    const parser=new SaxesParser({xmlns:true});
    if(bibliography)parser.on('text',text=>{if(text.trim())reject('Use a Word copy without custom data.');});

    parser.on('opentag',tag=>{
      if(bibliography&&(tag.uri!=='http://schemas.openxmlformats.org/officeDocument/2006/bibliography'||tag.local!=='Sources'||!tag.isSelfClosing))
        reject('Use a Word copy without custom data.');
      if(['documentProtection','writeProtection','trackRevisions','sdt','permStart','permEnd','sectPrChange','vanish','webHidden','specVanish','fldChar','fldSimple','instrText'].includes(tag.local))
        reject('Supply a Word copy with editable, visible text and resolved fields and revisions.');
      if(tag.local==='Relationship'&&Object.values(tag.attributes).some(a=>a.local==='TargetMode'&&a.value.toLowerCase()==='external'))
        reject('Use a Word questionnaire without external relationships for original-format return.');
    });
    parser.write(bytes.toString('utf8')).close();
  }
}

function answerParagraph(uri,text){
  if(typeof text!=='string'||!text.trim()||text.length>6500||!text.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text))
    reject('An approved Word answer contains unsupported text.');
  const xml=text.split(/(\r\n|[\r\n\t])/).map(part=>{
    if(part==='\t')return '<w:tab/>';
    if(/[\r\n]/.test(part))return '<w:br/>';
    return '<w:t xml:space="preserve">'+part.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t>';
  }).join('');
  return '<w:p xmlns:w="'+uri+'"><w:r>'+xml+'</w:r></w:p>';
}

export async function writeOriginalDocx(input,filename,questions){
  if(!/\.docx$/i.test(filename)||!input.length||input.length>3*1024*1024||!Array.isArray(questions)||!questions.length||questions.length>100)
    reject('Choose the original Word questionnaire, up to 3 MiB and 100 questions.');
  const digest=createHash('sha256').update(input).digest('hex');
  if(questions.some(q=>q.source?.format!=='DOCX'||q.source.sha256!==digest||q.source.filename!==filename))
    reject('The Word filename and SHA-256 must match every imported question.',409);
  const parts=await partsOf(input),locations=new Map();
  const document=inspectDocxParts(parts,locations);
  if(document.blockingIssues.length||document.truncated)reject('Resolve the Word extraction issues before original-format return.');
  checkEditable(parts);
  const insertions=new Map();
  for(const q of questions){
    const s=q.source,block=document.pages[s.unit-1],location=locations.get(s.unit);
    if(!location||!block||s.unitKind!=='block'||s.extractionVersion!==document.version||s.start!==0||s.end!==block.text.length||s.quote!==block.text)
      reject('Each question must occupy one complete body paragraph or one two-cell row with an empty answer cell. Use the response pack for other layouts.');
    const target=insertions.get(location.at)??{products:new Set(),paragraphs:[]};
    const productId=q.product?.id??null;
    if(target.products.has(productId))reject('Two answers share a Word location and product. Review the source selections.');
    target.products.add(productId);
    const label=q.product?q.product.code+' · '+q.product.name+': ':'';
    target.paragraphs.push(answerParagraph(location.uri,label+q.answer));
    insertions.set(location.at,target);
  }
  let xml=parts.get('word/document.xml').toString('utf8');
  // XML cursor offsets exclude the UTF-8 BOM. Preserve it on output separately.
  const bom=xml.startsWith('\uFEFF');
  if(bom)xml=xml.slice(1);
  for(const [at,edit] of [...insertions].sort(([a],[b])=>b-a))
    xml=xml.slice(0,at)+edit.paragraphs.join('')+xml.slice(at);
  parts.set('word/document.xml',Buffer.from((bom?'\uFEFF':'')+xml));
  return writeOfficeZip([...parts]);
}
