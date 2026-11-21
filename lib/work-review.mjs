import {WorkInputError,workDate,workUuid} from './work-hub.mjs';
import {parseWorkCompletion} from './work-completion.mjs';
export const WORK_REVIEW_PAGE_SIZE=25;
export const WORK_REVIEW_SCOPE='This compares recorded proof with current workspace records. No recorded changes detected is not a new verification of file bytes or a guarantee of continuing compliance. Fresh verification checks selected stored files and saves a separate review record; historical completion and follow-up status remain unchanged.';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function parseWorkReviewQuery(params){
 const q=(params.get('q')||'').trim(),page=params.get('page')||'1';
 if(q.length>120||/[\u0000-\u001f]/.test(q))throw new WorkInputError('Search must contain at most 120 characters.');
 if(!/^[1-9]\d{0,5}$/.test(page))throw new WorkInputError('Choose a valid results page.');
 return {q,page:Number(page)};
}
export function parseWorkReviewFollowUp(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['phase','reviewToken','assigneeId','dueDate','reason','token','confirm'].includes(key)))throw new WorkInputError('Review one finding and choose its follow-up plan.');
 if(!['preview','apply'].includes(input.phase)||!hash(input.reviewToken)||!workUuid(input.assigneeId))throw new WorkInputError('Refresh the review and choose an authorised owner.');
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 if(reason.length<20||reason.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason))throw new WorkInputError('Explain the follow-up in 20 to 500 characters.');
 if(input.phase==='apply'&&(!hash(input.token)||input.confirm!==true))throw new WorkInputError('Preview and explicitly confirm this follow-up before creating it.');
 if(input.phase==='preview'&&(input.token!==undefined||input.confirm!==undefined))throw new WorkInputError('Preview the follow-up before confirming it.');
 return {phase:input.phase,reviewToken:input.reviewToken,assigneeId:input.assigneeId.toLowerCase(),dueDate:workDate(input.dueDate),reason,...(input.phase==='apply'?{token:input.token,confirm:true}:{})};
}
export const parseWorkVerification=parseWorkCompletion;
