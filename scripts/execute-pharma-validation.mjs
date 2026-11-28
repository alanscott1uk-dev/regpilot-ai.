import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {validationReviewPdf} from './validation-review-pdf.mjs';

const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const sha=git('rev-parse','HEAD'),parent=git('rev-parse','HEAD^1');
if(process.env.REGPILOT_VALIDATION_REVISION!==sha)throw Error('The checked-out revision differs from the requested release.');
if(git('status','--porcelain','--untracked-files=no'))throw Error('Execute the protocol on a clean revision.');
const requirements=JSON.parse(readFileSync(new URL('./pharma-validation-requirements.json',import.meta.url),'utf8'));
const escape=value=>value.split('').map(c=>'\\^$.*+?()[]{}|'.includes(c)?'\\'+c:c).join('');
const pattern='^(?:'+requirements.map(row=>escape(row.test)).join('|')+')$';
const startedAt=new Date().toISOString();
const args=['--import','tsx','--test','--test-concurrency=1','--test-name-pattern='+pattern,'--test-reporter=./scripts/validation-test-reporter.mjs',...new Set(requirements.map(row=>row.file))];
const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:240000,maxBuffer:2_000_000});
if(result.error)throw result.error;
if(result.status!==0){console.error(result.stderr,result.stdout);throw Error('A release validation test failed.');}
const events=result.stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const rows=requirements.map(r=>{
 const matches=events.filter(e=>e.name===r.test&&resolve(e.file)===resolve(r.file));
 if(matches.length!==1||!matches[0].passed||matches[0].skipped)throw Error('Missing successful execution of '+r.id);
 return {...r,result:'PASS',line:matches[0].line,durationMs:matches[0].durationMs,testFileSha256:createHash('sha256').update(readFileSync(r.file)).digest('hex')};
});
const runId=process.env.GITHUB_RUN_ID??null,attempt=process.env.GITHUB_RUN_ATTEMPT??null;
const pack={format:'regpilot-pharma-validation-v1',revision:sha,parent,startedAt,finishedAt:new Date().toISOString(),runId,attempt,node:process.version,
 environment:'Isolated PostgreSQL with synthetic instruments, stock, users and evidence',scope:'Supplier software verification. The site records its own acceptance for its intended use.',requirements:rows,
 changes:git('diff','--name-status',parent,sha).split('\n').filter(Boolean),
 commitSubject:git('show','-s','--format=%s',sha),command:[process.execPath,...args]};
const dir='artifacts/pharma-validation';mkdirSync(dir,{recursive:true});
const columns=['id','requirement','test','file','line','testFileSha256','result','durationMs','revision'];
const csvCell=value=>'"'+String(value).replace(/^(?=\s*[=+@-])/,"'").replaceAll('"','""')+'"';
const traceability=[columns.join(','),...rows.map(row=>columns.map(key=>csvCell(key==='revision'?sha:row[key])).join(','))].join('\r\n')+'\r\n';
const files={'traceability.csv':traceability,'release-review.pdf':await validationReviewPdf(pack),'validation.json':JSON.stringify(pack,null,2)+'\n','execution.ndjson':result.stdout,
 'review.md':['# Pharmaceutical release validation','',sha,'',pack.environment,'',pack.scope,'',...rows.map(r=>'- '+r.id+' · '+r.result+' · '+r.requirement+' ('+r.file+':'+r.line+')'),'','## Changes since '+parent,'',...pack.changes.map(path=>'- '+path),''].join('\n')};
const checksums=[];for(const [name,value] of Object.entries(files)){writeFileSync(dir+'/'+name,value);checksums.push(createHash('sha256').update(value).digest('hex')+'  '+name);}
writeFileSync(dir+'/SHA256SUMS',checksums.join('\n')+'\n');console.log(rows.length+' executed requirements for '+sha);
