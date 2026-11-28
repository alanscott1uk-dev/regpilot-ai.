export const portalExtensionId='eelalmkjgehonmadfcpknkoebfgemlnd';
type Reply={ok:boolean;message?:string;nonce?:string;capture?:unknown};
type Runtime={lastError?:{message?:string};sendMessage:(extension:string,message:unknown,respond:(reply?:Reply)=>void)=>void};
export function portalBridge(message:Record<string,unknown>):Promise<Reply>{
 const runtime=(window as Window&{chrome?:{runtime?:Runtime}}).chrome?.runtime;
 if(!runtime?.sendMessage)return Promise.reject(Error('Install the helper downloaded from this RegPilot address, then refresh this page.'));
 return new Promise((resolve,reject)=>runtime.sendMessage(portalExtensionId,message,reply=>{
  if(runtime.lastError||!reply)reject(Error('Open the helper downloaded from this RegPilot address, then pair again.'));
  else if(!reply.ok)reject(Error(reply.message||'The pairing expired. Pair this questionnaire again.'));
  else resolve(reply);
 }));
}
