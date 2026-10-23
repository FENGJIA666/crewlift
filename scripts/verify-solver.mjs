import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {solvePlans} from '../lib/solver.mjs';
import {auditAssignments, enumerateOptimum, originalAssignments} from './verify-oracle.mjs';

const started = performance.now();
const empty = () => ({unavailable:[], demand:[], locked:[], skillRequirements:[], capacity:[]});
const scenario = JSON.parse(await readFile(new URL('../fixtures/scenario.json', import.meta.url), 'utf8'));
const records = [];
const normalize = plan => Object.fromEntries(plan.assignments.map(row => [row.taskId, [...row.volunteerIds].sort()]));

function checkOne(name, fixture, constraints, exhaustive = true) {
  const t0 = performance.now();
  const oracle = exhaustive ? enumerateOptimum(fixture, constraints) : null;
  if (oracle && !oracle.best) {
    assert.throws(() => solvePlans(fixture, constraints), error => error.code === 'LOCK_CONFLICT', `${name}: impossible locked scenario must identify its conflict`);
    records.push({name, status:'pass', result:'explicit-lock-conflict', enumeratedCandidates:0, elapsedMs:performance.now()-t0});
    return;
  }
  const {plans} = solvePlans(fixture, constraints);
  const result = [];
  for (const plan of plans) {
    const independent = auditAssignments(fixture, constraints, normalize(plan));
    assert.equal(independent.valid, true, `${name}/${plan.id}: ${independent.problems.join('; ')}`);
    const m = plan.metrics;
    assert.equal(m.coveredSeats, independent.covered, `${name}: covered seats`);
    assert.equal(m.requiredSeats, independent.required, `${name}: required seats`);
    assert.equal(m.coveragePct, Math.round(independent.coveragePercent * 10) / 10, `${name}: percentage`);
    assert.equal(m.changedPeople, independent.changedPeopleCount, `${name}: changed people includes standby and absent people`);
    assert.equal(m.changedAssignments, independent.assignmentChanges, `${name}: added plus removed assignments`);
    assert.equal(m.loadSquaredSum, independent.squaredWorkload, `${name}: workload square sum`);
    assert.equal(m.hoursTotal, plan.assignments.reduce((sum,row) => sum + row.volunteerIds.length * fixture.slots.find(slot => slot.id === fixture.tasks.find(task => task.id === row.taskId).slotId).hours, 0), `${name}: assigned hours total`);
    assert.equal(m.retainedAssignments, plan.assignments.reduce((sum,row) => sum + row.volunteerIds.filter(id => fixture.tasks.find(task => task.id === row.taskId).initialAssignees.includes(id)).length, 0), `${name}: retained original assignments`);
    assert.equal(m.conflicts, 0, `${name}: claimed conflicts`);
    assert.deepEqual(Object.fromEntries(plan.workloads.map(row=>[row.volunteerId,row.assignments])), independent.loads, `${name}: per-person workload`);
    assert.deepEqual(plan.uncovered.map(({taskId,missing}) => ({taskId,missing})), independent.gaps, `${name}: exact uncovered tasks`);
    assert.deepEqual(plan.changeCards.map(row => row.volunteerId).sort(), [...independent.changedPeople].sort(), `${name}: affected card recipients`);
    const baseline = originalAssignments(fixture);
    for (const card of plan.changeCards) {
      assert.deepEqual(card.before.map(row => row.taskId).sort(), Object.keys(baseline).filter(id => baseline[id].includes(card.volunteerId)).sort(), `${name}: before card`);
      assert.deepEqual(card.after.map(row => row.taskId).sort(), Object.keys(normalize(plan)).filter(id => normalize(plan)[id].includes(card.volunteerId)).sort(), `${name}: after card`);
    }
    if (oracle) {
      const expected = plan.id === 'minimal-change' ? oracle.best : oracle.bestBalance;
      assert.equal(independent.covered, expected.covered, `${name}: globally maximum coverage`);
      if (plan.id === 'minimal-change') {
        assert.equal(independent.changedPeopleCount, expected.changedPeopleCount, `${name}: globally minimum affected people`);
        assert.equal(independent.assignmentChanges, expected.assignmentChanges, `${name}: assignment-change tie-break`);
      }
      assert.equal(independent.squaredWorkload, expected.squaredWorkload, `${name}: workload objective/tie-break`);
    }
    result.push({planId:plan.id, covered:independent.covered, required:independent.required, affectedPeople:independent.changedPeopleCount, assignmentChanges:independent.assignmentChanges, squaredWorkload:independent.squaredWorkload, gaps:independent.gaps});
  }
  records.push({name,status:'pass',enumeratedCandidates:oracle?.completeCandidates ?? null,elapsedMs:performance.now()-t0,plans:result});
}

function mini() {
  return {
    id:'independent-mini', skills:['a','b'],
    slots:[{id:'s1',label:'09:00–10:00',hours:1},{id:'s2',label:'10:00–11:00',hours:1}],
    volunteers:[
      {id:'p0',name:'P0',skills:['a'],availability:['s1','s2'],maxAssignments:2},
      {id:'p1',name:'P1',skills:['a','b'],availability:['s1','s2'],maxAssignments:2},
      {id:'p2',name:'P2',skills:['b'],availability:['s1','s2'],maxAssignments:2},
      {id:'p3',name:'P3',skills:['a','b'],availability:['s1','s2'],maxAssignments:1},
    ],
    tasks:[
      {id:'t0',title:'Role A',room:'One',slotId:'s1',skills:['a'],required:1,initialAssignees:['p0']},
      {id:'t1',title:'Role B',room:'Two',slotId:'s1',skills:['b'],required:1,initialAssignees:['p1']},
      {id:'t2',title:'Role A',room:'One',slotId:'s2',skills:['a'],required:1,initialAssignees:['p0']},
      {id:'t3',title:'Role B',room:'Two',slotId:'s2',skills:['b'],required:1,initialAssignees:['p2']},
    ],
  };
}

checkOne('small-baseline',mini(),empty());
checkOne('small-absence-with-demand',mini(),{...empty(),unavailable:[{volunteerId:'p0',slotIds:['s1','s2']}],demand:[{taskId:'t1',required:2}]});
checkOne('small-skills-and-capacity',mini(),{...empty(),skillRequirements:[{taskId:'t2',skills:['a','b']}],capacity:[{volunteerId:'p1',maxAssignments:1}],locked:[{taskId:'t1',volunteerId:'p1'}]});
checkOne('small-impossible-coverage',mini(),{...empty(),unavailable:[{volunteerId:'p1',slotIds:['s1','s2']},{volunteerId:'p2',slotIds:['s1','s2']},{volunteerId:'p3',slotIds:['s1','s2']}]});
checkOne('small-overlap-lock-conflict',mini(),{...empty(),locked:[{taskId:'t0',volunteerId:'p1'},{taskId:'t1',volunteerId:'p1'}]});
checkOne('small-skill-lock-conflict',mini(),{...empty(),locked:[{taskId:'t0',volunteerId:'p2'}]});
checkOne('small-capacity-lock-conflict',mini(),{...empty(),capacity:[{volunteerId:'p0',maxAssignments:1}],locked:[{taskId:'t0',volunteerId:'p0'},{taskId:'t2',volunteerId:'p0'}]});
checkOne('small-unavailable-lock-conflict',mini(),{...empty(),unavailable:[{volunteerId:'p0',slotIds:['s1']}],locked:[{taskId:'t0',volunteerId:'p0'}]});
checkOne('small-overstaffed-lock-conflict',mini(),{...empty(),demand:[{taskId:'t0',required:0}],locked:[{taskId:'t0',volunteerId:'p0'}]});
checkOne('small-zero-demand',mini(),{...empty(),demand:mini().tasks.map(task=>({taskId:task.id,required:0}))});
checkOne('small-new-lock-outside-subset-regression',{
  id:'independent-new-lock-regression',skills:['x','y'],
  slots:[{id:'s1',label:'09:00–10:00',hours:1},{id:'s2',label:'10:00–11:00',hours:1}],
  volunteers:[
    {id:'a',name:'A',skills:['y'],availability:['s1','s2'],maxAssignments:2},
    {id:'b',name:'B',skills:['x','y'],availability:['s1','s2'],maxAssignments:2},
    {id:'c',name:'C',skills:['x'],availability:['s1','s2'],maxAssignments:2},
  ],
  tasks:[
    {id:'x',title:'X',room:'X',slotId:'s1',skills:['x'],required:1,initialAssignees:['b']},
    {id:'y',title:'Y',room:'Y',slotId:'s1',skills:['y'],required:1,initialAssignees:[]},
    {id:'z',title:'Z',room:'Z',slotId:'s2',skills:[],required:1,initialAssignees:[]},
    {id:'w',title:'W',room:'W',slotId:'s2',skills:[],required:1,initialAssignees:[]},
  ],
},{...empty(),locked:[{taskId:'z',volunteerId:'b'},{taskId:'w',volunteerId:'c'}]});

let seed = 23102026;
const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed / 2 ** 32; };
for (let i=0;i<80;i+=1) {
  const fixture=mini();
  const c=empty();
  for (const person of fixture.volunteers) {
    if (random()<0.4) c.unavailable.push({volunteerId:person.id,slotIds:random()<0.5?['s1']:['s2']});
    if (random()<0.25) c.capacity.push({volunteerId:person.id,maxAssignments:Math.floor(random()*3)});
  }
  for (const task of fixture.tasks) {
    if (random()<0.45) c.demand.push({taskId:task.id,required:Math.floor(random()*3)});
    if (random()<0.3) c.skillRequirements.push({taskId:task.id,skills:random()<0.5?['a','b']:['a']});
  }
  checkOne(`generated-${String(i+1).padStart(2,'0')}`,fixture,c);
}

checkOne('demo-default',scenario,scenario.initialConstraints,true);
checkOne('demo-original',scenario,scenario.presets.find(row=>row.id==='original').constraints,false);
checkOne('demo-absence-only',scenario,scenario.presets.find(row=>row.id==='absence').constraints,false);
checkOne('demo-zero-facilitators',scenario,{...empty(),unavailable:scenario.volunteers.filter(person=>person.skills.includes('facilitation')).map(person=>({volunteerId:person.id,slotIds:scenario.slots.map(row=>row.id)}))},false);

const paths=['lib/solver.mjs','lib/constraints.mjs','fixtures/scenario.json','scripts/verify-oracle.mjs','scripts/verify-solver.mjs'];
const fingerprints=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(new URL(`../${path}`,import.meta.url))).digest('hex')])));
const output={verifiedAt:new Date().toISOString(),scope:'Local deterministic solver; independent brute-force oracle; no live model call',seed:23102026,passed:records.length,failed:0,totalEnumeratedCandidates:records.reduce((sum,row)=>sum+(row.enumeratedCandidates??0),0),elapsedMs:performance.now()-started,fingerprints,records};
await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});
await writeFile(new URL('../evidence/solver-verification.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({passed:output.passed,totalEnumeratedCandidates:output.totalEnumeratedCandidates,elapsedMs:Math.round(output.elapsedMs),demo:records.find(row=>row.name==='demo-default')},null,2));
