// Explicitly loaded only by the isolated private-service browser test process.
// No production application import, fake-success setting or general outbound interception.
const expected='https://fixture.cognitiveservices.azure.com';
const target=new URL(process.env.REGPILOT_OCR_FIXTURE_URL||'');
if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||!target.port||target.pathname!=='/'||target.username||target.password||target.search||target.hash||process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT!==expected||process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY!=='fictional-ocr-contract-key')throw Error('OCR transport fixture requires the isolated loopback receiver and exact fictional provider credentials');
const realFetch=globalThis.fetch;
globalThis.fetch=async function controlledOcrTransport(input,init){const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.origin!==expected)return realFetch(input,init);if(input instanceof Request)throw Error('The controlled OCR fixture accepts explicit adapter calls only');return realFetch(target.origin+url.pathname+url.search,init);};
