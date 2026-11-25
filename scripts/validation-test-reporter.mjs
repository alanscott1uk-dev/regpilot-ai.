export default async function* report(events){
 for await(const {type,data} of events){
  if(type==='test:pass'||type==='test:fail')yield JSON.stringify({name:data.name,file:data.file,line:data.line,passed:type==='test:pass',skipped:!!(data.skip||data.todo),durationMs:data.details?.duration_ms})+'\n';
 }
}
