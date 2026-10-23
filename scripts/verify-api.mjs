import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createApp} from '../server.mjs';
import {auditAssignments, enumerateOptimum} from './verify-oracle.mjs';

// Isolated local HTTP state. An explicit empty key makes live calls impossible,
// even if a later development environment contains configured credentials.
const server = createApp({apiKey:''});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const started = performance.now();
const records = [];
const note = (name,details={}) => records.push({name,status:'pass',...details});
const assignments = plan => Object.fromEntries(plan.assignments.map(row=>[row.taskId,[...row.volunteerIds].sort()]));
const request = async (path,body,status=200) => {
  const response = await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const text=await response.text();
  assert.equal(response.status,status,`${path}: ${text}`);
  return {response,text,json:response.headers.get('content-type').startsWith('application/json')?JSON.parse(text):null};
};
const post = async(path,body,status=200)=>(await request(path,body,status)).json;
const csvRows = text => {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i+=1){const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i+=1;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  assert.equal(quoted,false,'CSV closes quoted values');
  return rows;
};

try {
  const config=(await request('/api/config')).json;
  assert.equal(config.liveAvailable,false);
  assert.equal(config.constraintSemantics,'replace');
  const unconfigured=await post('/api/plan',{mode:'live',brief:'Ava cannot attend any shift.'},409);
  assert.equal(unconfigured.error.code,'NEBIUS_NOT_CONFIGURED');
  note('unconfigured-live-route-is-explicit',{liveCalls:0,liveAvailable:false});

  const original=(await request('/api/scenario')).json;
  const run1=await post('/api/plan',{mode:'sample',constraints:original.initialConstraints});
  assert.equal(run1.run.model,null);
  assert.equal(run1.run.usage,null);
  assert.equal(run1.mode,'sample');
  assert.match(run1.label,/Sample scenario.*local constraint solver/);
  for(const row of run1.provenance){assert.equal(row.origin,'Structured controls');assert.equal(row.quote,null);assert.deepEqual(row.value,run1.constraints[row.kind][row.constraintIndex]);}
  const minimal1=run1.plans.find(row=>row.id==='minimal-change');
  const audit1=auditAssignments(original,run1.constraints,assignments(minimal1));
  assert.equal(audit1.valid,true);
  assert.equal(audit1.covered,10);assert.equal(audit1.required,10);assert.equal(audit1.changedPeopleCount,3);
  note('sample-http-plan-and-structured-source-trace',{covered:10,required:10,changedPeople:3,sourceCount:run1.provenance.length});

  const accepted1=await post('/api/accept',{runId:run1.run.id,planId:minimal1.id});
  assert.equal(accepted1.revision.number,1);
  assert.deepEqual(accepted1.delta.changeCards,minimal1.changeCards);
  assert.deepEqual(accepted1.scenario.initialConstraints,run1.constraints);
  for(const task of accepted1.scenario.tasks) assert.deepEqual([...task.initialAssignees].sort(),assignments(minimal1)[task.id]);
  const same=await post('/api/accept',{runId:run1.run.id,planId:minimal1.id});
  assert.equal(same.revision.id,accepted1.revision.id);
  const stale=await post('/api/accept',{runId:run1.run.id,planId:'balanced'},409);
  assert.equal(stale.error.code,'STALE_BASELINE');
  note('accept-revision-1-idempotency-and-stale-alternative-rejection',{revisionNumber:1});

  const inherited=await post('/api/plan',{mode:'sample'});
  const inheritedPlan=inherited.plans.find(row=>row.id==='minimal-change');
  assert.deepEqual(inherited.constraints,run1.constraints);
  assert.equal(inheritedPlan.metrics.changedPeople,0);
  assert.equal(inheritedPlan.metrics.changedAssignments,0);
  assert.deepEqual(assignments(inheritedPlan),assignments(minimal1));
  assert.equal(inheritedPlan.assignments.some(row=>row.volunteerIds.includes('ava')),false);
  note('omitted-constraints-inherit-accepted-state',{changedPeople:0,absentPersonRestored:false});

  const nextConstraints=structuredClone(accepted1.scenario.initialConstraints);
  nextConstraints.unavailable.push({volunteerId:'ben',slotIds:['s1','s2','s3']});
  const run2=await post('/api/plan',{mode:'sample',constraints:nextConstraints});
  const minimal2=run2.plans.find(row=>row.id==='minimal-change');
  assert.equal(run2.run.baselineRevision.id,accepted1.revision.id);
  const audit2=auditAssignments(accepted1.scenario,run2.constraints,assignments(minimal2));
  const optimum2=enumerateOptimum(accepted1.scenario,run2.constraints);
  assert.equal(audit2.valid,true);assert.equal(audit2.covered,10);
  assert.equal(audit2.changedPeopleCount,optimum2.best.changedPeopleCount);
  assert.equal(audit2.assignmentChanges,optimum2.best.assignmentChanges);
  assert.equal(audit2.changedPeopleCount,minimal2.metrics.changedPeople);
  assert.equal(audit2.assignmentChanges,minimal2.metrics.changedAssignments);
  assert.equal(minimal2.assignments.some(row=>row.volunteerIds.includes('ava')||row.volunteerIds.includes('ben')),false);
  for(const card of minimal2.changeCards){
    assert.deepEqual(card.before.map(row=>row.taskId).sort(),minimal1.assignments.filter(row=>row.volunteerIds.includes(card.volunteerId)).map(row=>row.taskId).sort());
    assert.deepEqual(card.after.map(row=>row.taskId).sort(),minimal2.assignments.filter(row=>row.volunteerIds.includes(card.volunteerId)).map(row=>row.taskId).sort());
  }
  const accepted2=await post('/api/accept',{runId:run2.run.id,planId:minimal2.id});
  assert.equal(accepted2.revision.number,2);
  assert.deepEqual(accepted2.delta.changeCards,minimal2.changeCards);
  note('second-disruption-delta-is-from-accepted-revision-1',{revisionNumber:2,covered:audit2.covered,required:audit2.required,changedPeople:audit2.changedPeopleCount,assignmentChanges:audit2.assignmentChanges,oracleCandidates:optimum2.completeCandidates,absentPeopleRestored:false});

  await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});
  for(const [run,plan,accepted] of [[run1,minimal1,accepted1],[run2,minimal2,accepted2]]) {
    const exported=await request('/api/export',{runId:run.run.id,planId:plan.id,format:'json'});
    const pack=exported.json;
    assert.equal(pack.revision.id,accepted.revision.id);
    assert.equal(pack.revision.number,accepted.revision.number);
    assert.deepEqual(pack.plan,plan);
    assert.deepEqual(pack.constraints,run.constraints);
    assert.deepEqual(pack.provenance,run.provenance);
    assert.deepEqual(pack.run,run.run);
    assert.match(exported.response.headers.get('content-disposition'),new RegExp(`r${accepted.revision.number}\\.json`));
    await writeFile(new URL(`../evidence/accepted-r${accepted.revision.number}.json`,import.meta.url),exported.text+'\n');
    const csv=await request('/api/export',{runId:run.run.id,planId:plan.id,format:'csv'});
    const rows=csvRows(csv.text);
    const header=rows.shift();
    assert.deepEqual(header,['revision','run_id','task_id','task','room','time','volunteer_id','volunteer','skills','source_ids']);
    assert.equal(rows.length,plan.metrics.coveredSeats);
    assert.equal(rows.every(row=>row[0]===String(accepted.revision.number)&&row[1]===run.run.id),true);
    assert.deepEqual(rows.map(row=>`${row[2]}:${row[6]}`).sort(),plan.assignments.flatMap(row=>row.volunteerIds.map(id=>`${row.taskId}:${id}`)).sort());
    const brief=await request('/api/export',{runId:run.run.id,planId:plan.id,format:'brief'});
    assert.ok(brief.text.includes(`Accepted revision ${accepted.revision.number}`));
    assert.ok(brief.text.includes(`Coverage: ${plan.metrics.coveredSeats}/${plan.metrics.requiredSeats}`));
    for(const card of plan.changeCards){
      assert.ok(brief.text.includes(card.name));
      assert.ok(brief.text.includes(card.reason));
      for(const task of [...card.before,...card.after]){assert.ok(brief.text.includes(task.title));assert.ok(brief.text.includes(task.time));assert.ok(brief.text.includes(task.room),`Handoff includes destination ${task.room}`);}
    }
    await writeFile(new URL(`../evidence/accepted-r${accepted.revision.number}.csv`,import.meta.url),csv.text);
    await writeFile(new URL(`../evidence/accepted-r${accepted.revision.number}-handoff.txt`,import.meta.url),brief.text);
    note(`revision-${accepted.revision.number}-json-csv-handoff-export-readback`,{revisionNumber:accepted.revision.number,coveredRows:rows.length,personalCards:plan.changeCards.length});
  }

  const impossible=structuredClone(nextConstraints);
  impossible.unavailable.push({volunteerId:'emi',slotIds:['s1','s2','s3']},{volunteerId:'gia',slotIds:['s1','s2','s3']});
  const impossibleRun=await post('/api/plan',{mode:'sample',constraints:impossible});
  const impossiblePlan=impossibleRun.plans.find(row=>row.id==='minimal-change');
  const gapAudit=auditAssignments(accepted2.scenario,impossible,assignments(impossiblePlan));
  assert.equal(gapAudit.valid,true);assert.equal(gapAudit.covered,6);assert.equal(gapAudit.required,10);
  assert.equal(impossiblePlan.metrics.coveragePct,60);
  assert.deepEqual(impossiblePlan.uncovered.map(({taskId,missing})=>({taskId,missing})),[{taskId:'workshop-1',missing:1},{taskId:'workshop-2',missing:2},{taskId:'workshop-3',missing:1}]);
  const rejected=await post('/api/accept',{runId:impossibleRun.run.id,planId:impossiblePlan.id},422);
  assert.equal(rejected.error.code,'COVERAGE_REQUIRED');
  note('infeasible-http-plan-reports-exact-gaps-and-prevents-acceptance',{covered:6,required:10,coveragePct:60,missingPlaces:4,uncoveredTasks:3});

  const unknown=await post('/api/plan',{mode:'sample',constraints:{...nextConstraints,unavailable:[{volunteerId:'not-a-person',slotIds:['s1']}]}},400);
  assert.equal(unknown.error.code,'UNKNOWN_ENTITY');
  const lockConflict=await post('/api/plan',{mode:'sample',constraints:{...nextConstraints,locked:[...nextConstraints.locked,{taskId:'welcome-1',volunteerId:'ava'}]}},422);
  assert.equal(lockConflict.error.code,'LOCK_CONFLICT');
  note('unknown-person-and-unavailable-lock-are-rejected');

  const reset=await post('/api/reset',{});
  assert.equal(reset.revision.number,0);
  assert.notEqual(reset.revision.id,original.revision.id);
  assert.deepEqual(reset.scenario.tasks,original.tasks);
  assert.deepEqual(reset.scenario.initialConstraints,original.initialConstraints);
  const old=await post('/api/accept',{runId:run2.run.id,planId:minimal2.id},404);
  assert.equal(old.error.code,'RUN_NOT_FOUND');
  note('reset-restores-original-sample-and-invalidates-old-runs');

  const paths=['server.mjs','lib/export.mjs','lib/nebius.mjs','lib/solver.mjs','lib/constraints.mjs','scripts/verify-api.mjs'];
  const fingerprints=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(new URL(`../${path}`,import.meta.url))).digest('hex')])));
  const report={verifiedAt:new Date().toISOString(),scope:'Isolated local HTTP API; fictional data; explicit empty API key; no external/model requests',passed:records.length,failed:0,elapsedMs:performance.now()-started,fingerprints,records};
  await writeFile(new URL('../evidence/api-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:records.length,elapsedMs:Math.round(report.elapsedMs),records},null,2));
} finally {
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
