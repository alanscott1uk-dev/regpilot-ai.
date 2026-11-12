import {mkdir,writeFile} from 'node:fs/promises';
import * as module from '../lib/horizon/collector.ts';
import * as model from '../lib/horizon/model.ts';
const {collectHorizon,boundedJson}=module.default||module,{PUBLIC_HORIZON_URL}=model.default||model;
let previous=null;try{previous=await boundedJson(PUBLIC_HORIZON_URL);}catch{}
const report=await collectHorizon(previous,fetch,new Date(),{codeCommit:process.env.REGPILOT_VERIFIED_CODE_SHA||process.env.GITHUB_SHA||null,runId:process.env.GITHUB_RUN_ID||null});
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/horizon.json',JSON.stringify(report)+'\n',{mode:0o600});
const unavailable=report.feeds.filter(f=>f.state==='unavailable').length,limited=report.feeds.filter(f=>f.state==='limited').length;
console.log(JSON.stringify({publishers:report.feeds.length,unavailable,limited,publications:report.items.length,previousAvailable:report.previousAvailable,feeds:report.feeds}));
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,`\n### Horizon discovery\n\n${report.items.length} publication records across ${report.feeds.length} selected publishers. ${unavailable} feeds unavailable; ${limited} reached their result limit. Metadata discovery is not a legal decision.\n`,{flag:'a'});
if(unavailable)process.exitCode=1;
