import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const revision='f1d566cb6161f904166fa199bd4470fa37981816';
const source=process.argv[2];
if(!source)throw Error('Supply the components/ directory from the pinned Pipedream revision.');
const fields=(obj)=>new Map((obj?.properties??[]).map(p=>[p.name?.text,p]));
const value=(obj,key)=>fields(obj).get(key)?.initializer;
const includesAccountData=/(?:^|-)(?:accounts?|agents?|agreements?|alerts?|applications?|apps?|appointments?|assets?|audiences?|boards?|bookings?|brands?|business(?:es)?|calendars?|campaigns?|cases?|catalogs?|categories|channels?|clients?|companies|connections?|contacts?|containers?|customers?|dashboards?|databases?|datasets?|departments?|devices?|directories|documents?|domains?|employees?|endpoints?|environments?|events?|facilities|fields?|files?|folders?|forms?|groups?|inboxes|integrations?|inventor(?:y|ies)|invoices?|issues?|items?|jobs?|labels?|leads?|lists?|locations?|logs?|members(?:hips?)?|messages?|monitors?|orders?|orgs?|organi[sz]ations?|owners?|pages?|payments?|people|personnel|pipelines?|plans?|policies|processes|products?|profiles?|programs?|projects?|properties|queues?|records?|repos?(?:sitories)?|requests?|roles?|rooms?|segments?|senders?|services?|sites?|spaces?|sprints?|staff|stages?|stores?|subscriptions?|suppliers?|surveys?|tags?|tasks?|teams?|templates?|tenants?|tickets?|tools?|transactions?|users?|vendors?|views?|webhooks?|websites?|workflows?|workspaces?)(?:-|$)/;
const sensitive=/(?:^|-)(?:api-keys?|access-keys?|secrets?|tokens?|passwords?|credentials?|signed-url|download-url|payment-card|private-key|public-ip|example|currencies|timezones|countries|languages|models|model|regions|time-zone|time-zones|languages|currencies|public|example|samples|malware|payload|exploit|scan|intrusion)(?:-|$)/;
const aliases={microsoft_onedrive_for_business:'microsoft_onedrive',google_drive_api:'google_drive',slack_bot:'slack',slack_user:'slack',asana_personal_access_token:'asana',github_app:'github'};
const family=slug=>aliases[slug]??slug.replace(/_(?:oauth2?|api_key|apikey|personal_access_token|integration_token|basic_auth|v[12])$/,'');
function parse(file){
 const text=fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
 const exp=ast.statements.find(ts.isExportAssignment)?.expression;
 const obj=exp&&ts.isCallExpression(exp)?exp.arguments[0]:exp;
 return {ast,text,obj:obj&&ts.isObjectLiteralExpression(obj)?obj:null};
}
function sourceInventory(app,action,ast){
 const run=fields(action).get('run')?.getText(ast)??'';
 const option=run.match(/\.propDefinitions\.(\w+)\.options/);
 if(!option)return /(?:await|return)\s+(?:this\.|[^;]*?axios\()/.test(run);
 const definition=value(value(app.obj,'propDefinitions'),option[1]);
 const fn=fields(definition).get('options'),source=fn?.getText(app.ast);
 if(!source||!fn.body||!/(?:this\.(?:\w+)|(?:axios|fetch)\s*\()/.test(source))return false;
 // A selector with only an authenticated app and static options cannot observe a customer inventory.
 if(!/(?:await|yield|return)\s+[^;]{0,180}(?:this\.[\w$]+\s*\(|(?:axios|fetch)\s*\()/.test(source))return false;
 const parameter=fn.parameters[0];
 return !(parameter&&!parameter.initializer&&!parameter.questionToken&&/\.call\(\s*this\.\w+\s*\)/.test(run));
}
const digest=createHash('sha256'), groups=new Map();
for(const entry of fs.readdirSync(source,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
 if(!entry.isDirectory())continue;
 const slug=entry.name,dir=path.join(source,slug),actions=path.join(dir,'actions');
 if(!/^[a-z0-9_]{1,78}$/.test(slug)||!fs.existsSync(actions))continue;
 const appFile=fs.readdirSync(dir).find(n=>n===slug+'.app.mjs'||n===slug+'.app.ts'||n===slug+'.app.js');
 if(!appFile)continue;
 const app=parse(path.join(dir,appFile));
 if(value(app.obj,'app')?.text!==slug||!app.text.includes('$auth'))continue;
 const choices=[];
 for(const item of fs.readdirSync(actions).sort()){
  if(!/^(?:get|list|find|retrieve|search|fetch)-[a-z0-9-]+$/.test(item)||!includesAccountData.test(item)||sensitive.test(item))continue;
  const file=['mjs','ts','js'].map(ext=>path.join(actions,item,item+'.'+ext)).find(f=>fs.existsSync(f));
  if(!file)continue;
  const {ast,obj,text}=parse(file),props=value(obj,'props'),annotations=value(obj,'annotations');
  if(!obj||value(obj,'type')?.text!=='action'||!ts.isObjectLiteralExpression(props??ast)||
   value(annotations,'readOnlyHint')?.kind!==ts.SyntaxKind.TrueKeyword||value(annotations,'destructiveHint')?.kind!==ts.SyntaxKind.FalseKeyword)continue;
  if(!sourceInventory(app,obj,ast))continue;
  const key=value(obj,'key')?.text, version=value(obj,'version')?.text;
  if(key!==slug+'-'+item||!version||!/^\d+\.\d+\.\d+$/.test(version))continue;
  const binding=ast.statements.find(s=>ts.isImportDeclaration(s)&&s.moduleSpecifier.text==='../../'+appFile)?.importClause?.name?.text;
  const appProp=props.properties.find(p=>ts.isShorthandPropertyAssignment(p)?p.name.text===binding:ts.isPropertyAssignment(p)&&ts.isIdentifier(p.initializer)&&p.initializer.text===binding)?.name?.text;
  if(!appProp||!binding||!/^[$A-Za-z_][\w$]*$/.test(appProp))continue;
  const others=props.properties.filter(p=>p.name?.text!==appProp);
  if(others.some(p=>!['page','limit','pageSize','maxResults','perPage','pageNumber'].includes(p.name?.text)||
     !ts.isObjectLiteralExpression(p.initializer??ast)||!ts.isNumericLiteral(value(p.initializer,'default')??ast)))continue;
  const run=fields(obj).get('run');
  if(!run||!ts.isMethodDeclaration(run)||!run.body)continue;
  const impl=run.body.getText(ast);
  if(!impl.includes('return ')||!impl.includes('await ')||/\b(?:this\.)?\$?emit\s*\(|\.(?:post|put|patch|delete|create|update|remove|send|trigger|executeCommand)[A-Z(]/.test(impl))continue;
  const options=item.endsWith('-options');
  if(options&&!/options|\.map\(/.test(impl))continue;
  choices.push({item,v:version,prop:appProp,options});
  digest.update(path.relative(source,file)+'\0'+createHash('sha256').update(text).digest('hex')+'\n');
 }
 if(!choices.length)continue;
 choices.sort((a,b)=>Number(a.options)-Number(b.options)||a.item.localeCompare(b.item,'en'));
 const product=family(slug),record=groups.get(product)??{};
 record[slug]=choices.map(r=>[r.item,r.v,r.prop]);
 groups.set(product,record);
}
const products=Object.fromEntries([...groups].sort(([a],[b])=>a<b?-1:1));
const result={revision,source:'PipedreamHQ/pipedream',sourceDigest:digest.digest('hex'),products};
const filename=process.argv[3];
if(!filename||filename.startsWith('--'))throw Error('Supply an output path for candidate actions.');
const out=JSON.stringify(result)+'\n';
if(process.argv.includes('--verify')){if(fs.readFileSync(filename,'utf8')!==out)throw Error('Product recipe catalogue differs.');}
else fs.writeFileSync(filename,out);
const count=Object.values(products).reduce((acc,apps)=>acc+Object.values(apps).reduce((n,rows)=>n+rows.length,0),0);
console.log(groups.size+' distinct product families, '+count+' version-pinned actions');
