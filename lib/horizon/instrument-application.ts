import {SaxesParser} from 'saxes';
import {applicationNation,type InstrumentApplication} from './instrument-series';

const ns='http://www.legislation.gov.uk/namespaces/legislation';
const official=(uri:string|undefined)=>uri?.replace(/^http:/,'https:');

// Read only the instrument's own opening provision. Text inside an amendment,
// explanatory note, schedule or another instrument cannot set this record's scope.
export function readApplicationClause(xml:string,source:string):InstrumentApplication|undefined{
 const parser=new SaxesParser({xmlns:true}),stack:string[]=[],matches:InstrumentApplication[]=[];
 let provision:InstrumentApplication['provision']|undefined,provisionDepth=0,textDepth=0,wording='',plain=true,qualified=false;
 parser.on('doctype',()=>{throw Error('Unexpected document type');});
 parser.on('opentag',tag=>{
  const name=tag.uri===ns?tag.local:'?';
  stack.push(name);
  if(stack.length>80)throw Error('Unexpected legislative structure');
  if(stack.length===1&&(name!=='Legislation'||official(tag.attributes.DocumentURI?.value)!==source))throw Error('Unexpected instrument');
  const path=stack.join('/');
  if(/^Legislation\/Secondary\/Body\/(?:P1group\/)?P1$/.test(path)){
   const id=tag.attributes.id?.value,kind=/^(regulation|article|rule)-1$/.exec(id??'')?.[1] as typeof provision;
   const expected=source.replace(/\/made$/,'/'+kind+'/1/made');
   if(kind&&official(tag.attributes.DocumentURI?.value)===expected){provision=kind;provisionDepth=stack.length;}
  }
  if(!provision)return;
  const paragraph=stack.slice(provisionDepth).join('/');
  if(/^P1para\/(?:P2\/P2para\/)?Text$/.test(paragraph)){textDepth=stack.length;wording='';plain=true;}
  else if(textDepth&&name!=='FootnoteRef')plain=false;
 });
 function add(value:string){if(textDepth){wording+=value;if(wording.length>8000)plain=false;}}
 parser.on('text',add);parser.on('cdata',add);
 parser.on('closetag',()=>{
  if(textDepth===stack.length){
   const line=wording.replace(/\s+/g,' ').trim();
   if(plain&&applicationNation(line)&&provision)matches.push({wording:line,provision});
   else if(/\b(?:extend(?:s)? to|appl(?:y|ies) (?:only |in |to (?:England|Wales|Scotland|Northern Ireland))|except (?:in|for)|subject to paragraph)\b/i.test(line))qualified=true;
   textDepth=0;
  }
  if(provisionDepth===stack.length){provision=undefined;provisionDepth=0;}
  stack.pop();
 });
 parser.write(xml).close();
 return !qualified&&matches.length===1?matches[0]:undefined;
}
