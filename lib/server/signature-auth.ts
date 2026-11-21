import {createHash} from 'node:crypto';
import {z} from 'zod';
import {verifyAiIdentity,type VerifiedWorkspaceIdentity,AccessError} from './ai-auth';

export type SignatureAuthentication={externalId:string;email:string;sessionHash:string;authenticatedAt:Date;method:string;verifiedAt:Date};
const claimsSchema=z.object({sub:z.uuid(),aud:z.literal('authenticated'),exp:z.number().int().positive(),session_id:z.uuid(),amr:z.array(z.object({method:z.string().min(1).max(40),timestamp:z.number().int().positive()}).passthrough()).min(1).max(20)}).passthrough();
/** Only call after this exact bearer token has been accepted by Supabase /auth/v1/user.
 * A refreshed token's iat is deliberately never treated as renewed authentication. */
export function signatureAuthenticationFromVerifiedToken(token:string,identity:VerifiedWorkspaceIdentity,now=new Date()):SignatureAuthentication{
 let claims:z.infer<typeof claimsSchema>;try{const segments=token.split('.');if(segments.length!==3)throw Error();claims=claimsSchema.parse(JSON.parse(Buffer.from(segments[1],'base64url').toString('utf8')));}catch{throw new AccessError('A verified sign-in session is required for document authorisation',401);}
 if(claims.sub!==identity.externalId||claims.exp*1000<=now.getTime())throw new AccessError('The document authorisation session does not match the current user',401);
 const method=claims.amr.filter(item=>['otp','magiclink','password','oauth','totp','sso/saml','invite','email/signup'].includes(item.method)).sort((a,b)=>b.timestamp-a.timestamp)[0];
 if(!method||method.timestamp*1000>now.getTime()+5000)throw new AccessError('The sign-in authentication time could not be established',401);
 return {externalId:identity.externalId,email:identity.email,sessionHash:createHash('sha256').update(claims.session_id).digest('hex'),authenticatedAt:new Date(method.timestamp*1000),method:method.method,verifiedAt:now};
}
export async function verifySignatureAuthentication(request:Request){const identity=await verifyAiIdentity(request);return signatureAuthenticationFromVerifiedToken(request.headers.get('authorization')!.slice(7),identity);}
export function freshSignatureAuthentication(auth:SignatureAuthentication,challenge:{baselineSessionHash:string;createdAt:Date;expiresAt:Date;consumedAt:Date|null},user:{externalId:string;email:string},now=new Date()){
 if(auth.externalId!==user.externalId||auth.email.toLowerCase()!==user.email.toLowerCase())throw new AccessError('Use the same assigned signatory account that requested this challenge',403);
 if(challenge.consumedAt||challenge.expiresAt<=now)throw new AccessError('This authorisation challenge was used or expired. Request a new challenge.',409);
 if(auth.sessionHash===challenge.baselineSessionHash||!['otp','magiclink'].includes(auth.method)||auth.authenticatedAt.getTime()<Math.floor(challenge.createdAt.getTime()/1000)*1000||auth.authenticatedAt.getTime()>now.getTime()+5000||now.getTime()-auth.verifiedAt.getTime()>60000)throw new AccessError('Open a newly requested email sign-in link for this account, then confirm the document authorisation',409);
}
