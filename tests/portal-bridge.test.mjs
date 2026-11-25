import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {exchange} from '../public/portal-helper/bridge.js';

test('packaged helper ties a transfer to one reviewer, workspace, questionnaire, original buyer tab and expiry',async()=>{
 const home='https://stage.example.test/team/questionnaires',popup='chrome-extension://test/popup.html',sender={url:home,frameId:0,tab:{id:2}};
 const checked={nonce:randomUUID(),organizationId:randomUUID(),questionnaireId:randomUUID()};
 let pair,clock=Date.now();const focused=[];
 const store={async get(){return {pair};},async set(d){pair=d.pair;},async remove(){pair=null;}};
 const invoke=(m,from=sender,external=true)=>exchange({message:m,sender:from,external,store,home,popup,focus:async id=>focused.push(id),now:clock});
 const reviewer=(action,extra={})=>invoke({action,...checked,...extra});
 const helper=(action,extra={})=>invoke({action,...extra},{url:popup},false);
 for(const foreign of [{...sender,url:'https://buyer.example.test/team/questionnaires'},{...sender,frameId:1},{...sender,url:home+'/other'}]){
  await assert.rejects(invoke({action:'PAIR',...checked},foreign));assert.equal(pair,undefined);
 }
 await reviewer('PAIR',{title:'Vendor review'});
 assert.equal((await helper('INFO',{tab:10})).title,'Vendor review');
 const capture={format:'regpilot-portal-fields-v1',origin:'https://buyer.example.test',pageHash:'a'.repeat(64),fields:['How is access reviewed?']};
 await helper('CAPTURE',{tab:10,nonce:checked.nonce,capture:{...capture,extraAnswer:'do not retain'}});
 assert.deepEqual((await reviewer('READ')).capture,capture);
 await assert.rejects(reviewer('READ',{organizationId:randomUUID()}));await assert.rejects(reviewer('READ',{nonce:randomUUID()}));
 await assert.rejects(invoke({action:'READ',...checked},{...sender,tab:{id:3}}));
 await assert.rejects(helper('CAPTURE',{tab:11,nonce:checked.nonce,capture}));
 const ticket={format:'regpilot-portal-ticket-v1',handoffId:randomUUID(),secret:'r'.repeat(43),origin:capture.origin,pageHash:capture.pageHash,labels:capture.fields,expiresAt:new Date(clock+590000).toISOString()};
 await assert.rejects(reviewer('DELIVER',{ticket:{...ticket,labels:['Unreviewed question']}}));
 await reviewer('DELIVER',{ticket});assert.deepEqual(focused,[2,10]);
 assert.equal((await helper('INFO',{tab:11})).ticket,null);
 assert.equal((await helper('INFO',{tab:10})).ticket.handoffId,ticket.handoffId);
 assert.equal((await reviewer('READ')).ticket,undefined);
 clock+=600000;assert.equal((await helper('INFO',{tab:10})).ticket,null);
 await helper('CLEAR',{tab:10,handoffId:ticket.handoffId});assert.equal(pair,null);
 await reviewer('PAIR');clock+=31*60000;await assert.rejects(reviewer('READ'));
});
test('the packaged extension identity matches the website and has no permanent host permissions',async()=>{
 const manifest=JSON.parse(await readFile('public/portal-helper/manifest.json','utf8'));
 const id=Array.from(createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32),c=>String.fromCharCode(97+Number.parseInt(c,16))).join('');
 const client=await readFile('lib/client/portal-bridge.ts','utf8');assert.ok(client.includes("'"+id+"'"));assert.equal(manifest.host_permissions,undefined);
 assert.equal(manifest.externally_connectable.matches.length,1);assert.equal(manifest.background.service_worker,'worker.js');
});
