import yauzl from 'yauzl';
/** Independent ZIP reader used only for verifying generated test artifacts. */
export const readZipParts=bytes=>new Promise((resolve,reject)=>yauzl.fromBuffer(Buffer.from(bytes),{lazyEntries:true},(error,zip)=>{
 if(error)return reject(error);const parts=new Map();zip.on('error',reject);zip.on('end',()=>resolve(parts));zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('error',reject);stream.on('data',c=>chunks.push(c));stream.on('end',()=>{parts.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();});}));zip.readEntry();
}));
