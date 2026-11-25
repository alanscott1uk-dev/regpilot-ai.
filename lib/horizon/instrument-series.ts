export const instrumentSeries=[
 {id:'uksi',slug:'uksi',name:'UK statutory instruments',topics:[]},
 {id:'ssi',slug:'ssi',name:'Scottish statutory instruments',topics:[]},
 {id:'wsi',slug:'wsi',name:'Welsh statutory instruments',topics:[]},
 {id:'nisr',slug:'nisr',name:'Northern Ireland statutory rules',topics:[]}
] as const;
export function isInstrumentSeries(value:string){return instrumentSeries.some(s=>s.id===value);}
export function instrumentUrl(path:string,publisher:string){
 const m=/^\/legislation\/(uksi|ssi|wsi|nisr)\/(\d{4})\/([1-9]\d{0,5})(?:\/corrections\/(en|we|cy|mi)\/(\d{3}))?$/.exec(path);
 if(!m||m[1]!==publisher)throw Error('Invalid legislative series identity');
 const [,code,year,number,language,slip]=m,base='https://www.legislation.gov.uk/'+[code,year,number].join('/');
 return slip?base+'/pdfs/'+code+'cs_'+year+number.padStart(4,'0')+'_'+language+'_'+slip+'.pdf':base+'/made';
}
export function instrumentPath(url:string,publisher:string){
 if(!URL.canParse(url))return null;
 const u=new URL(url);
 if(!['https://www.legislation.gov.uk','http://www.legislation.gov.uk'].includes(u.origin)||u.username||u.password||u.search||u.hash)return null;
 const main=/^\/(?:id\/)?(uksi|ssi|wsi|nisr)\/(\d{4})\/([1-9]\d{0,5})(?:\/contents)?(?:\/made)?$/.exec(u.pathname);
 if(main?.[1]===publisher)return '/legislation/'+main.slice(1).join('/');
 const correction=/^\/(uksi|ssi|wsi|nisr)\/(\d{4})\/([1-9]\d{0,5})\/pdfs\/[a-z0-9_]+_(en|cy|we|mi)_(\d{3})\.pdf$/.exec(u.pathname);
 if(!correction||correction[1]!==publisher)return null;
 const path='/legislation/'+correction.slice(1,4).join('/')+'/corrections/'+correction.slice(4).join('/');
 return new URL(instrumentUrl(path,publisher)).pathname===u.pathname?path:null;
}
export function instrumentReference(url:string,publisher:string){
 if(!url.startsWith('https://'))return null;
 const path=instrumentPath(url,publisher);return path?instrumentUrl(path,publisher):null;
}
