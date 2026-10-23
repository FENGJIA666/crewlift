import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateConstraints,materialize} from '../lib/constraints.mjs';
import {solvePlans,auditAssignments} from '../lib/solver.mjs';
const scenario=JSON.parse(await readFile(new URL('../fixtures/scenario.json',import.meta.url),'utf8'));
const constraints=extra=>validateConstraints({unavailable:[],demand:[],locked:[],skillRequirements:[],capacity:[],...extra},scenario);

test('original roster keeps all original tasks without changing a person',()=>{
  const {plans}=solvePlans(scenario,constraints({}));
  assert.equal(plans[0].metrics.changedPeople,0);assert.equal(plans[0].metrics.coveredSeats,9);assert.equal(plans[0].metrics.retainedAssignments,9);
});
test('absence and expanded workshop create distinct fully covered outcomes',()=>{
  const {plans,effectiveTasks,effectiveVolunteers}=solvePlans(scenario,validateConstraints(scenario.initialConstraints,scenario));
  const [steady,balanced]=plans;
  for(const p of plans){assert.equal(p.metrics.coveredSeats,10);assert.equal(p.metrics.conflicts,0);assert(!p.assignments.some(a=>a.volunteerIds.includes('ava')));assert(p.assignments.find(a=>a.taskId==='gallery-1').volunteerIds.includes('chloe'));assert.deepEqual(auditAssignments(p.assignments,effectiveTasks,effectiveVolunteers),[]);}
  assert.equal(steady.metrics.changedPeople,3);assert(balanced.metrics.loadSquaredSum<steady.metrics.loadSquaredSum);assert.equal(balanced.metrics.maxLoad,2);assert.equal(steady.changeCards.length,3);
});
test('skill constraint and maximum-shift limit are hard constraints',()=>{
  const c=constraints({capacity:[{volunteerId:'ben',maxAssignments:1}],skillRequirements:[{taskId:'workshop-2',skills:['facilitation','logistics']}]});
  const {plans}=solvePlans(scenario,c);
  for(const p of plans){assert(p.workloads.find(w=>w.volunteerId==='ben').assignments<=1);assert.deepEqual(p.assignments.find(a=>a.taskId==='workshop-2').volunteerIds,['ben']);}
});
test('infeasible demand returns legal maximum coverage and explicit missing seats',()=>{
  const {plans}=solvePlans(scenario,constraints({demand:[{taskId:'workshop-2',required:8}]}));
  for(const p of plans){assert(p.metrics.coveredSeats<p.metrics.requiredSeats);assert.equal(p.metrics.conflicts,0);assert(p.uncovered.find(u=>u.taskId==='workshop-2').missing>=5);}
});
test('conflicting preserved assignments are rejected with an actionable code',()=>{
  assert.throws(()=>solvePlans(scenario,constraints({locked:[{taskId:'welcome-1',volunteerId:'dev'},{taskId:'gallery-1',volunteerId:'dev'}]})),{code:'LOCK_CONFLICT'});
  assert.throws(()=>solvePlans(scenario,constraints({locked:[{taskId:'workshop-1',volunteerId:'ava'}]})),{code:'LOCK_CONFLICT'});
});
test('unknown entities, malformed counters and duplicate constraints never reach the solver',()=>{
  assert.throws(()=>constraints({unavailable:[{volunteerId:'invented',slotIds:['s1']}]}),{code:'UNKNOWN_ENTITY'});
  assert.throws(()=>constraints({demand:[{taskId:'welcome-1',required:1.2}]}),{code:'INVALID_CONSTRAINTS'});
  assert.throws(()=>constraints({demand:[{taskId:'welcome-1',required:1},{taskId:'welcome-1',required:2}]}),{code:'DUPLICATE_CONSTRAINT'});
});
test('independent assignment audit detects overlap, skill and shift-limit violations',()=>{
  const c=constraints({capacity:[{volunteerId:'dev',maxAssignments:1}]});const {tasks,volunteers}=materialize(scenario,c);
  const violations=auditAssignments([{taskId:'welcome-1',volunteerIds:['dev']},{taskId:'gallery-1',volunteerIds:['dev']},{taskId:'workshop-2',volunteerIds:['ava']}],tasks,volunteers);
  assert(violations.includes('Overlapping assignment'));assert(violations.includes('Shift limit exceeded'));assert(violations.includes('Skill or availability mismatch'));
});
test('new locked assignments do not let subset-size pruning overstate the minimum affected crew',()=>{
  const s={id:'new-lock-regression',skills:['x','y'],slots:[{id:'s1',label:'09:00–10:00',hours:1},{id:'s2',label:'10:00–11:00',hours:1}],volunteers:[
    {id:'a',name:'A',skills:['y'],maxAssignments:2,availability:['s1','s2']},
    {id:'b',name:'B',skills:['x','y'],maxAssignments:2,availability:['s1','s2']},
    {id:'c',name:'C',skills:['x'],maxAssignments:2,availability:['s1','s2']}
  ],tasks:[
    {id:'x',title:'X',room:'Room X',slotId:'s1',skills:['x'],required:1,initialAssignees:['b']},
    {id:'y',title:'Y',room:'Room Y',slotId:'s1',skills:['y'],required:1,initialAssignees:[]},
    {id:'z',title:'Z',room:'Room Z',slotId:'s2',skills:[],required:1,initialAssignees:[]},
    {id:'w',title:'W',room:'Room W',slotId:'s2',skills:[],required:1,initialAssignees:[]}
  ]};
  const c=validateConstraints({locked:[{taskId:'z',volunteerId:'b'},{taskId:'w',volunteerId:'c'}]},s);
  const p=solvePlans(s,c).plans[0];
  // B and C must change because of their new locks. They can cover both remaining seats:
  // B: Y/Z, C: X/W, A unchanged. Thus two is both a lower bound and attainable.
  assert.equal(p.metrics.coveredSeats,4);assert.equal(p.metrics.changedPeople,2);
  assert.deepEqual(p.assignments.find(a=>a.taskId==='x').volunteerIds,['c']);
  assert.deepEqual(p.assignments.find(a=>a.taskId==='y').volunteerIds,['b']);
  assert.equal(p.workloads.find(w=>w.volunteerId==='a').assignments,0);
});
