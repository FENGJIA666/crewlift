import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {AppError,validateConstraints,manualProvenance} from './lib/constraints.mjs';
import {solvePlans} from './lib/solver.mjs';
import {MODEL,interpretBrief} from './lib/nebius.mjs';
import {exportPlan} from './lib/export.mjs';
import {MemorySessionStore} from './lib/session-store.mjs';
import {publicSession} from './lib/public-session.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url)), PUBLIC=resolve(ROOT,'public');
const ORIGINAL=JSON.parse(await readFile(resolve(ROOT,'fixtures/scenario.json'),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const freshRevision=()=>({id:`baseline-${randomUUID()}`,number:0,acceptedAt:null,runId:null,planId:null});
const freshState=()=>({scenario:structuredClone(ORIGINAL),revision:freshRevision(),runs:[],acceptedRuns:{}});
const snapshot=state=>({...structuredClone(state.scenario),revision:structuredClone(state.revision)});
const reply=value=>({status:200,value});

async function readBody(req){
  if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError('CONTENT_TYPE','Send JSON with Content-Type: application/json.',415);
  let text;
  if(req.body!==undefined)text=typeof req.body==='string'?req.body:Buffer.isBuffer(req.body)?req.body.toString('utf8'):JSON.stringify(req.body);
  else{let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>32768)throw new AppError('BODY_TOO_LARGE','Keep requests within 32 KB.',413);chunks.push(chunk);}text=Buffer.concat(chunks).toString('utf8');}
  if(Buffer.byteLength(text)>32768)throw new AppError('BODY_TOO_LARGE','Keep requests within 32 KB.',413);
  try{const body=JSON.parse(text||'{}');if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body;}catch{throw new AppError('INVALID_JSON','Send a valid JSON object.');}
}

export function createHandler({apiKey=process.env.NEBIUS_API_KEY,interpreter=interpretBrief,store=new MemorySessionStore(),publicOrigin=null,sessionSecret=null,liveRequestLimit=0,pricingCheck=async()=>{}}={}){
  const published=Boolean(publicOrigin),sessions=published?publicSession({secret:sessionSecret,origin:publicOrigin}):null;
  if(!Number.isInteger(liveRequestLimit)||liveRequestLimit<0)throw new Error('Choose a nonnegative integer live request allocation.');
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  const config=state=>({app:'CrewLift',model:MODEL,liveAvailable:Boolean(apiKey?.trim())&&(!published||liveRequestLimit>0),modes:['sample','live'],revision:state.revision,storage:published?'Your isolated browser workspace (24 hours)':'This local session',constraintSemantics:'replace',...(published?{liveRequestLimit}: {})});
  async function mutate(path,body,state,sessionId){
    if(path==='/api/plan'){
      const mode=body.mode??'sample';if(!['sample','live'].includes(mode))throw new AppError('INVALID_MODE','Choose sample or live mode.');
      const started=performance.now(),baselineRevision=structuredClone(state.revision),current=snapshot(state);
      let constraints,provenance,model=null,requestedModel=null,returnedModel=null,usage=null,provider=null,inferenceDurationMs=null,questions=[];
      if(mode==='live'){
        if(!apiKey?.trim())throw new AppError('NEBIUS_NOT_CONFIGURED','Connect your Nebius Token Factory account to turn a brief into reviewable constraints.',409);
        if(published){
          if(typeof body.brief!=='string'||body.brief.trim().length<3||Buffer.byteLength(body.brief)>6000)throw new AppError('INVALID_BRIEF','Write a complete change brief within 6,000 UTF-8 bytes.');
          if(liveRequestLimit<=0)throw new AppError('LIVE_DISABLED','Live interpretation is awaiting its next demo allocation.',409);
          await pricingCheck();
          await store.reserveLive(sessionId,liveRequestLimit);
        }
        const interpreted=await interpreter(body.brief,current,{apiKey,...(published?{maximumRequestBytes:16384}: {})});
        ({constraints,provenance,model,requestedModel,returnedModel,usage,provider,questions}=interpreted);inferenceDurationMs=interpreted.durationMs;
      }else{constraints=validateConstraints(body.constraints??current.initialConstraints,current);provenance=manualProvenance(constraints);}
      const result=solvePlans(current,constraints),id=randomUUID();
      const run={id,createdAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started),inferenceDurationMs,model,requestedModel,returnedModel,usage,provider,baselineRevision,inputHash:sha({scenario:current,constraints,brief:mode==='live'?body.brief:null}),outputHash:sha(result.plans)};
      const record={scenarioId:current.id,scenario:current,mode,label:mode==='live'?'Sample scenario · live Nemotron interpretation':'Sample scenario · local constraint solver',constraints,provenance,questions,...result,run};
      state.runs.push(record);while(state.runs.length>(published?5:40)){const removed=state.runs.shift();delete state.acceptedRuns[removed.run.id];}
      return reply(record);
    }
    if(path==='/api/accept'){
      const record=state.runs.find(r=>r.run.id===body.runId),plan=record?.plans.find(p=>p.id===body.planId);
      if(!plan)throw new AppError('RUN_NOT_FOUND','Run recovery and choose a plan before accepting.',404);
      const acceptedReply=()=>reply({revision:state.revision,scenario:snapshot(state),acceptedPlanId:body.planId,acceptedRunId:body.runId,delta:{changedPeople:plan.metrics.changedPeople,changeCards:plan.changeCards}});
      if(state.revision.runId===body.runId&&state.revision.planId===body.planId)return acceptedReply();
      if(record.run.baselineRevision.id!==state.revision.id)throw new AppError('STALE_BASELINE','A newer plan is already accepted. Run recovery from the current baseline.',409);
      if(record.questions?.length)throw new AppError('REVIEW_REQUIRED','Resolve the brief’s open questions with structured controls before accepting.',422);
      if(plan.metrics.coveredSeats<plan.metrics.requiredSeats)throw new AppError('COVERAGE_REQUIRED','Complete the remaining coverage actions before accepting this roster.',422);
      state.scenario={...structuredClone(state.scenario),tasks:state.scenario.tasks.map(t=>({...t,initialAssignees:[...plan.assignments.find(a=>a.taskId===t.id).volunteerIds]})),initialConstraints:structuredClone(record.constraints)};
      state.revision={id:randomUUID(),number:state.revision.number+1,acceptedAt:new Date().toISOString(),runId:body.runId,planId:body.planId};state.acceptedRuns[body.runId]=structuredClone(state.revision);
      return acceptedReply();
    }
    if(path==='/api/reset'){Object.assign(state,freshState());return reply({revision:state.revision,scenario:snapshot(state)});}
    throw new AppError('NOT_FOUND','This API route does not exist.',404);
  }
  return async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1'),host=req.headers.host??'';
      if(sessions)sessions.check(req);
      else{
        if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))throw new AppError('LOCAL_ONLY','Use the local CrewLift address.',403);
        if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==host)throw new AppError('ORIGIN_MISMATCH','Open CrewLift from this local address before editing.',403);
      }
      if(url.pathname.startsWith('/api/')){
        let sessionId=sessions?sessions.read(req):'local';
        // The UI fetches config and scenario concurrently. Only scenario creates a
        // cookie, so the two initial responses cannot issue competing session IDs.
        if(req.method==='GET'&&(url.pathname==='/api/config'||url.pathname==='/api/health'))return json(res,200,config(sessionId?await store.read(sessionId,freshState):freshState()));
        if(req.method==='GET'&&url.pathname==='/api/scenario'){
          if(!sessionId)sessionId=sessions.create(res);return json(res,200,snapshot(await store.read(sessionId,freshState)));
        }
        if(req.method==='POST'){
          if(!sessionId)throw new AppError('SESSION_REQUIRED','Open the event workspace before creating a plan.',409);
          const body=await readBody(req);
          if(url.pathname==='/api/export'){
            const state=await store.read(sessionId,freshState),record=state.runs.find(r=>r.run.id===body.runId);
            if(!record)throw new AppError('RUN_NOT_FOUND','Run recovery again to create a fresh export.',404);
            const accepted=state.acceptedRuns[body.runId],exportRevision=accepted?.planId===body.planId?accepted:null,file=exportPlan(record,body.planId,body.format,exportRevision);
            if(!file)throw new AppError('INVALID_EXPORT','Choose a known plan and json, csv, or brief format.');
            res.writeHead(200,{'Content-Type':file.type,'Content-Disposition':`attachment; filename="crewlift-${body.planId}-${exportRevision?`r${exportRevision.number}`:'draft'}.${file.extension}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(file.content);return;
          }
          if(!['/api/plan','/api/accept','/api/reset'].includes(url.pathname))throw new AppError('NOT_FOUND','This API route does not exist.',404);
          const result=await store.transact(sessionId,freshState,state=>mutate(url.pathname,body,state,sessionId));return json(res,result.status,result.value);
        }
        throw new AppError('NOT_FOUND','This API route does not exist.',404);
      }
      if(req.method!=='GET')throw new AppError('METHOD_NOT_ALLOWED','Use GET for this route.',405);
      const file=resolve(PUBLIC,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(PUBLIC+'/'))throw new AppError('NOT_FOUND','This file does not exist.',404);
      let content;try{content=await readFile(file);}catch{throw new AppError('NOT_FOUND','This page is being prepared.',404);}
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(content);
    }catch(error){const known=error instanceof AppError;json(res,known?error.status:500,{error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'CrewLift could not complete this request. Please try again.',...(known&&error.modelIdentity?{modelIdentity:error.modelIdentity}:{}),...(known&&error.provider?{provider:error.provider}:{}),...(!published&&known&&error.extraction?{extraction:error.extraction}:{})}});}
  };
}

export function createApp(options={}){return http.createServer(createHandler(options));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT??4187);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Choose a valid PORT.');
  createApp().listen(port,'127.0.0.1',()=>console.log(`CrewLift ready at http://127.0.0.1:${port}`));
}
