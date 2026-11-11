/** Client display fencing only. The server independently authorises every request. */
export function createRequestScope(initialScope=""){
 let scope=String(initialScope),version=0,controller=new AbortController();
 return {
  capture(){return Object.freeze({scope,version,signal:controller.signal});},
  current(ticket){return !!ticket&&ticket.scope===scope&&ticket.version===version&&!ticket.signal.aborted;},
  invalidate(nextScope=""){
   controller.abort();scope=String(nextScope);version++;controller=new AbortController();
   return version;
  }
 };
}
