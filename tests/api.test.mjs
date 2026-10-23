import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

async function app(t){const server=createApp({apiKey:''});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;return {get:async path=>(await fetch(base+path)).json(),post:async(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};}
test('API runs, accepts, revises, rejects stale acceptance and exports both revisions',async t=>{
  const a=await app(t),s=await a.get('/api/scenario');const first=await(await a.post('/api/plan',{mode:'sample',constraints:s.initialConstraints})).json();
  assert.equal(first.mode,'sample');assert.equal(first.run.model,null);assert.equal(first.plans[0].metrics.coveredSeats,10);
  const accepted=await(await a.post('/api/accept',{runId:first.run.id,planId:'minimal-change'})).json();assert.equal(accepted.revision.number,1);
  const stable=await(await a.post('/api/plan',{mode:'sample',constraints:s.initialConstraints})).json();assert.equal(stable.plans[0].metrics.changedPeople,0);
  const secondConstraints=structuredClone(s.initialConstraints);secondConstraints.capacity=[{volunteerId:'ben',maxAssignments:2}];
  const second=await(await a.post('/api/plan',{mode:'sample',constraints:secondConstraints})).json();assert.equal(second.run.baselineRevision.number,1);assert(second.plans[0].metrics.changedPeople>0);
  const accepted2=await(await a.post('/api/accept',{runId:second.run.id,planId:'balanced'})).json();assert.equal(accepted2.revision.number,2);
  const stale=await a.post('/api/accept',{runId:stable.run.id,planId:'minimal-change'});assert.equal(stale.status,409);assert.equal((await stale.json()).error.code,'STALE_BASELINE');
  for(const [record,planId,number]of [[first,'minimal-change',1],[second,'balanced',2]]){const r=await a.post('/api/export',{runId:record.run.id,planId,format:'json'});assert.equal(r.status,200);const pack=await r.json();assert.equal(pack.revision.number,number);assert.equal(pack.plan.id,planId);assert(pack.provenance.length>0);}
  const csv=await a.post('/api/export',{runId:second.run.id,planId:'balanced',format:'csv'});assert.match(csv.headers.get('content-type'),/text\/csv/);assert.match(await csv.text(),/"revision","run_id"/);
  const txt=await a.post('/api/export',{runId:second.run.id,planId:'balanced',format:'brief'});assert.match(await txt.text(),/PERSONAL HANDOFF CARDS/);
});
test('reset creates a fresh baseline and clears prior run authority',async t=>{
  const a=await app(t),s=await a.get('/api/scenario'),r=await(await a.post('/api/plan',{mode:'sample'})).json();
  const reset=await(await a.post('/api/reset',{})).json();assert.equal(reset.revision.number,0);assert.notEqual(reset.revision.id,s.revision.id);
  assert.equal((await a.post('/api/accept',{runId:r.run.id,planId:'minimal-change'})).status,404);
});
test('live mode cannot report inference without a key',async t=>{
  const a=await app(t),config=await a.get('/api/config');assert.equal(config.liveAvailable,false);
  const r=await a.post('/api/plan',{mode:'live',brief:'Ava cannot attend.'});assert.equal(r.status,409);assert.equal((await r.json()).error.code,'NEBIUS_NOT_CONFIGURED');
});
test('partial coverage stays reviewable and cannot become an accepted full roster',async t=>{
  const a=await app(t),r=await(await a.post('/api/plan',{mode:'sample',constraints:{demand:[{taskId:'workshop-2',required:8}]}})).json();
  assert(r.plans[0].metrics.coveragePct<100);const acceptance=await a.post('/api/accept',{runId:r.run.id,planId:'minimal-change'});assert.equal(acceptance.status,422);assert.equal((await acceptance.json()).error.code,'COVERAGE_REQUIRED');
});
