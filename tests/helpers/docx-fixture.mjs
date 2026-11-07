import {crc32,deflateRawSync} from "node:zlib";
export const wordNamespace="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const paragraph=text=>`<w:p><w:r><w:t>${text.replaceAll("&","&amp;").replaceAll("<","&lt;")}</w:t></w:r></w:p>`;
/** Synthetic OOXML only; never customer records. Deliberately no Office tooling. */
export function zipFixture(entries){
  const local=[],central=[];let offset=0;
  for(const [filename,text] of entries){
    const name=Buffer.from(filename),bytes=Buffer.isBuffer(text)?text:Buffer.from(text),compressed=deflateRawSync(bytes),crc=crc32(bytes);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,compressed);
    const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(8,10);record.writeUInt32LE(crc,16);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(bytes.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);central.push(record,name);offset+=header.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export function docxParts(body=paragraph("Fictional staff must complete training before access is granted.")){
  return [["[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],["_rels/.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],["word/document.xml",`<w:document xmlns:w="${wordNamespace}"><w:body>${body}</w:body></w:document>`]];
}
export const fixtureDocx=(body,extras=[])=>zipFixture([...docxParts(body),...extras]);
