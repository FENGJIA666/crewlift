import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import {createApp} from '../server.mjs';
import {MemorySessionStore,RedisSessionStore,STORE_LUA} from '../lib/session-store.mjs';
import {AppError} from '../lib/constraints.mjs';
import {MODEL,interpretBrief} from '../lib/nebius.mjs';
import {LIVE_BUDGET,maximumTokenChargeUSD,assertCurrentPricing,assertBoundedPayload} from '../lib/live-budget.mjs';

const origin='https://crewlift.example',secret='test-only-session-secret-that-is-long-enough';
const scenario=JSON.parse(await readFile(new URL('../fixtures/scenario.json',import.meta.url),'utf8'));
const result=()=>({constraints:structuredClone(scenario.initialConstraints),provenance:[],questions:[],model:MODEL,requestedModel:MODEL,returnedModel:MODEL,usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},provider:{},durationMs:1});
async function app(t,store,options={}){
  const server=createApp({store,apiKey:'test-only-key',publicOrigin:origin,sessionSecret:secret,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  return (path,body,cookie,headers={})=>new Promise((resolve,reject)=>{
    const req=http.request(base+path,{method:body===undefined?'GET':'POST',headers:{host:new URL(origin).host,...(body===undefined?{}:{'Content-Type':'application/json',origin}),...(cookie?{cookie}:{}),...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
async function session(api){const response=await api('/api/scenario');assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);return cookie.split(';')[0];}

test('public users remain isolated across worker instances, reset and exports',async t=>{
  const store=new MemorySessionStore(),one=await app(t,store),two=await app(t,store);
  assert.equal((await one('/api/config')).headers.get('set-cookie'),null);
  const a=await session(one),b=await session(two);
  const planned=await(await one('/api/plan',{mode:'sample'},a)).json();
  assert.equal((await two('/api/export',{runId:planned.run.id,planId:'minimal-change',format:'json'},b)).status,404);
  assert.equal((await two('/api/accept',{runId:planned.run.id,planId:'minimal-change'},a)).status,200);
  assert.equal((await(await two('/api/scenario',undefined,a)).json()).revision.number,1);
  assert.equal((await(await one('/api/scenario',undefined,b)).json()).revision.number,0);
  await two('/api/reset',{},b);
  const thirdWorker=await app(t,store);
  assert.equal((await(await thirdWorker('/api/scenario',undefined,a)).json()).revision.number,1);
  const pack=await(await thirdWorker('/api/export',{runId:planned.run.id,planId:'minimal-change',format:'json'},a)).json();
  assert.equal(pack.revision.number,1);assert.equal(pack.run.id,planned.run.id);
});

test('public requests require the published host, same origin and untampered session',async t=>{
  const api=await app(t,new MemorySessionStore()),cookie=await session(api);
  assert.equal((await api('/api/plan',{mode:'sample'},cookie,{host:'other.example'})).status,403);
  assert.equal((await api('/api/plan',{mode:'sample'},cookie,{origin:'https://other.example'})).status,403);
  assert.equal((await api('/api/plan',{mode:'sample'})).status,409);
  const tampered=cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a');
  assert.equal((await api('/api/plan',{mode:'sample'},tampered)).status,409);
});

test('one session cannot reset during inference while another can continue planning',async t=>{
  const store=new MemorySessionStore();await store.initializeQuota(2);
  let enter,finish;const entered=new Promise(r=>enter=r),finished=new Promise(r=>finish=r);
  const api=await app(t,store,{liveRequestLimit:2,interpreter:async()=>{enter();await finished;return result();}});
  const a=await session(api),b=await session(api),running=api('/api/plan',{mode:'live',brief:scenario.defaultBrief},a);
  await entered;
  assert.equal((await api('/api/reset',{},a)).status,409);
  assert.equal((await api('/api/plan',{mode:'sample'},b)).status,200);
  finish();assert.equal((await running).status,200);
});

test('global allocation applies before inference across sessions and survives new workers',async t=>{
  const store=new MemorySessionStore();await store.initializeQuota(2);let calls=0;
  const options={liveRequestLimit:2,interpreter:async()=>{calls++;return result();}},one=await app(t,store,options),two=await app(t,store,options);
  const cookies=await Promise.all([session(one),session(one),session(two)]);
  const responses=await Promise.all(cookies.map((cookie,i)=>(i===2?two:one)('/api/plan',{mode:'live',brief:scenario.defaultBrief},cookie)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,429]);assert.equal(calls,2);
  assert.deepEqual(await store.initializeQuota(100),{used:2,limit:2});
  const nextWorker=await app(t,store,options),fresh=await session(nextWorker);
  assert.equal((await nextWorker('/api/plan',{mode:'live',brief:scenario.defaultBrief},fresh)).status,429);assert.equal(calls,2);
});

test('zero allocation, missing ledger and failed inference never create extra paid attempts',async t=>{
  let calls=0;const interpreter=async()=>{calls++;throw new AppError('MODEL_REVIEW_REQUIRED','Review this brief.',422);};
  const disabled=await app(t,new MemorySessionStore(),{interpreter}),cookie=await session(disabled);
  assert.equal((await(await disabled('/api/config')).json()).liveAvailable,false);
  assert.equal((await disabled('/api/plan',{mode:'live',brief:scenario.defaultBrief},cookie)).status,409);assert.equal(calls,0);
  const store=new MemorySessionStore(),api=await app(t,store,{liveRequestLimit:1,interpreter}),active=await session(api);
  assert.equal((await api('/api/plan',{mode:'live',brief:scenario.defaultBrief},active)).status,409);assert.equal(calls,0);
  await store.initializeQuota(1);
  assert.equal((await api('/api/plan',{mode:'live',brief:scenario.defaultBrief},active)).status,422);
  assert.equal((await api('/api/plan',{mode:'live',brief:scenario.defaultBrief},active)).status,429);assert.equal(calls,1);
});

test('Redis fencing rejects writes after lease loss and hides transport errors',async()=>{
  const commands=[];
  const store=new RedisSessionStore({url:'https://redis.example',token:'test-only-storage-token',fetchImpl:async(_url,options)=>{
    const c=JSON.parse(options.body);commands.push(c);
    const value=c[0]==='SET'?'OK':c[1]===STORE_LUA.read?c[4]:0;
    return new Response(JSON.stringify({result:value}));
  }});
  await assert.rejects(()=>store.transact('session',()=>({revision:0}),state=>{state.revision=1;}),{code:'SESSION_CHANGED'});
  assert.equal(commands.filter(c=>c[1]===STORE_LUA.save).length,1);
  assert.equal(commands.at(-1)[1],STORE_LUA.unlock);
  const failing=new RedisSessionStore({url:'https://redis.example',token:'private-token',fetchImpl:async()=>{throw new Error('private-token connection details');}});
  const error=await failing.reserveLive('session',1).catch(e=>e);assert.equal(error.code,'STORE_UNAVAILABLE');assert(!JSON.stringify(error).includes('private-token'));
});

test('oversized inference payload is rejected before network access',async()=>{
  let called=false;
  await assert.rejects(()=>interpretBrief(scenario.defaultBrief,scenario,{apiKey:'test-only-key',maximumRequestBytes:1,fetchImpl:async()=>{called=true;}}),{code:'REQUEST_TOO_LARGE'});
  assert.equal(called,false);
});

test('public pricing and payload shape enforce the documented conservative cost boundary',async()=>{
  assert(maximumTokenChargeUSD<0.005);assert.equal(maximumTokenChargeUSD,0.00202752);
  for(const outputPrice of [0.24,0.25]){
    const check=()=>assertCurrentPricing({fetchImpl:async()=>new Response(JSON.stringify([{flavors:[{model_id:MODEL,input_price_per_million_tokens:0.06,output_price_per_million_tokens:outputPrice}]}]))});
    if(outputPrice===0.24)await check();else await assert.rejects(check,{code:'PRICING_CHECK_UNAVAILABLE'});
  }
  await assert.rejects(()=>assertCurrentPricing({fetchImpl:async()=>{throw Error('unreachable');}}),{code:'PRICING_CHECK_UNAVAILABLE'});
  const payload={model:MODEL,max_tokens:LIVE_BUDGET.maximumOutputTokens,chat_template_kwargs:{enable_thinking:false},messages:[{role:'system',content:'system'},{role:'user',content:'brief'}]};
  assertBoundedPayload(payload,JSON.stringify(payload));
  for(const changed of [{...payload,max_tokens:4097},{...payload,tools:[{}]},{...payload,messages:[...payload.messages,{role:'user',content:'extra'}]}])assert.throws(()=>assertBoundedPayload(changed,JSON.stringify(changed)),{code:'REQUEST_TOO_LARGE'});
});
