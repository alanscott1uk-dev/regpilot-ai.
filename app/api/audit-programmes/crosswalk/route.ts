import {controlIds,getAuditControl,getProfile,referenceFor,release,scfAttribution} from '../../../../lib/audit-catalogue/catalogue';
import {csvEscape} from '../../../../lib/obligations.mjs';

export function GET(request:Request){
  const params=new URL(request.url).searchParams;
  const left=getProfile(params.get('first')??''),right=getProfile(params.get('second')??'');
  if(params.getAll('first').length!==1||params.getAll('second').length!==1||
     left?.source!=='scf'||right?.source!=='scf'||left.id===right.id){
    return Response.json({error:'Choose two different profiles with published SCF mappings.'},{status:400});
  }
  const columns=['SCF control','Control name',left.label,right.label,'Evidence request IDs','Catalogue release','Source SHA-256','Publisher','Source','Licence'];
  const ids=new Set([...controlIds(left),...controlIds(right)]);
  const rows=Array.from(ids).sort().map(id=>{
    const first=referenceFor(left,id),second=referenceFor(right,id);
    const control=getAuditControl(first?left:right,id)!;
    return [id,control.name,first??'',second??'',control.evidence.map(e=>e.id).join(', '),release,left.digest,
      scfAttribution.publisher,scfAttribution.url,scfAttribution.license];
  });
  const csv=[columns,...rows].map(row=>row.map(csvEscape).join(',')).join('\r\n')+'\r\n';
  return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8',
    'Content-Disposition':'attachment; filename="'+left.id+'--'+right.id+'.csv"','Cache-Control':'public, max-age=300'}});
}
