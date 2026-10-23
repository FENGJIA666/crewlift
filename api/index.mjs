import {createHandler} from '../server.mjs';
import {RedisSessionStore} from '../lib/session-store.mjs';
import {assertCurrentPricing} from '../lib/live-budget.mjs';

let handler;
export default async function api(req,res){
  try{
    if(!process.env.CREWLIFT_PUBLIC_ORIGIN)throw new Error('Public origin is required.');
    handler??=createHandler({
      publicOrigin:process.env.CREWLIFT_PUBLIC_ORIGIN,
      sessionSecret:process.env.CREWLIFT_SESSION_SECRET,
      liveRequestLimit:Number(process.env.CREWLIFT_LIVE_REQUEST_LIMIT??0),
      pricingCheck:assertCurrentPricing,
      store:new RedisSessionStore({url:process.env.UPSTASH_REDIS_REST_URL??process.env.KV_REST_API_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN??process.env.KV_REST_API_TOKEN,namespace:process.env.CREWLIFT_STORE_NAMESPACE??'crewlift-production'}),
    });
    await handler(req,res);
  }catch{
    res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:{code:'DEPLOYMENT_CONFIGURATION',message:'CrewLift is preparing this workspace. Please try again shortly.'}}));
  }
}
