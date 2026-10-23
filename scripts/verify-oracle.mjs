// Independent bounded brute-force oracle. This module deliberately imports no
// production code: eligibility, validity and objectives are reconstructed here.

export function effectiveScenario(scenario, constraints = {}) {
  return {
    ...scenario,
    tasks: scenario.tasks.map(task => ({
      ...task,
      required: (constraints.demand ?? []).find(row => row.taskId === task.id)?.required ?? task.required,
      skills: (constraints.skillRequirements ?? []).find(row => row.taskId === task.id)?.skills ?? task.skills,
    })),
    volunteers: scenario.volunteers.map(person => ({
      ...person,
      maxAssignments: (constraints.capacity ?? []).find(row => row.volunteerId === person.id)?.maxAssignments ?? person.maxAssignments,
      availability: person.availability.filter(slotId => !(constraints.unavailable ?? []).some(row => row.volunteerId === person.id && row.slotIds.includes(slotId))),
    })),
  };
}

export function originalAssignments(scenario) {
  return Object.fromEntries(scenario.tasks.map(task => [task.id, [...(task.initialAssignees ?? [])].sort()]));
}

function taskSetFor(personId, assignments) {
  return Object.keys(assignments).filter(taskId => assignments[taskId].includes(personId)).sort();
}

export function auditAssignments(scenario, constraints, assignments, baseline = originalAssignments(scenario)) {
  const effective = effectiveScenario(scenario, constraints);
  const problems = [];
  const knownTasks = new Set(effective.tasks.map(task => task.id));
  const knownPeople = new Map(effective.volunteers.map(person => [person.id, person]));
  const occupied = new Set();
  const loads = Object.fromEntries(effective.volunteers.map(person => [person.id, 0]));
  let covered = 0;
  const required = effective.tasks.reduce((sum, task) => sum + task.required, 0);
  for (const taskId of Object.keys(assignments)) if (!knownTasks.has(taskId)) problems.push(`Unknown task ${taskId}`);
  for (const task of effective.tasks) {
    const assigned = assignments[task.id] ?? [];
    if (new Set(assigned).size !== assigned.length) problems.push(`Duplicate person at ${task.id}`);
    if (assigned.length > task.required) problems.push(`Overstaffed ${task.id}`);
    covered += Math.min(assigned.length, task.required);
    for (const personId of assigned) {
      const person = knownPeople.get(personId);
      if (!person) { problems.push(`Unknown person ${personId}`); continue; }
      if (!person.availability.includes(task.slotId)) problems.push(`Unavailable ${personId} at ${task.id}`);
      if (!task.skills.every(skill => person.skills.includes(skill))) problems.push(`Missing skill ${personId} at ${task.id}`);
      const period = `${personId}/${task.slotId}`;
      if (occupied.has(period)) problems.push(`Double-booked ${period}`);
      occupied.add(period);
      loads[personId] += 1;
    }
  }
  for (const person of effective.volunteers) if (loads[person.id] > person.maxAssignments) problems.push(`Capacity exceeded for ${person.id}`);
  for (const lock of constraints.locked ?? []) if (!(assignments[lock.taskId] ?? []).includes(lock.volunteerId)) problems.push(`Lock missing ${lock.volunteerId}/${lock.taskId}`);
  const changedPeople = effective.volunteers.filter(person => JSON.stringify(taskSetFor(person.id, assignments)) !== JSON.stringify(taskSetFor(person.id, baseline))).map(person => person.id);
  const assignmentChanges = effective.volunteers.reduce((sum, person) => {
    const before = new Set(taskSetFor(person.id, baseline));
    const after = new Set(taskSetFor(person.id, assignments));
    return sum + [...before].filter(taskId => !after.has(taskId)).length + [...after].filter(taskId => !before.has(taskId)).length;
  }, 0);
  return {
    valid: problems.length === 0, problems, covered, required,
    coveragePercent: required ? 100 * covered / required : 100,
    changedPeople, changedPeopleCount: changedPeople.length, assignmentChanges,
    squaredWorkload: Object.values(loads).reduce((sum, load) => sum + load * load, 0), loads,
    gaps: effective.tasks.filter(task => (assignments[task.id] ?? []).length < task.required).map(task => ({taskId:task.id, missing:task.required - (assignments[task.id] ?? []).length})),
  };
}

function subsets(values, maxSize, requiredMembers) {
  const rows = [];
  for (let bitset = 0; bitset < 2 ** values.length; bitset += 1) {
    const chosen = values.filter((_, index) => Math.floor(bitset / 2 ** index) % 2 === 1);
    if (chosen.length <= maxSize && requiredMembers.every(value => chosen.includes(value))) rows.push(chosen);
  }
  return rows;
}

export function enumerateOptimum(scenario, constraints, baseline = originalAssignments(scenario)) {
  const effective = effectiveScenario(scenario, constraints);
  const candidates = effective.tasks.map(task => {
    const eligible = effective.volunteers.filter(person => person.availability.includes(task.slotId) && task.skills.every(skill => person.skills.includes(skill))).map(person => person.id);
    const locked = (constraints.locked ?? []).filter(row => row.taskId === task.id).map(row => row.volunteerId);
    return subsets(eligible, task.required, locked);
  });
  let completeCandidates = 0;
  let best = null;
  let bestBalance = null;
  const assignments = {};
  const load = Object.fromEntries(effective.volunteers.map(person => [person.id, 0]));
  const limit = Object.fromEntries(effective.volunteers.map(person => [person.id, person.maxAssignments]));
  const occupied = new Set();
  function recurse(index) {
    if (index === effective.tasks.length) {
      completeCandidates += 1;
      const audit = auditAssignments(scenario, constraints, assignments, baseline);
      if (!audit.valid) throw new Error(`Oracle pruning failure: ${audit.problems.join('; ')}`);
      const beats = (candidate, incumbent, objectives) => {
        if (!incumbent) return true;
        for (const [key, direction] of objectives) {
          if (candidate[key] !== incumbent[key]) return direction * candidate[key] > direction * incumbent[key];
        }
        return false;
      };
      if (beats(audit, best, [['covered', 1], ['changedPeopleCount', -1], ['assignmentChanges', -1], ['squaredWorkload', -1]])) best = {...audit, assignments: structuredClone(assignments)};
      if (beats(audit, bestBalance, [['covered', 1], ['squaredWorkload', -1], ['assignmentChanges', -1]])) bestBalance = {...audit, assignments: structuredClone(assignments)};
      return;
    }
    const task = effective.tasks[index];
    for (const chosen of candidates[index]) {
      if (chosen.some(personId => load[personId] >= limit[personId] || occupied.has(`${personId}/${task.slotId}`))) continue;
      assignments[task.id] = chosen;
      for (const personId of chosen) { load[personId] += 1; occupied.add(`${personId}/${task.slotId}`); }
      recurse(index + 1);
      for (const personId of chosen) { load[personId] -= 1; occupied.delete(`${personId}/${task.slotId}`); }
      delete assignments[task.id];
    }
  }
  recurse(0);
  return {best, bestBalance, completeCandidates};
}
