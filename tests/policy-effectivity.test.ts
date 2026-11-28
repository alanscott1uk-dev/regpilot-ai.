import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DOCUMENT_ATTESTATION_MEANING,preparePolicyReleaseSchema,signatureChallengeSchema,signPolicyReleaseSchema} from '../lib/policy-effectivity';
import {signatureAuthenticationFromVerifiedToken,freshSignatureAuthentication} from '../lib/server/signature-auth';

const now=new Date('2026-11-20T12:00:20.000Z'),subject=randomUUID(),session=randomUUID(),identity={externalId:subject,email:'reviewer@example.invalid'};
const token=(changes:Record<string,unknown>={})=>['header',Buffer.from(JSON.stringify({sub:subject,aud:'authenticated',exp:Math.floor(now.getTime()/1000)+3600,session_id:session,amr:[{method:'otp',timestamp:Math.floor(now.getTime()/1000)-10}],...changes})).toString('base64url'),'signature'].join('.');
const challenge={baselineSessionHash:'0'.repeat(64),createdAt:new Date('2026-11-20T12:00:00.500Z'),expiresAt:new Date('2026-11-20T12:15:00.500Z'),consumedAt:null};
test('fresh authorisation is tied to verified identity, a new authentication session and method time rather than token refresh',()=>{
 const auth=signatureAuthenticationFromVerifiedToken(token(),identity,now);assert.doesNotThrow(()=>freshSignatureAuthentication(auth,challenge,identity,now));assert.notEqual(auth.sessionHash,session);assert.match(auth.sessionHash,/^[a-f0-9]{64}$/);assert.equal(auth.method,'otp');
 assert.throws(()=>freshSignatureAuthentication(auth,{...challenge,baselineSessionHash:auth.sessionHash},identity,now),/newly requested email/);
 const refreshed=signatureAuthenticationFromVerifiedToken(token({iat:Math.floor(now.getTime()/1000),amr:[{method:'otp',timestamp:Math.floor(now.getTime()/1000)-1000}]}),identity,now);assert.throws(()=>freshSignatureAuthentication(refreshed,challenge,identity,now),/newly requested email/);
 assert.throws(()=>freshSignatureAuthentication({...auth,method:'oauth'},challenge,identity,now),/newly requested email/);
 assert.throws(()=>signatureAuthenticationFromVerifiedToken(token({sub:randomUUID()}),identity,now),/does not match/);
 assert.throws(()=>signatureAuthenticationFromVerifiedToken(token({amr:[]}),identity,now),/verified sign-in/);
});
test('expired, consumed, wrong-account and no-longer-verified authentication cannot authorise a release',()=>{
 const auth=signatureAuthenticationFromVerifiedToken(token(),identity,now);
 assert.throws(()=>freshSignatureAuthentication(auth,{...challenge,expiresAt:now},identity,now),/expired/);
 assert.throws(()=>freshSignatureAuthentication(auth,{...challenge,consumedAt:now},identity,now),/used/);
 assert.throws(()=>freshSignatureAuthentication(auth,challenge,{...identity,externalId:randomUUID()},now),/same assigned/);
 assert.throws(()=>freshSignatureAuthentication({...auth,verifiedAt:new Date(now.getTime()-61000)},challenge,identity,now),/newly requested email/);
 assert.throws(()=>signatureAuthenticationFromVerifiedToken(token({exp:1}),identity,now),/does not match/);
});
test('release plans and sign requests accept only explicit bounded choices and cannot supply authentication metadata',()=>{
 const plan={requestKey:randomUUID(),policyId:randomUUID(),revisionId:randomUUID(),policyVersion:1,revisionVersion:1,plannedEffectiveAt:now.toISOString(),trainingMode:'NONE',changeReason:'This fictional revision changes the operating checks and its controlled date of effectivity.',readerIds:[randomUUID()],training:[],confirm:true};
 assert.equal(preparePolicyReleaseSchema.parse(plan).trainingMode,'NONE');
 for(const altered of [{...plan,readerIds:[plan.readerIds[0],plan.readerIds[0]]},{...plan,confirm:false},{...plan,trainingMode:'AUTOMATIC_CERTIFICATION'},{...plan,attested:true}])assert.equal(preparePolicyReleaseSchema.safeParse(altered).success,false);
 const request={requestKey:randomUUID(),version:1,meaning:DOCUMENT_ATTESTATION_MEANING,reason:plan.changeReason,confirm:true};assert.equal(signatureChallengeSchema.safeParse(request).success,true);
 const sign={requestKey:randomUUID(),version:1,challengeId:randomUUID(),targetHash:'a'.repeat(64),meaning:DOCUMENT_ATTESTATION_MEANING,confirm:true};assert.equal(signPolicyReleaseSchema.safeParse(sign).success,true);assert.equal(signPolicyReleaseSchema.safeParse({...sign,auth:{method:'otp',verifiedAt:now.toISOString()}}).success,false);assert.equal(signPolicyReleaseSchema.safeParse({...sign,meaning:'CERTIFY_GMP_COMPLIANCE'}).success,false);
});
