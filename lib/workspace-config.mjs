import {getIndustry,validateDepartments} from "./industry-catalog.mjs";
import {recommendedModules,validModules} from "./compliance-modules.mjs";
export const WORKSPACE_KEY="regpilot-company-configuration-v1";
export function defaultWorkspace(industry="healthcare"){
 const item=getIndustry(industry);
 return {company:"Star Medical — fictional pilot",industry:item.id,departments:[...item.departments],modules:recommendedModules(item.id)};
}
export function parseWorkspace(value){
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const {company,industry,departments,modules}=value;
 if(typeof company!=="string"||company.length>120||typeof industry!=="string"||!validateDepartments(departments))return null;
 return {company,industry,departments:[...departments],modules:validModules(modules)?[...modules]:recommendedModules(industry)};
}
export function moduleHref(id){
 if(id==="regulatory")return "/regulatory-sources";
 if(id==="departments")return "/departments";
 if(id==="obligations")return "/";
 if(id==="suppliers"||id==="imports")return "/distribution";
 return null;
}
