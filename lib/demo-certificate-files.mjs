// Browser-only demonstration document store. No encryption, accounts or cloud backup.
const DATABASE="regpilot-demo-certificates-v1";
const STORE="files";
function openDb(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE)};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error("Database unavailable"));
 });
}
async function transact(mode,key,value){
 const db=await openDb();
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,mode);
   const store=tx.objectStore(STORE);
   const req=mode==="readonly"?store.get(key):value===null?store.delete(key):store.put(value,key);
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||new Error("Document operation failed"));
  });
 }finally{db.close();}
}
export async function saveDemoCertificateFile(id,file){
 if(typeof id!=="string"||!id||!(file instanceof File))throw new Error("Invalid file");
 if(file.size>2_000_000||file.size===0)throw new Error("Choose a file between 1 byte and 2 MB");
 const allowed=["application/pdf","image/png","image/jpeg"];
 if(!allowed.includes(file.type))throw new Error("Only PDF, PNG or JPEG files are supported");
 const bytes=new Uint8Array(await file.arrayBuffer());
 const pdf=bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==="%PDF-";
 const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
 const jpg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!(pdf&&file.type==="application/pdf"||png&&file.type==="image/png"||jpg&&file.type==="image/jpeg"))throw new Error("File signature does not match its format");
 await transact("readwrite",id,{name:file.name.slice(0,160),type:file.type,blob:file,lastModified:file.lastModified});
 return {name:file.name,size:file.size};
}
export async function readDemoCertificateFile(id){return await transact("readonly",id);}
export async function deleteDemoCertificateFile(id){await transact("readwrite",id,null);}
