import {NextResponse} from 'next/server';
import {AccessError} from './ai-auth';
import {IntelligenceError} from './intelligence-service';
import {EvidenceError} from '../evidence/file-guard.mjs';
import {WorkInputError} from '../work-hub.mjs';
export const reviewReply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function reviewFailure(error:unknown){
 if(error instanceof AccessError||error instanceof IntelligenceError||error instanceof EvidenceError||error instanceof WorkInputError)return reviewReply({error:error.message},error.status);
 if(error instanceof SyntaxError)return reviewReply({error:'Invalid JSON'},400);
 return reviewReply({error:'The review could not be verified. Refresh its latest state before confirming another action.'},503);
}
