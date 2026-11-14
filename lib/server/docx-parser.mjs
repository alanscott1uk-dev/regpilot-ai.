import yauzl from "yauzl";
import {SaxesParser} from "saxes";
import {crc32} from "node:zlib";

const WORD=new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main","http://purl.oclc.org/ooxml/wordprocessingml/main"]);
const REL="http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const fail=()=>{throw new Error("DOCX_INVALID");};
const value=(tag,name)=>Object.values(tag.attributes).find(a=>a.local===name)?.value;

// No file writes, relationship fetching, HTML rendering or Office execution.
// Reject DTDs/entities, extreme nesting and active XML processing instructions.
function xml(bytes,handlers={}){
  const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  const parser=new SaxesParser({xmlns:true});let depth=0;
  parser.on("error",fail);parser.on("doctype",fail);parser.on("processinginstruction",fail);
  parser.on("opentag",tag=>{if(++depth>80)fail();handlers.open?.(tag);});
  parser.on("closetag",tag=>{handlers.close?.(tag);depth--;});
  parser.on("text",s=>handlers.text?.(s));parser.on("cdata",s=>handlers.text?.(s));
  parser.write(text).close();
}
async function partsOf(bytes){
  return new Promise((resolve,reject)=>{
    yauzl.fromBuffer(Buffer.from(bytes),{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
      if(error)return reject(error);
      const parts=new Map();let count=0,total=0,done=false;
      const stop=error=>{if(done)return;done=true;zip.close();reject(error);};
      zip.on("error",stop);zip.on("end",()=>{if(!done){done=true;zip.close();resolve(parts);}});
      zip.on("entry",entry=>{
        const name=entry.fileName;
        if(++count>500||name.length>240||parts.has(name)||name.includes("\\")||name.includes("%")||name.split("/").some(p=>p===".."||p===".")||name.startsWith("/")||(entry.generalPurposeBitFlag&1)||![0,8].includes(entry.compressionMethod)||((entry.externalFileAttributes>>>16)&0xf000)===0xa000||entry.uncompressedSize>10_000_000||entry.uncompressedSize>Math.max(1,entry.compressedSize)*150||total+entry.uncompressedSize>20_000_000)return stop(Error("DOCX_LIMIT"));
        if(/(?:vbaProject|activeX|embeddings|customUI)|\.(?:exe|dll|js|vbs|bin)$/i.test(name))return stop(Error("DOCX_ACTIVE_CONTENT"));
        total+=entry.uncompressedSize;
        zip.openReadStream(entry,(error,stream)=>{
          if(error)return stop(error);
          const chunks=[];let size=0,checksum=0;
          stream.on("error",stop);
          stream.on("data",chunk=>{size+=chunk.length;if(size>entry.uncompressedSize||size>10_000_000){stream.destroy();return stop(Error("DOCX_LIMIT"));}checksum=crc32(chunk,checksum);chunks.push(chunk);});
          stream.on("end",()=>{if(done)return;if(size!==entry.uncompressedSize||checksum!==entry.crc32)return stop(Error("DOCX_INVALID"));parts.set(name,Buffer.concat(chunks));zip.readEntry();});
        });
      });
      zip.readEntry();
    });
  });
}

export async function parseDocx(bytes){
  const parts=await partsOf(bytes),issues=new Set(),warnings=new Set();
  if(!parts.has("[Content_Types].xml")||!parts.has("_rels/.rels")||!parts.has("word/document.xml"))fail();
  let mainType=false,mainRelationship=false;
  for(const [name,part] of parts){
    if(!/\.(xml|rels)$/.test(name))continue;
    if(part.length>2_000_000)fail();
    let inInstruction=false,instructions="";
    xml(part,{open:tag=>{
      if(WORD.has(tag.uri)&&tag.local==="instrText")inInstruction=true;
      if(WORD.has(tag.uri)&&tag.local==="fldSimple")instructions+=" "+(value(tag,"instr")||"");
      if(name==="[Content_Types].xml"&&tag.uri===TYPES){
        const type=value(tag,"ContentType")||"";
        if(/macroEnabled|vbaProject|activeX|oleObject/i.test(type))fail();
        if(tag.local==="Override"&&value(tag,"PartName")==="/word/document.xml"&&type===MAIN)mainType=true;
      }
      if(name.endsWith(".rels")&&tag.uri===REL&&tag.local==="Relationship"){
        const type=value(tag,"Type")||"",target=value(tag,"Target")||"";
        if(value(tag,"TargetMode")==="External"){
          if(!type.endsWith("/hyperlink"))fail();
          warnings.add("Hyperlink labels are extracted; linked websites were not fetched or verified.");
        }else if(name==="_rels/.rels"&&type.endsWith("/officeDocument")&&target==="word/document.xml")mainRelationship=true;
      }
    },text:s=>{if(inInstruction)instructions+=s;},close:tag=>{if(WORD.has(tag.uri)&&tag.local==="instrText")inInstruction=false;}});
    if(/\b(?:DDE(?:AUTO)?|INCLUDETEXT|INCLUDEPICTURE|LINK|DATABASE)\b/i.test(instructions))fail();
    if(/^word\/(comments|glossary|charts|diagrams)\//.test(name)||/^word\/comments.*\.xml$/.test(name))issues.add("Comments or supplementary content require a clean, consolidated copy before acceptance.");
  }
  if(!mainType||!mainRelationship)fail();
  const pages=[];let characters=0,totalPages=0,truncated=false;
  const add=(text,label,kind,part)=>{
    text=text.normalize("NFKC").replace(/ +/g," ").replace(/ *\n */g,"\n").trim();if(!text)return;
    totalPages++;if(pages.length>=500||characters>=80000){truncated=true;return;}
    const bounded=text.slice(0,Math.min(10000,80000-characters));if(text.length!==bounded.length)truncated=true;
    pages.push({page:totalPages,text:bounded,label,kind,part});characters+=bounded.length;
  };
  const ordered=["word/document.xml",...Array.from(parts.keys()).filter(n=>/^word\/(?:header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(n)).sort()];
  for(const part of ordered){
    const name=part==="word/document.xml"?"Body":part.slice(5,-4);
    let paragraph=null,inText=false,table=0,row=0,cell=null,cells=null,pCount=0,heading="",body=false;
    const stack=[];
    xml(parts.get(part),{open:tag=>{
      stack.push(tag);
      if(!WORD.has(tag.uri)){
        if(tag.local==="AlternateContent"||tag.local==="math"||tag.uri.includes("drawingml"))issues.add("Drawings, equations or alternate content are not fully extracted. Supply a text-only copy or review manually.");
        return;
      }
      const n=tag.local;
      if(n==="body")body=true;
      if(["del","ins","moveFrom","moveTo","rPrChange","pPrChange","tblPrChange"].includes(n))issues.add("Unresolved tracked changes: accept or reject revisions in Word, then upload the resolved copy.");
      if(["drawing","pict","object","altChunk","txbxContent"].includes(n))issues.add("Images, text boxes or embedded content are not fully extracted. Supply readable text before acceptance.");
      if(["fldChar","fldSimple","instrText"].includes(n))issues.add("Calculated fields or cross-references need a resolved, plain-text copy before acceptance.");
      if(["vanish","webHidden"].includes(n))issues.add("Hidden text is present; resolve its intended status before acceptance.");
      if(["sym","checkBox","control","contentPart"].includes(n))issues.add("Symbols, form fields or linked content need a plain-text representation before acceptance.");
      if(["vMerge","hMerge","gridSpan"].includes(n))issues.add("Merged table cells need a simplified table before automated acceptance.");
      if(n==="numPr")warnings.add("Automatic list numbers are not reconstructed. Check numbering and references in the original.");
      if(n==="tbl"){table++;row=0;if(stack.filter(t=>WORD.has(t.uri)&&t.local==="tbl").length>1)issues.add("Nested tables need a simplified copy before acceptance.");}
      if(n==="tr"){row++;cells=[];}
      if(n==="tc")cell=[];
      if(n==="p"){pCount++;paragraph={text:"",style:"",index:pCount};}
      if(n==="pStyle"&&paragraph)paragraph.style=value(tag,"val")||"";
      if(n==="t"||n==="delText")inText=true;
      if(["tab","br","cr"].includes(n)&&paragraph)paragraph.text+=n==="tab"?"\t":"\n";
      if(n==="noBreakHyphen"&&paragraph)paragraph.text+="-";
    },text:s=>{if(inText&&paragraph)paragraph.text+=s;},close:tag=>{
      if(WORD.has(tag.uri)){
        if(tag.local==="t"||tag.local==="delText")inText=false;
        if(tag.local==="p"&&paragraph){
          if(/^Heading[1-9]$/i.test(paragraph.style))heading=paragraph.text.trim().slice(0,120);
          if(cell)cell.push(paragraph.text);else add(paragraph.text,`${name} · paragraph ${paragraph.index}${heading?" · "+heading:""}`,"paragraph",part);
          paragraph=null;
        }
        if(tag.local==="tc"){cells?.push((cell||[]).join("\n"));cell=null;}
        if(tag.local==="tr"){add((cells||[]).join("\t"),`${name} · table ${table}, row ${row}${heading?" · "+heading:""}`,"table-row",part);cells=null;}
      }
      stack.pop();
    }});
    if(part==="word/document.xml"&&!body)fail();
  }
  if(!characters)issues.add("No readable text was found. OCR is not enabled; provide a text-based copy.");
  return {version:"docx-text-1.0.0",format:"DOCX",unitKind:"block",pages,totalPages,characters,truncated,skippedPages:[],requiresVisualReview:true,blockingIssues:[...issues],warnings:["Word pagination depends on fonts and layout. References identify extracted paragraphs or table rows, not pages.","Inspect the original document for authenticity, signatures, visual context and implementation evidence.",...warnings]};
}
