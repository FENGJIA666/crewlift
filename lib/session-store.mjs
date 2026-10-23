import {randomUUID} from 'node:crypto';
import {AppError} from './constraints.mjs';

const unavailable=()=>new AppError('STORE_UNAVAILABLE','Your workspace is reconnecting. Please try again shortly.',503);
const busy=()=>new AppError('RUN_IN_PROGRESS','Wait for the current workspace operation to finish.',409);

// Local development and deterministic tests. Production uses the durable implementation.
export class MemorySessionStore {
  constructor(){this.states=new Map();this.locks=new Set();this.ledger=null;this.sessionCalls=new Map();}
  async read(id,initial){if(!this.states.has(id))this.states.set(id,initial());return structuredClone(this.states.get(id));}
  async transact(id,initial,operation){
    if(this.locks.has(id))throw busy();
    this.locks.add(id);
    try{const state=await this.read(id,initial),result=await operation(state);this.states.set(id,structuredClone(state));return result;}
    finally{this.locks.delete(id);}
  }
  async initializeQuota(limit){if(this.ledger===null)this.ledger={limit,used:0};return {...this.ledger};}
  async reserveLive(id,limit){
    if(!limit||!this.ledger)throw new AppError('LIVE_DISABLED','Live interpretation is awaiting its next demo allocation.',409);
    if(this.ledger.used>=Math.min(limit,this.ledger.limit))throw new AppError('LIVE_QUOTA_REACHED','This demo allocation is complete. Explore the planning controls and exported examples.',429);
    const previous=this.sessionCalls.get(id)||{count:0,last:0},now=Date.now();
    if(previous.count>=5)throw new AppError('SESSION_RATE_LIMIT','This session has completed its live previews. Continue with the planning controls.',429);
    if(now-previous.last<30000)throw new AppError('SESSION_RATE_LIMIT','Your next live preview is available in 30 seconds.',429);
    this.ledger.used++;this.sessionCalls.set(id,{count:previous.count+1,last:now});return {used:this.ledger.used,limit:Math.min(limit,this.ledger.limit)};
  }
}

// The lock token is checked again when writing: a timed-out worker cannot overwrite
// a newer worker after its lease expires. Quota records deliberately never expire.
export const STORE_LUA={
  read:"local v=redis.call('GET',KEYS[1]); if not v then redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); return ARGV[1] end; return v",
  save:"if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3]); return 1",
  unlock:"if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
  initialize:"local v=redis.call('GET',KEYS[1]); if v then return v end; local value=cjson.encode({limit=tonumber(ARGV[1]),used=0}); redis.call('SET',KEYS[1],value); return value",
  reserve:"local raw=redis.call('GET',KEYS[1]); if not raw then return {-1,0} end; local q=cjson.decode(raw); local limit=math.min(tonumber(ARGV[1]),q.limit); if limit<=0 then return {-1,q.used} end; if q.used>=limit then return {0,q.used} end; local r=redis.call('GET',KEYS[2]); local s={count=0,last=0}; if r then s=cjson.decode(r) end; if s.count>=5 then return {-2,q.used} end; local t=redis.call('TIME'); local now=tonumber(t[1]); if now-s.last<30 then return {-3,q.used} end; q.used=q.used+1; s.count=s.count+1; s.last=now; redis.call('SET',KEYS[1],cjson.encode(q)); redis.call('SET',KEYS[2],cjson.encode(s),'EX',86400); return {1,q.used}",
};

export class RedisSessionStore {
  constructor({url,token,namespace='crewlift-production',fetchImpl=fetch,ttlSeconds=86400,leaseMs=60000}={}){
    if(!url||!token||!/^https:\/\//.test(url)||!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace))throw unavailable();
    this.url=url.replace(/\/$/,'');this.token=token;this.namespace=namespace;this.fetchImpl=fetchImpl;this.ttlSeconds=ttlSeconds;this.leaseMs=leaseMs;
  }
  key(suffix){return `${this.namespace}:${suffix}`;}
  async command(...command){
    try{const response=await this.fetchImpl(this.url,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw unavailable();const payload=await response.json();if(payload.error||!Object.hasOwn(payload,'result'))throw unavailable();return payload.result;
    }catch{throw unavailable();}
  }
  async read(id,initial){const value=await this.command('EVAL',STORE_LUA.read,1,this.key(`session:${id}`),JSON.stringify(initial()),this.ttlSeconds);try{return JSON.parse(value);}catch{throw unavailable();}}
  async transact(id,initial,operation){
    const lock=this.key(`lock:${id}`),token=randomUUID();
    if(await this.command('SET',lock,token,'NX','PX',this.leaseMs)!=='OK')throw busy();
    try{const state=await this.read(id,initial),result=await operation(state);
      const saved=await this.command('EVAL',STORE_LUA.save,2,lock,this.key(`session:${id}`),token,JSON.stringify(state),this.ttlSeconds);
      if(saved!==1)throw new AppError('SESSION_CHANGED','Your workspace changed while this request completed. Build fresh plans.',409);
      return result;
    }finally{try{await this.command('EVAL',STORE_LUA.unlock,1,lock,token);}catch{/* Lease expires; never disclose storage credentials. */}}
  }
  async initializeQuota(limit){if(!Number.isInteger(limit)||limit<1)throw new Error('Choose an explicit positive request allocation.');return JSON.parse(await this.command('EVAL',STORE_LUA.initialize,1,this.key('live-quota'),limit));}
  async reserveLive(id,limit){
    if(!Number.isInteger(limit)||limit<=0)throw new AppError('LIVE_DISABLED','Live interpretation is awaiting its next demo allocation.',409);
    const [status,used]=await this.command('EVAL',STORE_LUA.reserve,2,this.key('live-quota'),this.key(`live-session:${id}`),limit);
    if(status===-1)throw new AppError('LIVE_DISABLED','Live interpretation is awaiting its next demo allocation.',409);
    if(status===-3)throw new AppError('SESSION_RATE_LIMIT','Your next live preview is available in 30 seconds.',429);
    if(status===-2)throw new AppError('SESSION_RATE_LIMIT','This session has completed its live previews. Continue with the planning controls.',429);
    if(status!==1)throw new AppError('LIVE_QUOTA_REACHED','This demo allocation is complete. Explore the planning controls and exported examples.',429);
    return {used,limit};
  }
}
