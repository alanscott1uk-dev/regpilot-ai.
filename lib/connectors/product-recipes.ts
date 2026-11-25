import registry from '../../public/product-monitors/published.json';

export type ProductRead={family:string;app:string;action:string;version:string;prop:string;name:string;auth:string;fixedProps?:Readonly<Record<string,string|number>>};
type Published=Record<string,string[][]>;
const publishedReads:ProductRead[]=Object.entries(registry.products as Published).flatMap(([family,items])=>
 items.map(([app,action,version,prop,name,auth])=>({family,app,action,version,prop,name,auth})));
// This audited action accepts optional filters. Pin the page size and ordering for repeatable personal-account reads.
const githubRepositories:ProductRead={
 family:'github',app:'github',action:'list-repositories',version:'1.0.4',prop:'github',name:'GitHub',auth:'OAuth',
 fixedProps:{maxResults:100,sort:'full_name',direction:'asc'}
};
export const productReads=[...publishedReads,githubRepositories];
export const productTotal=new Set(productReads.map(r=>r.family)).size;
const recipes=new Map(productReads.map(r=>[r.app+'/'+r.action,r]));
export const recipeFor=(app:string,action:string)=>recipes.get(app+'/'+action);
export const productSearch=(term:string)=>productReads.filter(r=>(r.name+' '+r.app+' '+r.action).toLowerCase().includes(term.toLowerCase().trim()));
export const productActionUrl=(r:ProductRead)=>'https://pipedream.com/apps/'+r.app+'/actions/'+r.action;
