export const EVIDENCE_LIBRARY_PAGE_SIZE=25;
export const EVIDENCE_LIBRARY_USE_LIMIT=10;
export class EvidenceLibraryInputError extends Error {
 constructor(message){super(message);this.name='EvidenceLibraryInputError';this.status=400;}
}
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const options={review:['all','approved','pending','rejected','quarantined'],format:['all','pdf','docx'],uploader:['all','mine']};
/** The 120-file workspace quota keeps numbered pages bounded. Stable date/id sorting is applied by the service. */
export function parseEvidenceLibraryQuery(params){
 const keys=['organizationId','q','review','format','uploader','page','evidenceId','targetQ','targetPage'];
 for(const key of keys)if(params.getAll(key).length>1)throw new EvidenceLibraryInputError('Use one value for each evidence filter');
 const text=key=>{const value=(params.get(key)||'').trim();if(value.length>120||/[\u0000-\u001f\u007f]/.test(value))throw new EvidenceLibraryInputError('Search must contain at most 120 readable characters');return value;};
 const page=key=>{const value=params.get(key)||'1';if(!/^[1-9]\d{0,5}$/.test(value))throw new EvidenceLibraryInputError('Choose a valid evidence page');return Number(value);};
 const select=key=>{const value=params.get(key)||'all';if(!options[key].includes(value))throw new EvidenceLibraryInputError('Choose a recognised evidence filter');return value;};
 const evidenceId=params.get('evidenceId')||null;if(evidenceId&&!uuid(evidenceId))throw new EvidenceLibraryInputError('Invalid evidence identifier');
 return {q:text('q'),review:select('review'),format:select('format'),uploader:select('uploader'),page:page('page'),evidenceId,targetQ:text('targetQ'),targetPage:page('targetPage')};
}
