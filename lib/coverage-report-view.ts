export const coverageAreas=['controls','sources','connectors','vendors','access','risks','rooms','requests','questionnaires','api'] as const;
export type CoverageArea=typeof coverageAreas[number];
export type ReportView={areas:CoverageArea[];attentionOnly:boolean};
export function readReportView(params:URLSearchParams):ReportView{
 const selected=new Set((params.get('areas')||'').split(','));
 const areas=coverageAreas.filter(area=>selected.has(area));
 return {areas:areas.length?areas:[...coverageAreas],attentionOnly:params.get('attention')==='1'};
}
export function applyReportView(params:URLSearchParams,view:ReportView){
 const areas=coverageAreas.filter(area=>view.areas.includes(area));
 if(areas.length&&areas.length<coverageAreas.length)params.set('areas',areas.join(','));
 else params.delete('areas');
 if(view.attentionOnly)params.set('attention','1');
 else params.delete('attention');
 return params;
}
