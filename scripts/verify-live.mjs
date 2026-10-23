import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {createApp} from '../server.mjs';
import {MODEL} from '../lib/nebius.mjs';
import {assertGoldenSources,assertObservedModel,tokenCharge,assertCsvExport,assertBriefExport} from './live-assertions.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const running=process.argv.includes('--run');
const apiKeyPresent=Boolean(process.env.NEBIUS_API_KEY?.trim());
const preflight={mode:running?'authorized-live-verification':'preflight-only',apiKeyPresent,requestedModel:MODEL,maximumInferenceRequests:1,maximumCompletionTokens:4096,usesFictionalData:true};
if(!running){
  console.log(JSON.stringify({...preflight,nextStep:apiKeyPresent?'Await account-credit authorization, then rerun with --run.':'Configure an authorized key in the ignored project .env first.'},null,2));
}else if(!apiKeyPresent){
  console.log(JSON.stringify({...preflight,result:'not-run',reason:'API key is not configured.'},null,2));
  process.exitCode=2;
}else{
  const createdAt=new Date().toISOString();
  const report={createdAt,preflight,scope:'One actual NVIDIA inference request; isolated local solver, acceptance, and export verification.',sourceHashes:{},checks:[],success:false,estimatedTokenChargeUSD:null};
  for(const name of ['server.mjs','lib/nebius.mjs','lib/constraints.mjs','lib/solver.mjs','lib/export.mjs','fixtures/scenario.json','scripts/verify-live.mjs','scripts/live-assertions.mjs']){
    report.sourceHashes[name]=createHash('sha256').update(await readFile(resolve(ROOT,name))).digest('hex');
  }
  const server=createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    const scenario=await(await fetch(base+'/api/scenario')).json();
    const brief=scenario.defaultBrief;
    report.brief=brief;
    const response=await post('/api/plan',{mode:'live',brief});
    const result=await response.json();
    if(!response.ok){report.error=result.error;report.estimatedTokenChargeUSD=tokenCharge(result.error?.provider?.usage);throw new Error(`Live request returned HTTP ${response.status}: ${result.error?.code??'UNKNOWN'}`);}
    report.run=result.run;
    report.constraints=result.constraints;
    report.provenance=result.provenance;
    report.questions=result.questions;
    report.planMetrics=result.plans.map(p=>({id:p.id,metrics:p.metrics}));
    assertObservedModel(result.run);
    report.estimatedTokenChargeUSD=tokenCharge(result.run.usage);
    assert.notEqual(report.estimatedTokenChargeUSD,null,'Complete, nonnegative and consistent provider token counts are required; otherwise cost remains unknown.');
    assert(Number.isFinite(result.run.inferenceDurationMs)&&result.run.inferenceDurationMs>0);
    assertGoldenSources(result,brief,scenario);
    report.checks.push('Provider-returned model matches requested model; complete token counts, timing, exact constraints and each constraint’s full supporting clause verified.');
    for(const plan of result.plans){assert.equal(plan.metrics.coveredSeats,10);assert.equal(plan.metrics.requiredSeats,10);assert.equal(plan.metrics.conflicts,0);}
    assert.equal(result.plans[0].metrics.changedPeople,3);
    assert.equal(result.plans[0].metrics.retainedAssignments,7);
    assert.equal(result.plans[1].metrics.maxLoad,2);
    report.checks.push('Both real solver plans cover 10/10 seats; minimum-change plan changes three people and retains seven assignments.');
    const acceptedResponse=await post('/api/accept',{runId:result.run.id,planId:'minimal-change'});
    const accepted=await acceptedResponse.json();
    assert.equal(acceptedResponse.status,200);assert.equal(accepted.revision.number,1);
    report.acceptedRevision=accepted.revision;
    report.exports={};
    for(const format of ['json','csv','brief']){
      const exported=await post('/api/export',{runId:result.run.id,planId:'minimal-change',format});
      assert.equal(exported.status,200);const body=await exported.text();assert(body.length>100);
      if(format==='json'){const pack=JSON.parse(body);assert.equal(pack.revision.number,1);assert.equal(pack.run.id,result.run.id);assertObservedModel(pack.run);assert.deepEqual(pack.plan,result.plans[0]);assert.deepEqual(pack.constraints,result.constraints);}
      if(format==='csv')assertCsvExport(body,result,result.plans[0],accepted.revision);
      if(format==='brief')assertBriefExport(body,result,result.plans[0],accepted.revision);
      report.exports[format]={bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')};
    }
    report.checks.push('Local revision one accepted; JSON matches the selected plan, CSV matches all ten assignment rows and run/revision, and brief matches all three personal before/after cards with locations and times.');
    report.priceBasis={verifiedOn:'2026-10-24',source:'https://tokenfactory.nebius.com/api/public/models_info',inputUSDPerMillion:0.06,outputUSDPerMillion:0.24,note:'Calculated token charge from catalog rates; not a billing-ledger observation.'};
    report.success=true;
  }catch(error){
    report.failure=error.message;
    process.exitCode=1;
  }finally{
    await new Promise(resolve=>server.close(resolve));
    const outDir=resolve(ROOT,'evidence/live');await mkdir(outDir,{recursive:true});
    const file=resolve(outDir,`verification-${createdAt.replaceAll(':','-')}.json`);
    await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({success:report.success,checks:report.checks,requestedModel:report.run?.requestedModel??MODEL,returnedModel:report.run?.returnedModel??report.error?.provider?.returnedModel??report.error?.modelIdentity?.returnedModel??null,usage:report.run?.usage??report.error?.provider?.usage??null,inferenceDurationMs:report.run?.inferenceDurationMs??report.error?.provider?.durationMs??null,finishReason:report.run?.provider?.finishReason??report.error?.provider?.finishReason??null,estimatedTokenChargeUSD:report.estimatedTokenChargeUSD,evidenceFile:file,failure:report.failure??null},null,2));
  }
}
