import {createHash} from 'node:crypto';
import path from 'node:path';
import {crc32} from 'node:zlib';
import yauzl from 'yauzl';
import {SaxesParser} from 'saxes';

export const QUESTIONNAIRE_FILE_LIMITS=Object.freeze({
  fileBytes:3*1024*1024,requestBytes:4*1024*1024,entries:256,
  entryBytes:8*1024*1024,inflatedBytes:16*1024*1024,compressionRatio:150,
  sheets:12,rows:3000,rowNumber:10000,columns:64,cells:20000,
  cellCharacters:6000,characters:1500000,questions:100,
});
export class QuestionnaireWorkbookError extends Error{
  constructor(message,status=422){super(message);this.name='QuestionnaireWorkbookError';this.status=status;}
}
const invalid=(message='This workbook could not be read safely. Save a clean CSV or values-only XLSX copy.')=>{throw new QuestionnaireWorkbookError(message);};
const limit=message=>{throw new QuestionnaireWorkbookError(message,413);};
const MAIN=new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main']);
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES='http://schemas.openxmlformats.org/package/2006/content-types';
const attr=(tag,name)=>Object.values(tag.attributes).find(a=>a.local===name)?.value;
const isMain=tag=>MAIN.has(tag.uri);
const activePath=/(?:^|\/)(?:vbaProject|activeX|embeddings|customUI|externalLinks|queryTables|macrosheets|dialogsheets|connections|calcChain)(?:[./]|$)|\.(?:bin|exe|dll|js|vbs)$/i;
const illegalText=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u;
const isFormulaText=value=>/^[\s\ufeff]*[=+@-]/u.test(value)&&!/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value);
function textValue(value){
  if(typeof value!=='string'||illegalText.test(value)||!value.isWellFormed())invalid('The file contains unsupported control characters. Save a clean UTF-8 copy.');
  if(value.length>QUESTIONNAIRE_FILE_LIMITS.cellCharacters)limit('A spreadsheet cell exceeds the 6,000 character limit.');
  return value;
}
function decode(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{invalid('Use a UTF-8 CSV or a standard XLSX file. The text encoding is unsupported.');}}
function filenameOf(value){
  if(typeof value!=='string'||!value.trim()||value.length>180||/[\/\\\u0000-\u001f]/u.test(value))invalid('Use a file name without folder paths or control characters.');
  const filename=value.trim();
  if(!/\.(?:csv|xlsx)$/i.test(filename))throw new QuestionnaireWorkbookError('Upload a .csv or .xlsx file. Macro-enabled and legacy Excel formats are not supported.',415);
  return filename;
}
function parseXml(bytes,handlers={}){
  const parser=new SaxesParser({xmlns:true});let depth=0,nodes=0;
  parser.on('error',()=>invalid('The workbook contains malformed XML. Save a clean XLSX copy.'));
  parser.on('doctype',()=>invalid('XML document types and entities are not supported.'));
  parser.on('processinginstruction',()=>invalid('Active XML processing instructions are not supported.'));
  parser.on('opentag',tag=>{
    if(++depth>64||++nodes>100000||Object.keys(tag.attributes).length>64)limit('The workbook XML exceeds the supported complexity limit.');
    handlers.open?.(tag);
  });
  parser.on('closetag',tag=>{handlers.close?.(tag);depth--;});
  parser.on('text',value=>handlers.text?.(value));parser.on('cdata',value=>handlers.text?.(value));
  parser.write(decode(bytes)).close();
}
async function unzip(bytes){
  return new Promise((resolve,reject)=>{
    yauzl.fromBuffer(Buffer.from(bytes),{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
      if(error)return reject(new QuestionnaireWorkbookError('The file is not a readable XLSX archive.'));
      const parts=new Map(),names=new Set();let entries=0,total=0,done=false;
      const stop=error=>{if(done)return;done=true;zip.close();reject(error instanceof QuestionnaireWorkbookError?error:new QuestionnaireWorkbookError('The XLSX archive is damaged or incomplete.'));};
      zip.on('error',stop);zip.on('end',()=>{if(!done){done=true;zip.close();resolve(parts);}});
      zip.on('entry',entry=>{
        const name=entry.fileName;
        if(++entries>QUESTIONNAIRE_FILE_LIMITS.entries||name.length>240||names.has(name.toLowerCase())||name.includes('\\')||name.includes('%')||name.includes(':')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.')||(entry.generalPurposeBitFlag&1)||![0,8].includes(entry.compressionMethod)||((entry.externalFileAttributes>>>16)&0xf000)===0xa000)return stop(new QuestionnaireWorkbookError('The XLSX contains encrypted, duplicate or unsafe archive entries.'));
        if(activePath.test(name))return stop(new QuestionnaireWorkbookError('Macros, embedded objects, external data connections and calculation chains are not supported. Save a values-only XLSX copy.'));
        if(entry.uncompressedSize>QUESTIONNAIRE_FILE_LIMITS.entryBytes||entry.uncompressedSize>Math.max(1,entry.compressedSize)*QUESTIONNAIRE_FILE_LIMITS.compressionRatio||total+entry.uncompressedSize>QUESTIONNAIRE_FILE_LIMITS.inflatedBytes)return stop(new QuestionnaireWorkbookError('The expanded workbook exceeds the safe import limit.',413));
        names.add(name.toLowerCase());total+=entry.uncompressedSize;
        zip.openReadStream(entry,(error,stream)=>{
          if(error)return stop(error);
          const chunks=[];let length=0,checksum=0;
          stream.on('error',stop);
          stream.on('data',chunk=>{length+=chunk.length;if(length>entry.uncompressedSize||length>QUESTIONNAIRE_FILE_LIMITS.entryBytes){stream.destroy();return stop(new QuestionnaireWorkbookError('The expanded workbook exceeds the safe import limit.',413));}checksum=crc32(chunk,checksum);chunks.push(chunk);});
          stream.on('end',()=>{if(done)return;if(length!==entry.uncompressedSize||checksum!==entry.crc32)return stop(new QuestionnaireWorkbookError('The workbook failed its archive integrity check.'));parts.set(name,Buffer.concat(chunks));zip.readEntry();});
        });
      });
      zip.readEntry();
    });
  });
}
function relationshipTarget(relsName,target){
  if(!target||/[\\%:#?]/.test(target)||target.startsWith('//'))invalid('The workbook contains an unsafe relationship target.');
  const base=relsName==='_rels/.rels'?'':path.posix.dirname(path.posix.dirname(relsName));
  const resolved=path.posix.normalize(target.startsWith('/')?target.slice(1):path.posix.join(base,target));
  if(resolved==='..'||resolved.startsWith('../')||resolved.startsWith('/'))invalid('The workbook contains a relationship outside its archive.');
  return resolved;
}
function relationships(parts,name){
  const bytes=parts.get(name);if(!bytes)invalid('The workbook is missing required relationships.');
  const found=new Map();let root=false;
  parseXml(bytes,{open:tag=>{
    if(tag.uri===REL&&tag.local==='Relationships')root=true;
    if(tag.uri!==REL||tag.local!=='Relationship')return;
    const id=attr(tag,'Id'),type=attr(tag,'Type')||'',mode=attr(tag,'TargetMode');
    if(!id||found.has(id)||!type)invalid('The workbook contains ambiguous relationships.');
    if(mode&&mode!=='Internal')invalid('External links and external data relationships are not supported. Save a self-contained values-only workbook.');
    if(/(?:vba|oleObject|externalLink|attachedTemplate|activeX|connections|queryTable|control)/i.test(type))invalid('The workbook contains unsupported active content.');
    const target=relationshipTarget(name,attr(tag,'Target'));
    if(!parts.has(target))invalid('A workbook relationship points to a missing file.');
    found.set(id,{type,target});
  }});
  if(!root)invalid('The workbook has invalid relationships.');return found;
}
function columnNumber(letters){let number=0;for(const letter of letters)number=number*26+letter.charCodeAt(0)-64;return number;}
export function questionnaireColumnLabel(number){
  if(!Number.isInteger(number)||number<1||number>QUESTIONNAIRE_FILE_LIMITS.columns)invalid('Choose a supported spreadsheet column.');
  let label='';while(number){number--;label=String.fromCharCode(65+number%26)+label;number=Math.floor(number/26);}return label;
}
function coordinate(value){const match=/^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value||'');if(!match)invalid('The workbook contains an invalid cell coordinate.');const column=columnNumber(match[1]),row=Number(match[2]);if(column>QUESTIONNAIRE_FILE_LIMITS.columns||row>QUESTIONNAIRE_FILE_LIMITS.rowNumber)limit('Keep worksheet data within 64 columns and the first 10,000 rows.');return {column,row};}
function sharedStrings(bytes){
  if(!bytes)return [];
  const strings=[];let current=null,inText=false,phonetic=0,characters=0,root=false;
  parseXml(bytes,{open:tag=>{
    if(!isMain(tag))return;
    if(tag.local==='sst')root=true;
    if(tag.local==='si'){if(current!==null)invalid();current='';}
    if(tag.local==='rPh')phonetic++;
    if(tag.local==='t'&&current!==null&&!phonetic)inText=true;
  },text:value=>{if(inText){current+=value;if(current.length>QUESTIONNAIRE_FILE_LIMITS.cellCharacters)limit('A shared text cell exceeds the 6,000 character limit.');}},close:tag=>{
    if(!isMain(tag))return;
    if(tag.local==='t')inText=false;
    if(tag.local==='rPh')phonetic--;
    if(tag.local==='si'){const value=textValue(current);characters+=value.length;if(strings.length>=QUESTIONNAIRE_FILE_LIMITS.cells||characters>QUESTIONNAIRE_FILE_LIMITS.characters)limit('The workbook shared text exceeds the import limit.');strings.push(value);current=null;}
  }});
  if(!root)invalid('The workbook shared-string table is invalid.');return strings;
}
function worksheet(bytes,strings,budget,warnings){
  const rows=[];let row=null,cell=null,inData=false,inValue=false,inText=false,insideInline=false,phonetic=0,previousRow=0,columnCount=0,root=false;
  parseXml(bytes,{open:tag=>{
    if(!isMain(tag))return;const name=tag.local;
    if(name==='worksheet')root=true;
    if(name==='sheetData')inData=true;
    if(name==='mergeCell')warnings.add('Merged cells are represented by their top-left value. Review every selected question before importing.');
    if(name==='col'&&['1','true'].includes(attr(tag,'hidden')))warnings.add('The workbook contains hidden columns; their selected values remain visible in the import preview.');
    if(name==='row'&&inData){
      if(row)invalid();const number=attr(tag,'r')?Number(attr(tag,'r')):previousRow+1;
      if(!Number.isInteger(number)||number<=previousRow||number>QUESTIONNAIRE_FILE_LIMITS.rowNumber)invalid('Worksheet row numbers are duplicate, unordered or outside the supported range.');
      if(++budget.rows>QUESTIONNAIRE_FILE_LIMITS.rows)limit('The workbook exceeds the 3,000 populated-row limit.');
      row={number,cells:[],hidden:['1','true'].includes(attr(tag,'hidden'))};if(row.hidden)warnings.add('The workbook contains hidden rows; their selected values remain visible in the import preview.');previousRow=number;
    }
    if(name==='c'&&inData){
      if(!row||cell)invalid();const point=attr(tag,'r')?coordinate(attr(tag,'r')):{row:row.number,column:row.cells.length+1};
      if(point.row!==row.number||point.column<=row.cells.length||point.column>QUESTIONNAIRE_FILE_LIMITS.columns)invalid('Worksheet cells are duplicate, unordered or outside their row.');
      if(++budget.cells>QUESTIONNAIRE_FILE_LIMITS.cells)limit('The workbook exceeds the 20,000-cell limit.');
      while(row.cells.length<point.column-1)row.cells.push('');cell={column:point.column,type:attr(tag,'t')||'n',value:'',inline:'',hasValue:false,hasInline:false};
    }
    if(name==='v'&&cell){if(cell.hasValue)invalid();cell.hasValue=true;inValue=true;}
    if(name==='is'&&cell){if(cell.hasInline)invalid();cell.hasInline=true;insideInline=true;}
    if(name==='rPh')phonetic++;
    if(name==='t'&&cell&&insideInline&&!phonetic)inText=true;
  },text:value=>{
    if(inValue&&cell)cell.value+=value;if(inText&&cell)cell.inline+=value;
    if(cell&&(cell.value.length>QUESTIONNAIRE_FILE_LIMITS.cellCharacters||cell.inline.length>QUESTIONNAIRE_FILE_LIMITS.cellCharacters))limit('A spreadsheet cell exceeds the 6,000 character limit.');
  },close:tag=>{
    if(!isMain(tag))return;const name=tag.local;
    if(name==='v')inValue=false;if(name==='t')inText=false;if(name==='is')insideInline=false;if(name==='rPh')phonetic--;
    if(name==='c'&&cell){
      let value=cell.value;
      if(cell.type==='s'){if(cell.hasInline||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||strings[Number(value)]===undefined)invalid('The workbook contains an invalid shared text reference.');value=strings[Number(value)];}
      else if(cell.type==='inlineStr'){if(cell.hasValue)invalid();value=cell.inline;}
      else if(cell.type==='b'){if(!['0','1'].includes(value))invalid('The workbook contains an invalid Boolean cell.');value=value==='1'?'TRUE':'FALSE';}
      else if(cell.type==='e')invalid('The workbook contains spreadsheet errors. Resolve them and save a values-only copy.');
      else if(!['n','str','d'].includes(cell.type)||cell.hasInline)invalid('The workbook contains an unsupported cell type.');
      else if(cell.type==='n'&&value&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))invalid('The workbook contains an invalid numeric cell.');
      value=textValue(value);budget.characters+=value.length;if(budget.characters>QUESTIONNAIRE_FILE_LIMITS.characters)limit('The workbook contains too much text for one import.');
      row.cells.push(value);columnCount=Math.max(columnCount,cell.column);cell=null;
    }
    if(name==='row'&&row){if(cell)invalid();if(row.cells.some(value=>value!==''))rows.push(row);row=null;}
    if(name==='sheetData')inData=false;
  }});
  if(!root||row||cell)invalid('The workbook contains an invalid worksheet.');
  return {rows,rowCount:previousRow,columnCount};
}
function csvSheet(bytes){
  const text=decode(bytes).replace(/^\uFEFF/,'');if(illegalText.test(text))invalid('The CSV contains unsupported control characters.');
  const rows=[];let row=[],cell='',quoted=false,ended=false,number=1,cells=0,characters=0,columnCount=0;
  const addCell=()=>{textValue(cell);if(isFormulaText(cell))invalid('The CSV contains a formula-like value. Export literal values or prefix the value with an apostrophe before importing.');if(++cells>QUESTIONNAIRE_FILE_LIMITS.cells)limit('The CSV exceeds the 20,000-cell limit.');characters+=cell.length;if(characters>QUESTIONNAIRE_FILE_LIMITS.characters)limit('The CSV contains too much text for one import.');if(row.length>=QUESTIONNAIRE_FILE_LIMITS.columns)limit('The CSV exceeds the 64-column limit.');row.push(cell);cell='';ended=false;};
  const addRow=()=>{columnCount=Math.max(columnCount,row.length);if(row.some(v=>v!==''))rows.push({number,cells:row,hidden:false});row=[];number++;if(number>QUESTIONNAIRE_FILE_LIMITS.rows+1)limit('The CSV exceeds the 3,000-row limit.');};
  for(let index=0;index<text.length;index++){
    const c=text[index];
    if(quoted){if(c==='"'){if(text[index+1]==='"'){cell+='"';index++;}else{quoted=false;ended=true;}}else cell+=c;}
    else if(c==='"'){if(cell||ended)invalid('The CSV has invalid quotation marks.');quoted=true;}
    else if(c===','||c==='\n'||c==='\r'){addCell();if(c!==','){if(c==='\r'&&text[index+1]==='\n')index++;addRow();}}
    else{if(ended)invalid('The CSV has text after a closed quoted cell.');cell+=c;}
    if(cell.length>QUESTIONNAIRE_FILE_LIMITS.cellCharacters)limit('A CSV cell exceeds the 6,000 character limit.');
  }
  if(quoted)invalid('The CSV contains an unclosed quoted cell.');
  if(cell||row.length||ended){addCell();addRow();}
  return {id:'csv',name:'Questionnaire',hidden:false,rows,rowCount:number-1,columnCount};
}

/** Inspect only: no Office execution, external fetches, paid processing or retained upload. */
export async function inspectQuestionnaireFile(input,rawFilename){
  const filename=filenameOf(rawFilename);
  if(input.byteLength>QUESTIONNAIRE_FILE_LIMITS.fileBytes)limit('Upload a questionnaire file of 3 MiB or less.');
  const bytes=Buffer.from(input);
  if(!bytes.length)invalid('The uploaded file is empty.');
  if(bytes.length>QUESTIONNAIRE_FILE_LIMITS.fileBytes)limit('Upload a questionnaire file of 3 MiB or less.');
  const format=/\.csv$/i.test(filename)?'CSV':'XLSX',sha256=createHash('sha256').update(bytes).digest('hex');
  const warnings=new Set(['Imports and exports contain selected text values and source coordinates. The response workspace contains selected text. To preserve the customer’s safe XLSX formatting on export, keep this exact original file for verified re-upload.']);
  let sheets;
  if(format==='CSV')sheets=[csvSheet(bytes)];
  else{
    const parts=await unzip(bytes);
    if(!parts.has('[Content_Types].xml')||!parts.has('xl/workbook.xml'))invalid('This archive is not a supported XLSX workbook.');
    let mainType=false;
    for(const [name,part] of parts){
      if(!/\.(?:xml|rels)$/i.test(name))continue;
      parseXml(part,{open:tag=>{
        if(['f','formula','formula1','formula2','definedName','ddeLink','oleObject','externalReference','connection'].includes(tag.local))invalid('Formulas, defined names and external data are not supported. Save a values-only XLSX copy.');
        if(name==='[Content_Types].xml'&&tag.uri===TYPES){const type=attr(tag,'ContentType')||'';if(/macroEnabled|vba|activeX|oleObject|externalLink|connections|queryTable/i.test(type))invalid('The workbook contains macro-enabled or active content.');if(tag.local==='Override'&&attr(tag,'PartName')==='/xl/workbook.xml'&&type==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')mainType=true;}
      }});
      if(name.endsWith('.rels'))relationships(parts,name);
    }
    const rootRels=relationships(parts,'_rels/.rels');
    if(!mainType||[...rootRels.values()].filter(r=>r.type.endsWith('/officeDocument')&&r.target==='xl/workbook.xml').length!==1)invalid('This archive is not a standard XLSX workbook.');
    const links=relationships(parts,'xl/_rels/workbook.xml.rels'),stringsLink=[...links.values()].filter(r=>r.type.endsWith('/sharedStrings'));
    if(stringsLink.length>1)invalid('The workbook contains ambiguous shared text.');
    const strings=sharedStrings(stringsLink[0]?parts.get(stringsLink[0].target):undefined),definitions=[],sheetNames=new Set(),sheetPaths=new Set();let workbookRoot=false;
    parseXml(parts.get('xl/workbook.xml'),{open:tag=>{
      if(!isMain(tag))return;if(tag.local==='workbook')workbookRoot=true;if(tag.local!=='sheet')return;
      const id=attr(tag,'id'),name=attr(tag,'name'),link=links.get(id),state=attr(tag,'state')||'visible';
      if(!id||!name||name.length>31||!link||!link.type.endsWith('/worksheet')||sheetNames.has(name.toLowerCase())||sheetPaths.has(link.target)||!['visible','hidden','veryHidden'].includes(state))invalid('The workbook contains an unsupported or ambiguous worksheet.');
      if(definitions.length>=QUESTIONNAIRE_FILE_LIMITS.sheets)limit('Import a workbook with no more than 12 worksheets.');
      sheetNames.add(name.toLowerCase());sheetPaths.add(link.target);definitions.push({id,name,hidden:state!=='visible',target:link.target});
    }});
    if(!workbookRoot||!definitions.length)invalid('The workbook does not contain a readable worksheet.');
    const budget={rows:0,cells:0,characters:0};
    sheets=definitions.map(({target,...sheet})=>{if(sheet.hidden)warnings.add('The workbook includes hidden worksheets. Select them explicitly only if they belong in this questionnaire.');return {...sheet,...worksheet(parts.get(target),strings,budget,warnings)};});
  }
  if(!sheets.some(sheet=>sheet.rows.length))invalid('No readable cell values were found in this file.');
  return {version:'questionnaire-workbook-v1',filename,format,sha256,sheets,warnings:[...warnings],limits:QUESTIONNAIRE_FILE_LIMITS};
}
function mappingInteger(value,label,min,max){if(!Number.isInteger(value)||value<min||value>max)invalid('Choose a valid '+label+'.');return value;}

/** Map the server-parsed original; client-supplied snapshots are never authoritative. */
export function mapQuestionnaireWorkbook(workbook,mappings){
  if(!Array.isArray(mappings)||!mappings.length||mappings.length>QUESTIONNAIRE_FILE_LIMITS.sheets)invalid('Select at least one worksheet and map its question column.');
  const selected=new Set(),references=new Set(),questions=[];
  const ordered=[...mappings].sort((a,b)=>workbook.sheets.findIndex(s=>s.id===a?.sheetId)-workbook.sheets.findIndex(s=>s.id===b?.sheetId));
  for(const mapping of ordered){
    if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))invalid('Check the worksheet column mapping.');
    const sheet=workbook.sheets.find(s=>s.id===mapping.sheetId);if(!sheet||selected.has(sheet.id))invalid('Select each worksheet at most once.');selected.add(sheet.id);
    const headerRow=mappingInteger(mapping.headerRow??0,'header row',0,sheet.rowCount),questionColumn=mappingInteger(mapping.questionColumn,'question column',1,sheet.columnCount);
    const optionalColumn=(value,label)=>value===undefined||value===null?null:mappingInteger(value,label,1,sheet.columnCount);
    const referenceColumn=optionalColumn(mapping.referenceColumn,'reference column'),answerColumn=optionalColumn(mapping.answerColumn,'answer column');
    if(referenceColumn===questionColumn||answerColumn===questionColumn||(referenceColumn&&referenceColumn===answerColumn))invalid('Question, reference and answer columns must be different.');
    const contextColumns=mapping.contextColumns??[];
    if(!Array.isArray(contextColumns)||contextColumns.length>8||new Set(contextColumns).size!==contextColumns.length)invalid('Select at most eight distinct instruction columns.');
    for(const column of contextColumns){mappingInteger(column,'instruction column',1,sheet.columnCount);if([questionColumn,referenceColumn,answerColumn].includes(column))invalid('Instruction columns must be separate from question, reference and answer columns.');}
    const firstRow=mappingInteger(mapping.firstRow??headerRow+1,'first question row',headerRow+1,sheet.rowCount),lastRow=mappingInteger(mapping.lastRow??sheet.rowCount,'last question row',firstRow,sheet.rowCount);
    const instructions=mapping.instructions??'';if(typeof instructions!=='string'||instructions.length>2000||illegalText.test(instructions))invalid('Worksheet instructions must contain no more than 2,000 text characters.');
    const headers=sheet.rows.find(r=>r.number===headerRow)?.cells||[];
    for(const row of sheet.rows){
      if(row.number<firstRow||row.number>lastRow)continue;
      const question=(row.cells[questionColumn-1]||'').trim();if(!question)continue;
      if(question.length<10||question.length>1200)invalid(`${sheet.name}, row ${row.number}: each question must contain 10 to 1,200 characters.`);
      const reference=referenceColumn?(row.cells[referenceColumn-1]||'').trim():sheet.name+'!'+row.number;
      if(!reference||reference.length>100)invalid(`${sheet.name}, row ${row.number}: use a non-empty reference of at most 100 characters.`);
      if(references.has(reference))invalid('Question references must be unique across selected worksheets. Use distinct references or leave the reference column unmapped.');references.add(reference);
      const context=contextColumns.map(column=>({column,value:(row.cells[column-1]||'').trim()})).filter(item=>item.value);
      const combined=[instructions.trim(),...context.map(({column,value})=>(headers[column-1]?.trim()||questionnaireColumnLabel(column))+': '+value)].filter(Boolean).join('\n');
      if(combined.length>4000)invalid(`${sheet.name}, row ${row.number}: combined instructions exceed 4,000 characters.`);
      const suppliedAnswer=answerColumn?(row.cells[answerColumn-1]||'').trim():'';
      if(suppliedAnswer.length>6000)invalid(`${sheet.name}, row ${row.number}: the supplied answer exceeds 6,000 characters.`);
      const address=column=>questionnaireColumnLabel(column)+row.number;
      questions.push({reference,question,instructions:combined,suppliedAnswer,source:{filename:workbook.filename,sha256:workbook.sha256,format:workbook.format,sheet:sheet.name,row:row.number,questionCell:address(questionColumn),...(referenceColumn?{referenceCell:address(referenceColumn)}:{}),...(answerColumn?{answerCell:address(answerColumn)}:{}),...(contextColumns.length?{contextCells:contextColumns.map(address)}:{})}});
      if(questions.length>QUESTIONNAIRE_FILE_LIMITS.questions)limit('Select no more than 100 questions in one questionnaire.');
    }
  }
  if(!questions.length)invalid('The selected rows contain no questions. Check the worksheet, row range and column mapping.');return questions;
}

/** Body bound applies even when Content-Length is omitted or forged. Call after authentication. */
export async function readQuestionnaireForm(request){
  const contentType=request.headers.get('content-type')||'';
  if(!/^multipart\/form-data\s*;/i.test(contentType))throw new QuestionnaireWorkbookError('Upload the questionnaire as multipart form data.',415);
  const declared=request.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>QUESTIONNAIRE_FILE_LIMITS.requestBytes))limit('The questionnaire upload request exceeds its size limit.');
  if(!request.body)invalid('The questionnaire upload is missing.');
  const reader=request.body.getReader(),chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>QUESTIONNAIRE_FILE_LIMITS.requestBytes){void reader.cancel();limit('The questionnaire upload request exceeds its size limit.');}chunks.push(Buffer.from(value));}}
  finally{reader.releaseLock();}
  try{return await new Request('https://regpilot.invalid/questionnaire-upload',{method:'POST',headers:{'Content-Type':contentType},body:Buffer.concat(chunks)}).formData();}
  catch{invalid('The questionnaire multipart upload is malformed.');}
}
export function questionnaireFormFile(form){
  const files=form.getAll('file');if(files.length!==1||!(files[0] instanceof File))throw new QuestionnaireWorkbookError('Choose exactly one CSV, XLSX, PDF or DOCX file.',415);
  if(files[0].size>QUESTIONNAIRE_FILE_LIMITS.fileBytes)limit('Upload a questionnaire file of 3 MiB or less.');return files[0];
}

function exportText(value,max=12000){const text=value===null||value===undefined?'':String(value);if(text.length>max||illegalText.test(text)||!text.isWellFormed())invalid('An exported field exceeds the supported text limit.');return text;}
function exportTables(value){
  if(!value||!Array.isArray(value.questions)||!value.questions.length||value.questions.length>QUESTIONNAIRE_FILE_LIMITS.questions)invalid('The questionnaire export has an invalid question count.');
  const hasOcr=value.questions.some(question=>question.source?.method==='OCR'),ocrHeaders=hasOcr?['OCR run ID','Transcription review ID','Transcription SHA-256','Recognition SHA-256','Page width','Page height','Coordinate unit','OCR line ID','Recognized line','Corrected line','Line start','Line end','Region polygon','Provider UTF-16 spans']:[];
  const hasDocuments=value.questions.some(question=>question.source?.method==='OCR'||['PDF','DOCX'].includes(question.source?.format)),documentHeaders=hasDocuments?['Source unit kind','Source unit','Source label','Start offset','End offset','Source quotation','Extraction version']:[];
  const hasProducts=value.questions.some(question=>question.product!=null),productHeaders=hasProducts?['Product code','Product name','Product ID','Product version']:[];
  const responses=[['Reference','Question','Approved answer','Instructions and context',hasDocuments?'Source location':'Source worksheet',hasDocuments?'Source unit':'Source row',...productHeaders]];
  const provenance=[['Reference','Source filename','Source SHA-256','Format','Worksheet','Row','Question cell','Reference cell','Answer cell','Context cells','Imported answer (unapproved source input)','Approved evidence references','Scope','Recipient','Approved disclosure hash','Approved at',...documentHeaders,...ocrHeaders,...productHeaders]];
  for(const question of value.questions){
    const source=question.source||{},evidence=Array.isArray(question.evidence)?question.evidence:[];
    if(hasProducts&&(!question.product||typeof question.product.id!=='string'||!question.product.id.match(/^[a-f0-9-]{36}$/i)||typeof question.product.code!=='string'||typeof question.product.name!=='string'||!Number.isInteger(question.product.version)||question.product.version<1))invalid('Every product response must include its reviewed product identity.');
    const product=hasProducts?[question.product.code,question.product.name,question.product.id,question.product.version]:[];
    responses.push([question.reference,question.question,question.answer,question.instructions,source.sheet||source.unitLabel,source.row||source.unit,...product].map(item=>exportText(item)));
    const regions=source.method==='OCR'?source.regions:[null];if(!Array.isArray(regions)||!regions.length||regions.length>200)invalid('OCR source regions are missing or exceed the export limit.');
    for(const region of regions){
      const ocr=hasOcr?(source.method==='OCR'?[source.ocrRunId,source.ocrReviewId,source.ocrReviewHash,source.rawHash,source.pageWidth,source.pageHeight,source.pageUnit,region.lineId,region.recognizedText,region.correctedText,region.start,region.end,JSON.stringify(region.polygon),JSON.stringify(region.spans)]:Array(ocrHeaders.length).fill('')):[];
      provenance.push([question.reference,source.filename,source.sha256,source.format,source.sheet,source.row,source.questionCell,source.referenceCell,source.answerCell,Array.isArray(source.contextCells)?source.contextCells.join(', '):'',question.suppliedAnswer,evidence.map(file=>exportText(file.filename)+' (SHA-256 '+exportText(file.sha256)+')').join('\n'),value.scope,value.recipient,value.approvedHash,value.approvedAt instanceof Date?value.approvedAt.toISOString():value.approvedAt,...(hasDocuments?[source.unitKind,source.unit,source.unitLabel,source.start,source.end,source.quote,source.extractionVersion]:[]),...ocr,...product].map(item=>exportText(item)));
    }
  }
  return {responses,provenance};
}
const escapeXml=value=>exportText(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
function sheetXml(rows,widths){
  const data=rows.map((row,index)=>`<row r="${index+1}"${index===0?' ht="25" customHeight="1"':''}>`+row.map((cell,column)=>`<c r="${questionnaireColumnLabel(column+1)}${index+1}" t="inlineStr" s="${index===0?1:2}"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`).join('')+'</row>').join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width,index)=>`<col min="${index+1}" max="${index+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData><autoFilter ref="A1:${questionnaireColumnLabel(rows[0].length)}${rows.length}"/></worksheet>`;
}
// The same bounded, uncompressed ZIP structure as audit archives, with generated OOXML paths.
function workbookZip(entries){
  if(entries.length>QUESTIONNAIRE_FILE_LIMITS.entries||entries.reduce((total,entry)=>total+Buffer.byteLength(entry[1]),0)>20*1024*1024)limit('The completed workbook exceeds the export limit.');
  const local=[],central=[],names=new Set();let offset=0;
  for(const [name,text] of entries){
    if(!name||name.length>240||/[\\%:\u0000-\u001f]/u.test(name)||name.startsWith('/')||name.split('/').some(part=>part==='..'||part==='.')||names.has(name.toLowerCase()))invalid('The generated workbook contains an invalid entry.');names.add(name.toLowerCase());
    const filename=Buffer.from(name),bytes=Buffer.from(text),checksum=crc32(bytes),header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(checksum,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);local.push(header,filename,bytes);
    const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(33,14);record.writeUInt32LE(checksum,16);record.writeUInt32LE(bytes.length,20);record.writeUInt32LE(bytes.length,24);record.writeUInt16LE(filename.length,28);record.writeUInt32LE(offset,42);central.push(record,filename);offset+=header.length+filename.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
export {workbookZip as writeOfficeZip};
export function writeQuestionnaireXlsx(value){
  const {responses,provenance}=exportTables(value),namespace='http://schemas.openxmlformats.org/package/2006/relationships';
  return workbookZip([
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${namespace}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Responses" sheetId="1" r:id="rId1"/><sheet name="Provenance" sheetId="2" r:id="rId2"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${namespace}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17384D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ['xl/worksheets/sheet1.xml',sheetXml(responses,[18,60,72,55,25,12,...(responses[0].length>6?[22,30,40,16]:[])])],
    ['xl/worksheets/sheet2.xml',sheetXml(provenance,[18,30,66,12,25,10,16,16,16,25,55,66,30,30,66,28,...provenance[0].slice(16).map(heading=>heading==='Source quotation'?75:heading.includes('offset')?14:30)])],
  ]);
}
export function writeQuestionnaireCsv(value){
  return exportTables(value).responses.map(row=>row.map(cell=>'"'+(/^[\s\ufeff]*[=+@-]/u.test(cell)?"'"+cell:cell).replaceAll('"','""')+'"').join(',')).join('\r\n');
}

/** Rewrite only explicitly mapped answer cells in the exact inspected original. */
export async function writeQuestionnaireOriginalXlsx(input,filename,value,mappings){
  if(!/\.xlsx$/i.test(filename))throw new QuestionnaireWorkbookError('Original-format return supports standard XLSX files only.',415);
  const book=await inspectQuestionnaireFile(input,filename);exportTables(value);
  if(value.questions.some(q=>q.source?.format!=='XLSX'||q.source.sha256!==book.sha256||q.source.filename!==book.filename))throw new QuestionnaireWorkbookError('Re-upload the exact original XLSX used to import every question. Its name and SHA-256 must match.',409);
  if(!Array.isArray(mappings)||!mappings.length||mappings.length>120)invalid('Map one explicit answer column for every worksheet and product.');
  const required=new Set(value.questions.map(q=>JSON.stringify([q.source.sheet,q.product?.id||null]))),mapped=new Map(),columns=new Set();
  for(const mapping of mappings){
    if(!mapping||typeof mapping!=='object'||Object.keys(mapping).some(k=>!['sheet','productId','answerColumn'].includes(k))||typeof mapping.sheet!=='string'||!Number.isInteger(mapping.answerColumn)||mapping.answerColumn<1||mapping.answerColumn>64||(mapping.productId!=null&&typeof mapping.productId!=='string'))invalid('Choose a valid worksheet, product and answer column.');
    const key=JSON.stringify([mapping.sheet,mapping.productId||null]),columnKey=JSON.stringify([mapping.sheet,mapping.answerColumn]);
    if(!required.has(key)||mapped.has(key))invalid('Provide each required worksheet and product mapping exactly once.');
    if(columns.has(columnKey))invalid('Each product needs a distinct answer column on the same worksheet.');
    mapped.set(key,mapping.answerColumn);columns.add(columnKey);
  }
  if(mapped.size!==required.size)invalid('Map an answer column for every worksheet and product.');
  const parts=await unzip(Buffer.from(input));
  if([...parts.keys()].some(name=>/(?:^|\/)_xmlsignatures\//i.test(name)))invalid('Digitally signed originals cannot be modified. Supply an unsigned values-only copy and import it again.');
  const links=relationships(parts,'xl/_rels/workbook.xml.rels'),targets=new Map();
  parseXml(parts.get('xl/workbook.xml'),{open:tag=>{if(isMain(tag)&&tag.local==='sheet')targets.set(attr(tag,'name'),links.get(attr(tag,'id')).target);}});
  const edits=new Map(),seen=new Set();
  const protectedColumns=new Map();
  for(const q of value.questions){const s=q.source,set=protectedColumns.get(s.sheet)||new Set();for(const cell of [s.questionCell,s.referenceCell,...(s.contextCells||[])].filter(Boolean))set.add(coordinate(cell).column);protectedColumns.set(s.sheet,set);}
  for(const q of value.questions){
    const s=q.source,sheet=book.sheets.find(sheet=>sheet.name===s.sheet),row=sheet?.rows.find(row=>row.number===s.row),questionPoint=coordinate(s.questionCell),column=mapped.get(JSON.stringify([s.sheet,q.product?.id||null]));
    if(!sheet||!row||questionPoint.row!==s.row||!row.cells[questionPoint.column-1]?.trim())invalid('The imported question coordinate is missing from the original workbook.');
    if(protectedColumns.get(s.sheet).has(column))invalid('An answer column cannot replace a question, reference or imported context column.');
    const cell=questionnaireColumnLabel(column)+s.row,key=JSON.stringify([s.sheet,cell]);
    if(seen.has(key))invalid('Multiple responses map to the same cell. Choose distinct product answer columns.');seen.add(key);
    if(row.cells[column-1]?.trim()&&s.answerCell!==cell)invalid(`The answer target ${s.sheet}!${cell} already contains unselected text. Choose an empty column or the originally imported answer column.`);
    const rows=edits.get(s.sheet)||new Map(),cells=rows.get(s.row)||new Map();cells.set(column,exportText(q.answer,6000));rows.set(s.row,cells);edits.set(s.sheet,rows);
  }
  for(const [name,rows] of edits){const target=targets.get(name);if(!target)invalid('The source worksheet is no longer available.');parts.set(target,Buffer.from(patchWorksheet(decode(parts.get(target)),rows)));}
  return workbookZip([...parts]);
}
function patchWorksheet(xml,edits){
  const parser=new SaxesParser({xmlns:true}),stack=[],rows=[],merges=[],patches=[];let tagStart=0,previousRow=0,currentRow=null,currentCell=null,dimension=null;
  parser.on('error',()=>invalid('The original worksheet is malformed.'));
  parser.on('opentagstart',()=>{tagStart=xml.lastIndexOf('<',parser.position-1);});
  parser.on('opentag',tag=>{
    const node={tag,start:tagStart,openEnd:parser.position,end:0,closeStart:0};const parent=stack.at(-1);stack.push(node);
    if(!isMain(tag))return;
    if(tag.local==='sheetProtection')invalid('The customer worksheet is protected. Obtain an editable original and import it again.');
    if(tag.local==='mergeCell'){const range=(attr(tag,'ref')||'').split(':');if(range.length!==2)invalid('An original merged-cell range is unsupported.');merges.push(range.map(coordinate));}
    if(tag.local==='dimension')dimension=node;
    if(tag.local==='row'&&parent?.tag.local==='sheetData'&&isMain(parent.tag)){
      currentRow={...node,number:attr(tag,'r')?Number(attr(tag,'r')):previousRow+1,cells:[]};previousRow=currentRow.number;rows.push(currentRow);
    }
    if(currentRow&&parent?.tag.local==='row'&&tag.local!=='c')currentRow.extraStart??=node.start;
    if(tag.local==='c'&&currentRow&&parent?.tag.local!=='row')invalid('Nested worksheet cells cannot be returned safely in the original format.');
    if(tag.local==='c'&&parent?.tag.local==='row'&&currentRow){const point=attr(tag,'r')?coordinate(attr(tag,'r')):{row:currentRow.number,column:(currentRow.cells.at(-1)?.column||0)+1};currentCell={...node,...point};currentRow.cells.push(currentCell);}
  });
  parser.on('closetag',tag=>{
    const node=stack.pop();node.end=parser.position;node.closeStart=tag.isSelfClosing?node.start:xml.lastIndexOf('<',parser.position-1);
    if(isMain(tag)&&tag.local==='c'&&currentCell){Object.assign(currentCell,{end:node.end,closeStart:node.closeStart});currentCell=null;}
    if(isMain(tag)&&tag.local==='row'&&currentRow){Object.assign(currentRow,{end:node.end,closeStart:node.closeStart});currentRow=null;}
  });parser.write(xml).close();
  const cellXml=(row,column,answer,old)=>{const name=old?.tag.name||(row.tag.prefix?row.tag.prefix+':c':'c'),prefix=name.includes(':')?name.slice(0,name.indexOf(':')+1):'';
    const attrs=old?Object.values(old.tag.attributes).filter(a=>a.name!=='t'&&a.name!=='r').map(a=>` ${a.name}="${escapeXml(a.value)}"`).join(''):'';
    return `<${name} r="${questionnaireColumnLabel(column)+row.number}" t="inlineStr"${attrs}><${prefix}is><${prefix}t xml:space="preserve">${escapeXml(answer)}</${prefix}t></${prefix}is></${name}>`;
  };
  for(const [number,cells] of edits){
    const row=rows.find(row=>row.number===number);if(!row||row.tag.isSelfClosing)invalid('The source question row cannot be mapped safely.');
    const inserts=new Map();
    for(const [column,answer] of [...cells].sort((a,b)=>a[0]-b[0])){
      if(merges.some(([a,b])=>number>=a.row&&number<=b.row&&column>=a.column&&column<=b.column))invalid(`Answer cell ${questionnaireColumnLabel(column)+number} is merged. Choose a separate unmerged answer column.`);
      const old=row.cells.find(cell=>cell.column===column),replacement=cellXml(row,column,answer,old);
      if(old)patches.push({start:old.start,end:old.end,text:replacement});else{const next=row.cells.find(cell=>cell.column>column),at=next?.start??row.extraStart??row.closeStart;inserts.set(at,(inserts.get(at)||'')+replacement);}
    }
    for(const [at,text] of inserts)patches.push({start:at,end:at,text});
    if(attr(row.tag,'spans')){const bounds=[...row.cells.map(cell=>cell.column),...cells.keys()],span=Math.min(...bounds)+':'+Math.max(...bounds);const attrs=Object.values(row.tag.attributes).map(a=>` ${a.name}="${escapeXml(a.name==='spans'?span:a.value)}"`).join('');patches.push({start:row.start,end:row.openEnd,text:`<${row.tag.name}${attrs}>`});}
  }
  if(dimension){const ref=attr(dimension.tag,'ref')||'A1',points=ref.split(':').map(coordinate);let maxColumn=Math.max(...points.map(p=>p.column)),maxRow=Math.max(...points.map(p=>p.row));for(const [row,cells] of edits){maxRow=Math.max(maxRow,row);maxColumn=Math.max(maxColumn,...cells.keys());}const minColumn=Math.min(...points.map(p=>p.column),...[...edits.values()].flatMap(cells=>[...cells.keys()])),minRow=Math.min(...points.map(p=>p.row),...edits.keys());patches.push({start:dimension.start,end:dimension.end,text:`<${dimension.tag.name} ref="${questionnaireColumnLabel(minColumn)+minRow}:${questionnaireColumnLabel(maxColumn)+maxRow}"/>`});}
  // Insertions at the same coordinate as a replacement must remain before that cell.
  patches.sort((a,b)=>b.start-a.start||b.end-a.end);
  for(const patch of patches)xml=xml.slice(0,patch.start)+patch.text+xml.slice(patch.end);
  return xml;
}
