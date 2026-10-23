import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {RedisSessionStore} from '../lib/session-store.mjs';

const namespace=`crewlift-verification-${randomUUID().slice(0,8)}`;
const options={url:process.env.UPSTASH_REDIS_REST_URL??process.env.KV_REST_API_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN??process.env.KV_REST_API_TOKEN,namespace};
const a=new RedisSessionStore(options),b=new RedisSessionStore(options),keys=new Set();
const track=suffix=>{const key=a.key(suffix);keys.add(key);return key;};
const checks=[];
try{
  track('live-quota');assert.deepEqual(await a.initializeQuota(2),{limit:2,used:0});
  const candidates=Array.from({length:6},(_,i)=>`person-${i}`);for(const id of candidates)track(`live-session:${id}`);
  const calls=await Promise.allSettled(candidates.map((id,i)=>(i%2?a:b).reserveLive(id,2)));
  assert.equal(calls.filter(x=>x.status==='fulfilled').length,2);assert(calls.filter(x=>x.status==='rejected').every(x=>x.reason.code==='LIVE_QUOTA_REACHED'));
  assert.deepEqual(await b.initializeQuota(100),{limit:2,used:2});
  checks.push('Six parallel reservations across two Redis clients admitted exactly two; reinitialization preserved the exhausted ledger.');

  for(const id of ['one','two','fenced']){track(`session:${id}`);track(`lock:${id}`);}
  await a.transact('one',()=>({revision:0}),s=>{s.revision=1;});
  assert.equal((await b.read('one',()=>({revision:0}))).revision,1);
  assert.equal((await b.read('two',()=>({revision:0}))).revision,0);
  let enter,release;const entered=new Promise(r=>enter=r),released=new Promise(r=>release=r);
  const pending=a.transact('one',()=>({revision:0}),async s=>{enter();await released;s.revision=2;});
  await entered;await assert.rejects(()=>b.transact('one',()=>({revision:0}),()=>{}),{code:'RUN_IN_PROGRESS'});release();await pending;
  assert.equal((await b.read('one',()=>({revision:0}))).revision,2);
  checks.push('Session state persisted between workers; separate sessions remained isolated; simultaneous same-session mutation was rejected.');

  await assert.rejects(()=>a.transact('fenced',()=>({revision:0}),async s=>{await b.command('SET',b.key('lock:fenced'),'new-worker','PX',60000);s.revision=99;}),{code:'SESSION_CHANGED'});
  assert.equal((await b.read('fenced',()=>({revision:0}))).revision,0);
  assert.equal(await b.command('GET',b.key('lock:fenced')),'new-worker');
  checks.push('A superseded lease could neither save its stale state nor delete the newer worker lock.');

  await a.command('DEL',a.key('live-quota'));
  await assert.rejects(()=>b.reserveLive('new',100),{code:'LIVE_DISABLED'});
  await a.initializeQuota(10);
  track('live-session:cooldown');await a.reserveLive('cooldown',10);
  await assert.rejects(()=>b.reserveLive('cooldown',10),{code:'SESSION_RATE_LIMIT'});
  track('live-session:spent');await a.command('SET',a.key('live-session:spent'),JSON.stringify({count:5,last:0}),'EX',86400);
  await assert.rejects(()=>b.reserveLive('spent',10),{code:'SESSION_RATE_LIMIT'});
  assert.equal((await a.initializeQuota(100)).used,1);
  checks.push('A missing ledger disabled requests; the 30-second interval and five-call session allowance rejected requests without consuming more global quota.');
}finally{
  if(keys.size)await a.command('DEL',...keys);
}
const hashes={};for(const path of ['lib/session-store.mjs','lib/public-session.mjs','lib/live-budget.mjs','server.mjs','api/index.mjs'])hashes[path]=createHash('sha256').update(await readFile(new URL(`../${path}`,import.meta.url))).digest('hex');
const report={createdAt:new Date().toISOString(),success:true,scope:'Real durable Redis; isolated disposable verification namespace; no model inference.',checks,cleanedUp:true,sourceHashes:hashes};
await mkdir(new URL('../evidence/deployment/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/deployment/store-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
