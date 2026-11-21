import test from 'node:test';
import assert from 'node:assert/strict';
import {publicSourceKey} from '../lib/server/shared-source-fetch';
import {REGULATORY_SOURCES} from '../lib/regulatory-sources.mjs';
test('shared retrieval rejects private targets and altered curated identities',()=>{
 const gov=REGULATORY_SOURCES.find(s=>s.id==='uk-data-protection')!;
 assert.equal(publicSourceKey(gov).length,64);
 for(const path of ['https://internal.invalid/secret','/api/secret','//internal/secret','/valid/','/valid?token=secret'])assert.throws(()=>publicSourceKey({...gov,path}));
 const web=REGULATORY_SOURCES.find(s=>s.provider==='OFFICIAL_WEB')!;
 assert.equal(publicSourceKey(web).length,64);
 assert.throws(()=>publicSourceKey({...web,url:'https://internal.invalid/secret'}));
 assert.throws(()=>publicSourceKey({...web,heading:'changed section'}));
 assert.throws(()=>publicSourceKey({...web,id:'unknown-publication'}));
});
