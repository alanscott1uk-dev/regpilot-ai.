import {z} from "zod";
import {factDefinitions,type FactKey,type Rule} from "./facts";
export {factDefinitions,type FactKey,type Rule} from "./facts";
const bool=z.boolean().nullable().optional(),number=z.number().finite().min(0).max(1e12).nullable().optional();
export const factsSchema=z.object({employeeCount:number.refine(n=>n==null||Number.isInteger(n)),annualTurnoverGBP:number,sellsToConsumers:bool,distanceSelling:bool,processesPersonalData:bool,specialCategoryData:bool,foodBusiness:bool,vatRegistered:bool,limitedCompany:bool,hasPremises:bool}).strict();
export type Facts=z.infer<typeof factsSchema>;

export function parseRule(value:unknown,depth=0,budget={nodes:0}):Rule|null{
 if(value===null)return null;if(depth>4||++budget.nodes>24)throw Error("Scope rule is too complex");
 const v=value as any;if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Invalid scope rule");
 if(v.kind==="all"||v.kind==="any"){if(!Array.isArray(v.rules)||!v.rules.length||v.rules.length>8||Object.keys(v).some(k=>!["kind","rules"].includes(k)))throw Error("Invalid rule group");const rules=v.rules.map((r:unknown)=>parseRule(r,depth+1,budget));if(rules.some((r:Rule|null)=>!r))throw Error("Missing child rule");return {kind:v.kind,rules};}
 if(v.kind==="not"){if(Object.keys(v).some(k=>!["kind","rule"].includes(k)))throw Error("Invalid rule");const rule=parseRule(v.rule,depth+1,budget);if(!rule)throw Error("Missing child rule");return {kind:"not",rule};}
 if(v.kind!=="fact"||Object.keys(v).some(k=>!["kind","field","operator","value"].includes(k)))throw Error("Invalid rule");
 if(v.field==="jurisdictions"){if(v.operator!=="includes"||!["England","Scotland","Wales","Northern Ireland"].includes(v.value))throw Error("Choose a UK nation");}
 else {const f=Object.hasOwn(factDefinitions,v.field)?factDefinitions[v.field as FactKey]:null;if(!f)throw Error("Unknown business fact");if(f.type==="boolean"?(v.operator!=="eq"||typeof v.value!=="boolean"):(!["eq","gte","lte"].includes(v.operator)||typeof v.value!=="number"||!Number.isFinite(v.value)||v.value<0||v.value>1e12))throw Error("Invalid fact comparison");}
 return {kind:"fact",field:v.field,operator:v.operator,value:v.value};
}
export type RuleResult={state:"MATCH"|"NO_MATCH"|"UNKNOWN";missing:string[];explanation:string;children?:RuleResult[]};
export function evaluateRule(rule:Rule|null,facts:Facts,jurisdictions:string[]):RuleResult{
 if(!rule)return {state:"UNKNOWN",missing:[],explanation:"No scope rule has been defined; a reviewer must establish applicability."};
 if(rule.kind==="fact"){
  const name=rule.field==="jurisdictions"?"UK nations":factDefinitions[rule.field].label;
  const actual=rule.field==="jurisdictions"?(jurisdictions.length?jurisdictions:undefined):facts[rule.field];
  if(actual==null)return {state:"UNKNOWN",missing:[rule.field],explanation:name+" is not known."};
  const matched=rule.operator==="includes"?Array.isArray(actual)&&actual.includes(String(rule.value)):rule.operator==="eq"?actual===rule.value:rule.operator==="gte"?Number(actual)>=Number(rule.value):Number(actual)<=Number(rule.value);
  return {state:matched?"MATCH":"NO_MATCH",missing:[],explanation:`${name}: recorded ${Array.isArray(actual)?actual.join(", "):String(actual)}; rule ${rule.operator} ${String(rule.value)}.`};
 }
 if(rule.kind==="not"){const child=evaluateRule(rule.rule,facts,jurisdictions);return {state:child.state==="UNKNOWN"?"UNKNOWN":child.state==="MATCH"?"NO_MATCH":"MATCH",missing:child.missing,explanation:"Negated condition; unknown information remains unknown.",children:[child]};}
 const children=rule.rules.map(r=>evaluateRule(r,facts,jurisdictions));const state=rule.kind==="all"?(children.some(c=>c.state==="NO_MATCH")?"NO_MATCH":children.every(c=>c.state==="MATCH")?"MATCH":"UNKNOWN"):(children.some(c=>c.state==="MATCH")?"MATCH":children.every(c=>c.state==="NO_MATCH")?"NO_MATCH":"UNKNOWN");
 return {state,missing:[...new Set(children.flatMap(c=>c.missing))],explanation:rule.kind==="all"?"All conditions must match.":"At least one condition must match.",children};
}
