import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {archiveFilename} from './audit-archive';

export const RESPONSE_PACK_LIMITS={files:50,evidenceBytes:30*1024*1024,archiveBytes:32*1024*1024,entries:53} as const;
export const responsePackHash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Count distinct originals before downloading; conflicting metadata is not a valid deduplication key. */
export function responsePackEvidenceSize(files:Array<{sha256:string;sizeBytes:number}>){
 const sizes=new Map<string,number>();
 for(const file of files){if(!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.sizeBytes)||file.sizeBytes<0||sizes.has(file.sha256)&&sizes.get(file.sha256)!==file.sizeBytes)throw new Error('Reviewed evidence metadata is inconsistent');sizes.set(file.sha256,file.sizeBytes);}
 return [...sizes.values()].reduce((total,size)=>total+size,0);
}
/** Server-generated, flat archive names. Same bytes are included once even under several reviewed records. */
export function responsePackFiles(files:Array<{id:string;filename:string;sha256:string;sizeBytes:number;bytes:Uint8Array}>){
 if(files.length>RESPONSE_PACK_LIMITS.files||new Set(files.map(f=>f.id)).size!==files.length)throw new Error('The response pack exceeds its evidence limit');
 if(responsePackEvidenceSize(files)>RESPONSE_PACK_LIMITS.evidenceBytes)throw new Error('The response pack exceeds 30 MiB of distinct evidence');
 const unique=new Map<string,{name:string;bytes:Uint8Array;sha256:string;sizeBytes:number}>(),byEvidence=new Map<string,string>();let total=0;
 for(const file of files){
  if(file.bytes.byteLength!==file.sizeBytes||responsePackHash(file.bytes)!==file.sha256)throw new Error('Reviewed evidence bytes changed');
  let entry=unique.get(file.sha256);
  if(!entry){entry={name:archiveFilename(unique.size,file.filename),bytes:file.bytes,sha256:file.sha256,sizeBytes:file.sizeBytes};total+=file.sizeBytes;if(total>RESPONSE_PACK_LIMITS.evidenceBytes)throw new Error('The response pack exceeds 30 MiB of evidence');unique.set(file.sha256,entry);}
  byEvidence.set(file.id,entry.name);
 }
 return {entries:[...unique.values()],byEvidence};
}
/** ZIP32 without compression. No uploaded paths or archive members are accepted here. */
export function writeResponsePackZip(entries:Array<{name:string;bytes:Uint8Array}>){
 if(!entries.length||entries.length>RESPONSE_PACK_LIMITS.entries||22+entries.reduce((n,e)=>n+e.bytes.length+76+2*Buffer.byteLength(e.name),0)>RESPONSE_PACK_LIMITS.archiveBytes)throw new Error('The response pack exceeds its archive limit');
 const names=new Set<string>(),local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const entry of entries){
  if(!/^[A-Za-z0-9_.-]{1,180}$/.test(entry.name)||entry.name.includes('..')||names.has(entry.name.toLowerCase()))throw new Error('Unsafe response pack filename');names.add(entry.name.toLowerCase());
  const name=Buffer.from(entry.name),bytes=Buffer.from(entry.bytes),checksum=crc32(bytes),header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(checksum,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);local.push(header,name,bytes);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(33,14);record.writeUInt32LE(checksum,16);record.writeUInt32LE(bytes.length,20);record.writeUInt32LE(bytes.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);central.push(record,name);offset+=header.length+name.length+bytes.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
