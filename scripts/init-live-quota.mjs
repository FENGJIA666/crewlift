import {RedisSessionStore} from '../lib/session-store.mjs';

// Run deliberately after an explicit request allocation is authorized. The
// existing ledger always wins; redeploying or rerunning cannot reset spending.
const limit=Number(process.env.CREWLIFT_LIVE_REQUEST_LIMIT??0);
if(!Number.isInteger(limit)||limit<1)throw new Error('Set an explicitly authorized positive CREWLIFT_LIVE_REQUEST_LIMIT.');
const store=new RedisSessionStore({url:process.env.UPSTASH_REDIS_REST_URL??process.env.KV_REST_API_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN??process.env.KV_REST_API_TOKEN,namespace:process.env.CREWLIFT_STORE_NAMESPACE??'crewlift-production'});
try{console.log(JSON.stringify({ledger:await store.initializeQuota(limit),message:'Existing ledgers are preserved. No inference was requested.'},null,2));}
catch{console.error('Quota initialization did not complete. Check storage access locally. No inference was requested.');process.exitCode=1;}
