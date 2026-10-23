import {AppError, materialize} from './constraints.mjs';

const eligible = (v, t) => v.availability.includes(t.slotId) && t.skills.every(s => v.skills.includes(s));
const pair = (taskId, volunteerId) => `${taskId}:${volunteerId}`;

// Successive shortest augmenting paths. Integral capacities produce integral rosters.
class MinCostFlow {
  constructor() { this.graph = new Map(); }
  add(a, b, cap, cost) {
    if (!this.graph.has(a)) this.graph.set(a, []);
    if (!this.graph.has(b)) this.graph.set(b, []);
    const forward = {to:b, cap, initialCap:cap, cost};
    const reverse = {to:a, cap:0, initialCap:0, cost:-cost};
    forward.reverse = reverse; reverse.reverse = forward;
    this.graph.get(a).push(forward); this.graph.get(b).push(reverse);
    return forward;
  }
  run(source, sink) {
    let flow = 0;
    for (;;) {
      const distance = new Map([...this.graph.keys()].map(n => [n, Infinity]));
      const previous = new Map(); distance.set(source, 0);
      // Bellman-Ford also handles negative reverse edges after an augmentation.
      for (let pass = 0; pass < this.graph.size - 1; pass++) {
        let changed = false;
        for (const [node, edges] of this.graph) {
          if (!Number.isFinite(distance.get(node))) continue;
          for (const edge of edges) {
            const candidate = distance.get(node) + edge.cost;
            if (edge.cap > 0 && candidate < distance.get(edge.to)) {
              distance.set(edge.to, candidate); previous.set(edge.to, {node, edge}); changed = true;
            }
          }
        }
        if (!changed) break;
      }
      if (!previous.has(sink)) return flow;
      for (let node = sink; node !== source;) {
        const step = previous.get(node); step.edge.cap--; step.edge.reverse.cap++; node = step.node;
      }
      flow++;
    }
  }
}

function forcedProblems(tasks, volunteers, forced) {
  const occupied = new Set(), counts = new Map(), taskCounts = new Map(), errors = [];
  for (const lock of forced) {
    const task = tasks.find(t => t.id === lock.taskId), volunteer = volunteers.find(v => v.id === lock.volunteerId);
    if (!task || !volunteer || !eligible(volunteer, task)) { errors.push('A preserved assignment must match availability and skills.'); continue; }
    const timeKey = `${volunteer.id}:${task.slotId}`;
    if (occupied.has(timeKey)) errors.push('A volunteer cannot preserve two roles in one time slot.');
    occupied.add(timeKey);
    counts.set(volunteer.id, (counts.get(volunteer.id) ?? 0) + 1);
    taskCounts.set(task.id, (taskCounts.get(task.id) ?? 0) + 1);
  }
  for (const v of volunteers) if ((counts.get(v.id) ?? 0) > v.maxAssignments) errors.push('Preserved assignments exceed a volunteer’s shift limit.');
  for (const t of tasks) if ((taskCounts.get(t.id) ?? 0) > t.required) errors.push('Preserved assignments exceed the required staffing.');
  return errors;
}

function solveFlow(tasks, volunteers, locks, objective, changeable) {
  const forced = new Map(locks.map(l => [pair(l.taskId,l.volunteerId), l]));
  if (changeable) for (const task of tasks) for (const volunteerId of task.initialAssignees) {
    if (!changeable.has(volunteerId)) forced.set(pair(task.id,volunteerId), {taskId:task.id,volunteerId});
  }
  const fixed = [...forced.values()];
  if (forcedProblems(tasks, volunteers, fixed).length) return null;
  const assigned = new Map(tasks.map(t => [t.id, fixed.filter(l => l.taskId === t.id).map(l => l.volunteerId)]));
  const load = new Map(volunteers.map(v => [v.id, fixed.filter(l => l.volunteerId === v.id).length]));
  const occupied = new Set(fixed.map(l => `${l.volunteerId}:${tasks.find(t => t.id === l.taskId).slotId}`));
  const flow = new MinCostFlow(), assignmentEdges = [];
  flow.graph.set('source', []); flow.graph.set('sink', []);
  for (const task of tasks) flow.add(`task:${task.id}`, 'sink', task.required - assigned.get(task.id).length, 0);
  for (const v of volunteers) {
    if (changeable && !changeable.has(v.id)) continue;
    for (let k = 1; k <= v.maxAssignments - load.get(v.id); k++) {
      const marginal = 2 * (load.get(v.id) + k) - 1;
      flow.add('source', `person:${v.id}`, 1, objective === 'balanced' ? marginal * 1000 : marginal);
    }
    for (const slotId of v.availability) {
      if (occupied.has(`${v.id}:${slotId}`)) continue;
      flow.add(`person:${v.id}`, `time:${v.id}:${slotId}`, 1, 0);
      for (const task of tasks.filter(t => t.slotId === slotId && eligible(v,t))) {
        const isNew = !task.initialAssignees.includes(v.id);
        const edge = flow.add(`time:${v.id}:${slotId}`, `task:${task.id}`, 1, isNew ? (objective === 'balanced' ? 1 : 1000) : 0);
        assignmentEdges.push({taskId:task.id, volunteerId:v.id, edge});
      }
    }
  }
  flow.run('source', 'sink');
  for (const {taskId,volunteerId,edge} of assignmentEdges) if (edge.cap === 0) assigned.get(taskId).push(volunteerId);
  return tasks.map(t => ({taskId:t.id, volunteerIds:assigned.get(t.id).sort()}));
}

export function auditAssignments(assignments, tasks, volunteers) {
  const violations = [], times = new Set(), counts = new Map();
  for (const assignment of assignments) {
    const task = tasks.find(t => t.id === assignment.taskId);
    if (!task) { violations.push('Unknown task'); continue; }
    if (assignment.volunteerIds.length > task.required) violations.push('Overstaffed task');
    for (const id of assignment.volunteerIds) {
      const volunteer = volunteers.find(v => v.id === id);
      if (!volunteer || !eligible(volunteer,task)) violations.push('Skill or availability mismatch');
      const key = `${id}:${task.slotId}`;
      if (times.has(key)) violations.push('Overlapping assignment');
      times.add(key); counts.set(id,(counts.get(id) ?? 0)+1);
    }
  }
  for (const volunteer of volunteers) if ((counts.get(volunteer.id) ?? 0)>volunteer.maxAssignments) violations.push('Shift limit exceeded');
  return violations;
}

function summarize(assignments, scenario, tasks, volunteers, constraints, id) {
  const changes = tasks.map(t => {
    const ids = assignments.find(a => a.taskId === t.id).volunteerIds;
    return {taskId:t.id, added:ids.filter(v => !t.initialAssignees.includes(v)), removed:t.initialAssignees.filter(v => !ids.includes(v))};
  }).filter(c => c.added.length || c.removed.length);
  const changedIds = new Set(changes.flatMap(c => [...c.added,...c.removed]));
  const workloads = volunteers.map(v => {
    const own = assignments.filter(a => a.volunteerIds.includes(v.id));
    return {volunteerId:v.id, assignments:own.length, hours:own.reduce((sum,a) => sum + scenario.slots.find(s => s.id === tasks.find(t => t.id === a.taskId).slotId).hours,0),maxAssignments:v.maxAssignments,available:v.availability.length>0};
  });
  const activeLoads = workloads.filter(w => w.available).map(w => w.assignments);
  const requiredSeats = tasks.reduce((n,t) => n+t.required,0), coveredSeats=assignments.reduce((n,a) => n+a.volunteerIds.length,0);
  const retainedAssignments = tasks.reduce((n,t) => n + assignments.find(a => a.taskId===t.id).volunteerIds.filter(v => t.initialAssignees.includes(v)).length,0);
  const violations = auditAssignments(assignments,tasks,volunteers);
  const maxLoad = activeLoads.length ? Math.max(...activeLoads) : 0, minLoad = activeLoads.length ? Math.min(...activeLoads) : 0;
  const metrics = {coveragePct:requiredSeats ? Math.round(coveredSeats/requiredSeats*1000)/10 : 100,coveredSeats,requiredSeats,conflicts:violations.length,changedPeople:changedIds.size,retainedAssignments,changedAssignments:changes.reduce((n,c)=>n+c.added.length+c.removed.length,0),maxLoad,minLoad,workloadSpread:maxLoad-minLoad,loadSquaredSum:activeLoads.reduce((s,n)=>s+n*n,0),hoursTotal:workloads.reduce((s,w)=>s+w.hours,0)};
  const taskCard = taskId => { const t=tasks.find(x=>x.id===taskId); return {taskId,title:t.title,room:t.room,slotId:t.slotId,time:scenario.slots.find(s=>s.id===t.slotId).label}; };
  const changeCards = volunteers.filter(v=>changedIds.has(v.id)).map(v=>({volunteerId:v.id,name:v.name,before:scenario.tasks.filter(t=>t.initialAssignees.includes(v.id)).map(t=>taskCard(t.id)),after:assignments.filter(a=>a.volunteerIds.includes(v.id)).map(a=>taskCard(a.taskId)),reason:constraints.unavailable.some(u=>u.volunteerId===v.id) ? 'Updated availability respected.' : id==='balanced' ? 'Shared coverage and workload across the available crew.' : 'Restored coverage while keeping the smallest number of people’s plans in motion.'}));
  const uncovered = tasks.flatMap(t=>{const missing=t.required-assignments.find(a=>a.taskId===t.id).volunteerIds.length;return missing?[{taskId:t.id,missing,reason:'Add available crew with the required skills, or adjust this task’s requirement.'}]:[];});
  return {id,title:id==='minimal-change'?'Keep plans steady':'Share the workload',objective:id==='minimal-change'?'Maximum coverage, then fewest changed people, then retained assignments.':'Maximum coverage, then minimum squared workload, then retained assignments.',assignments,metrics,workloads,changes,changeCards,uncovered,explanation:[`${coveredSeats} of ${requiredSeats} required places covered with ${violations.length} assignment conflicts.`,`${retainedAssignments} original assignments retained; ${changedIds.size} people receive an updated plan.`,`${constraints.locked.length} confirmed assignments preserved.`,id==='minimal-change'?'Exact search finds the smallest affected crew for this scenario.':'Convex workload costs distribute shifts across the available, qualified crew.'],violations};
}

export function solvePlans(scenario, constraints) {
  const {tasks,volunteers}=materialize(scenario,constraints);
  const lockErrors=forcedProblems(tasks,volunteers,constraints.locked);
  if(lockErrors.length) throw new AppError('LOCK_CONFLICT', lockErrors[0],422);
  const balancedAssignments=solveFlow(tasks,volunteers,constraints.locked,'balanced');
  const balanced=summarize(balancedAssignments,scenario,tasks,volunteers,constraints,'balanced');
  const target=balanced.metrics.coveredSeats;
  let best=null;
  // Outside a subset, preserve original assignments; new explicit locks can still change
  // those people. Subset size is therefore not a safe bound on actual changedPeople.
  // Evaluate every subset (256 for this eight-person event) and compare actual metrics.
  for(let mask=0;mask<(1<<volunteers.length);mask++){
    const changeable=new Set(volunteers.filter((_,i)=>mask&(1<<i)).map(v=>v.id));
    const assignments=solveFlow(tasks,volunteers,constraints.locked,'minimal-change',changeable);
    if(!assignments)continue;
    const candidate=summarize(assignments,scenario,tasks,volunteers,constraints,'minimal-change');
    if(candidate.metrics.coveredSeats!==target)continue;
    const a=candidate.metrics,b=best?.metrics;
    if(!best||a.changedPeople<b.changedPeople||(a.changedPeople===b.changedPeople&&(a.changedAssignments<b.changedAssignments||(a.changedAssignments===b.changedAssignments&&a.loadSquaredSum<b.loadSquaredSum))))best=candidate;
  }
  if(!best)throw new AppError('SOLVER_ERROR','The recovery solver could not complete this plan.',500);
  for(const plan of [best,balanced])if(plan.metrics.conflicts)throw new AppError('SOLVER_ERROR','The assignment audit identified a conflict.',500);
  return {plans:[best,balanced],effectiveTasks:tasks,effectiveVolunteers:volunteers};
}
