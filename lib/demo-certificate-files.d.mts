export type StoredCertificateFile={name:string;type:string;blob:Blob;lastModified:number};
export function saveDemoCertificateFile(id:string,file:File):Promise<{name:string;size:number}>;
export function readDemoCertificateFile(id:string):Promise<StoredCertificateFile|undefined>;
export function deleteDemoCertificateFile(id:string):Promise<void>;
