import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/workspace/integrations/route';
import {PATCH} from '../app/api/workspace/integrations/endpoints/[id]/route';
import {POST as replay} from '../app/api/workspace/integrations/deliveries/[id]/replay/route';
test('delivery administration authenticates before parsing, queueing probes, creating secrets or replaying network work',async()=>{
 const id=randomUUID(),args={params:Promise.resolve({id})},request=()=>new Request('https://example.invalid/api/workspace/integrations?organizationId='+id,{method:'POST',body:'invalid',headers:{'Content-Type':'application/json'}});
 Object.assign(process.env,{REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_WORKSPACE_ENABLED:'false'});
 for(const call of [()=>GET(request()),()=>POST(request()),()=>PATCH(request(),args),()=>replay(request(),args)])assert.equal((await call()).status,503);
 process.env.REGPILOT_WORKSPACE_ENABLED='true';for(const call of [()=>GET(request()),()=>POST(request()),()=>PATCH(request(),args),()=>replay(request(),args)]){const response=await call();assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');}
});
