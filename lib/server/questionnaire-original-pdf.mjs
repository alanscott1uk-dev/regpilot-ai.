import library from 'pdf-lib/dist/pdf-lib.min.js';
import {QuestionnaireWorkbookError} from './questionnaire-workbook.mjs';

const {PDFDocument,PDFTextField,PDFDict,PDFStream,PDFArray,PDFName,PDFInvalidObject,StandardFonts,TextAlignment,layoutMultilineText}=library;
const reject=message=>{throw new QuestionnaireWorkbookError(message);};
const key=name=>PDFName.of(name);
const disallowed=new Set('A AA OpenAction JS JavaScript XFA SigFlags Perms ByteRange DocMDP FieldMDP EmbeddedFiles EF AF Collection RichMediaContent RichMediaSettings Encrypt Sound Movie Launch URI GoToR SubmitForm ImportData Hide OCProperties'.split(' '));

function checkPackage(doc){
  const objects=doc.context.enumerateIndirectObjects();
  if(objects.length>12000)reject('This PDF exceeds the supported form complexity.');
  const pending=objects.map(([,object])=>object);
  let visited=0;
  while(pending.length){
    const object=pending.pop();
    if(++visited>200000)reject('This PDF exceeds the supported form complexity.');
    if(object instanceof PDFInvalidObject)reject('A PDF object could not be verified.');
    if(object instanceof PDFStream){pending.push(object.dict);continue;}
    if(object instanceof PDFArray){for(const child of object.asArray())pending.push(child);continue;}
    if(!(object instanceof PDFDict))continue;
    for(const [name,val] of object.entries()){
      if(disallowed.has(name.decodeText()))reject('Use an unsigned PDF without document actions, attachments or embedded forms.');
      pending.push(val);
    }
    const nameOf=k=>object.lookupMaybe(key(k),PDFName)?.decodeText();
    if(['Sig','Action','Filespec','EmbeddedFile'].includes(nameOf('Type'))||nameOf('FT')==='Sig')
      reject('Use an unsigned PDF containing ordinary form fields.');
    if(nameOf('Type')==='Annot'&&nameOf('Subtype')!=='Widget')
      reject('Original PDF return supports form widgets only. Use the response pack for annotated copies.');
  }
}

function formFields(doc){
  const pages=doc.getPages();
  if(!pages.length||pages.length>40)reject('Choose a PDF with 1 to 40 pages.');
  const positions=new Map();
  for(const [index,page] of pages.entries()){
    const annotations=page.node.Annots();
    if(!annotations)continue;
    for(const ref of annotations.asArray()){
      const annotation=doc.context.lookup(ref);
      if(!(annotation instanceof PDFDict)||annotation.lookupMaybe(key('Subtype'),PDFName)?.decodeText()!=='Widget')
        reject('The PDF contains an unsupported annotation.');
      if(positions.has(annotation))reject('A PDF widget occurs at more than one page location.');
      const rect=annotation.lookupMaybe(key('Rect'),PDFArray)?.asRectangle();
      if(!rect||!Object.values(rect).every(Number.isFinite))reject('A PDF field has an unreadable page location.');
      positions.set(annotation,{page,index,rect});
    }
  }
  if(!doc.catalog.has(key('AcroForm')))reject('This PDF has no fillable form. Use the response workbook for a flat or scanned original.');
  const fields=doc.getForm().getFields();
  if(fields.length>200)reject('The PDF exceeds the limit of 200 form fields.');
  const seen=new Set(),ownedWidgets=new Set(),available=[];
  for(const field of fields){
    for(const widget of field.acroField.getWidgets()){
      if(ownedWidgets.has(widget.dict))reject('A PDF field shares a widget with another field.');
      ownedWidgets.add(widget.dict);
    }
  }
  for(const field of fields){
    const name=field.getName();
    if(seen.has(name))reject('PDF field names must be unique.');
    seen.add(name);
    if(!(field instanceof PDFTextField)||field.isReadOnly()||field.isPassword()||field.isFileSelector()||
       field.isRichFormatted()||field.isCombed()||field.getText()||field.acroField.dict.has(key('DV'))||
       !name.trim()||name.length>180||/[\u0000-\u001f\u007f]/u.test(name))continue;
    const widgets=field.acroField.getWidgets();
    if(widgets.length!==1)continue;
    const widget=widgets[0],location=positions.get(widget.dict),flags=widget.getFlags();
    if(!location||flags&(1|2|32|64|128|256|512)||!(flags&4)||widget.getAppearanceCharacteristics()?.getRotation())continue;
    const {page,index}=location,rect=widget.getRectangle(),crop=page.getCropBox();
    if(!Object.values(rect).every(Number.isFinite)||rect.width<8||rect.height<10||
       rect.x<crop.x||rect.y<crop.y||rect.x+rect.width>crop.x+crop.width||rect.y+rect.height>crop.y+crop.height)continue;
    // A neighbouring field may cover the answer even when its own rectangle fits on the page.
    const obscured=[...positions.values()].some(other=>other!==location&&other.index===index&&
      rect.x<other.rect.x+other.rect.width&&other.rect.x<rect.x+rect.width&&
      rect.y<other.rect.y+other.rect.height&&other.rect.y<rect.y+rect.height);
    if(obscured)continue;
    const border=widget.getBorderStyle()?.getWidth()??1;
    if(!Number.isFinite(border)||border<0||border>10)continue;
    const maxLength=field.getMaxLength();
    available.push({name,page:index+1,multiline:field.isMultiline(),maxLength:maxLength??null,rect,border,field});
  }
  if(!available.length)reject('No empty, visible, printable text fields are available. Use the response workbook for this PDF.');
  return available;
}

function writeAnswer(target,value,font){
  if(!value||value.length>6000||target.maxLength!==null&&value.length>target.maxLength)
    reject('An approved answer exceeds its PDF field limit. Choose a larger field.');
  if(/[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f]/u.test(value)||(!target.multiline&&/[\r\n]/.test(value)))
    reject('The selected field cannot display the complete answer.');
  try{font.encodeText(value.replace(/[\r\n]/g,''));}catch{reject('This PDF return cannot display every character in the approved answer. Use the response workbook.');}
  const padding=target.border+2,width=target.rect.width-2*padding,height=target.rect.height-2*padding;
  for(const size of [11,10,9,8]){
    if(width<=0||height<=0)break;
    const fits=target.multiline?(()=>{
      const layout=layoutMultilineText(value,{alignment:TextAlignment.Left,font,fontSize:size,bounds:{x:0,y:0,width,height}});
      return layout.lines.every(line=>line.width<=width)&&layout.lines.length*layout.lineHeight<=height;
    })():font.widthOfTextAtSize(value,size)<=width&&font.heightAtSize(size)<=height;
    if(!fits)continue;
    const {field}=target;
    field.setText(value);
    field.setFontSize(size);
    field.updateAppearances(font);
    return;
  }
  reject('An approved answer would be clipped. Choose a larger field or the response workbook.');
}

export async function processOriginalPdf(bytes,questions,mappings){
  const doc=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false,throwOnInvalidObject:true});
  checkPackage(doc);
  const fields=formFields(doc);
  if(mappings===null)return {fields:fields.map(({name,page,multiline,maxLength})=>({name,page,multiline,maxLength}))};
  if(!Array.isArray(mappings)||mappings.length!==questions.length||!questions.length||questions.length>100)
    reject('Map one field for every approved question and product.');
  const used=new Set(),targets=new Set(),font=await doc.embedFont(StandardFonts.Helvetica);
  for(const mapping of mappings){
    const q=questions.find(q=>q.id===mapping?.questionId),target=fields.find(f=>f.name===mapping?.field);
    if(!q||!target||target.page!==q.page||used.has(q.id)||targets.has(target.name))
      reject('Each approved question needs its own empty field on the source page.');
    used.add(q.id);targets.add(target.name);
    writeAnswer(target,q.answer,font);
  }
  const result=await doc.save({updateFieldAppearances:false,useObjectStreams:false});
  if(result.length>8*1024*1024)reject('The completed PDF exceeds the 8 MiB return limit.');
  return {result};
}
