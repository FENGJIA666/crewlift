export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function validateConstraints(input, scenario) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('INVALID_CONSTRAINTS', 'Provide a constraints object.');
  const allowed = ['unavailable', 'demand', 'locked', 'skillRequirements', 'capacity'];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw new AppError('INVALID_CONSTRAINTS', 'Use only supported constraint fields.');
  const people = new Set(scenario.volunteers.map(v => v.id));
  const tasks = new Set(scenario.tasks.map(t => t.id));
  const slots = new Set(scenario.slots.map(s => s.id));
  const skills = new Set(scenario.skills);
  const result = {};
  for (const kind of allowed) {
    const rows = input[kind] ?? [];
    if (!Array.isArray(rows) || rows.length > 40) throw new AppError('INVALID_CONSTRAINTS', `${kind} must be a list of at most 40 entries.`);
    const seen = new Set();
    result[kind] = rows.map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError('INVALID_CONSTRAINTS', `Check ${kind} entry ${index + 1}.`);
      const check = (set, id, label) => { if (!set.has(id)) throw new AppError('UNKNOWN_ENTITY', `Choose a known ${label} in ${kind}.`); };
      const fields = {unavailable:['volunteerId','slotIds'], demand:['taskId','required'], locked:['taskId','volunteerId'], skillRequirements:['taskId','skills'], capacity:['volunteerId','maxAssignments']}[kind];
      if (Object.keys(row).some(k => !fields.includes(k))) throw new AppError('INVALID_CONSTRAINTS', `Unexpected field in ${kind}.`);
      let item;
      if (kind === 'unavailable') {
        check(people, row.volunteerId, 'volunteer');
        if (!Array.isArray(row.slotIds) || !row.slotIds.length || row.slotIds.some(id => !slots.has(id))) throw new AppError('UNKNOWN_ENTITY', 'Choose known time slots for unavailability.');
        item = {volunteerId: row.volunteerId, slotIds: [...new Set(row.slotIds)].sort()};
      } else if (kind === 'demand') {
        check(tasks, row.taskId, 'task');
        if (!Number.isInteger(row.required) || row.required < 0 || row.required > scenario.volunteers.length) throw new AppError('INVALID_CONSTRAINTS', 'Required staffing must be an integer from 0 to the crew size.');
        item = {taskId: row.taskId, required: row.required};
      } else if (kind === 'locked') {
        check(tasks, row.taskId, 'task'); check(people, row.volunteerId, 'volunteer');
        item = {taskId: row.taskId, volunteerId: row.volunteerId};
      } else if (kind === 'capacity') {
        check(people, row.volunteerId, 'volunteer');
        if (!Number.isInteger(row.maxAssignments) || row.maxAssignments < 0 || row.maxAssignments > scenario.slots.length) throw new AppError('INVALID_CONSTRAINTS', 'Maximum shifts must be an integer within the event length.');
        item = {volunteerId: row.volunteerId, maxAssignments: row.maxAssignments};
      } else {
        check(tasks, row.taskId, 'task');
        if (!Array.isArray(row.skills) || row.skills.some(s => !skills.has(s))) throw new AppError('UNKNOWN_ENTITY', 'Choose skills from the event skill list.');
        item = {taskId: row.taskId, skills: [...new Set(row.skills)].sort()};
      }
      const key = kind === 'locked' ? `${item.taskId}:${item.volunteerId}` : item.taskId ?? item.volunteerId;
      if (seen.has(key)) throw new AppError('DUPLICATE_CONSTRAINT', `Combine duplicate ${kind} entries.`);
      seen.add(key); return item;
    });
  }
  return result;
}

export function materialize(scenario, constraints) {
  const tasks = scenario.tasks.map(t => ({...t, skills: constraints.skillRequirements.find(x => x.taskId === t.id)?.skills ?? t.skills, required: constraints.demand.find(x => x.taskId === t.id)?.required ?? t.required}));
  const volunteers = scenario.volunteers.map(v => ({...v, maxAssignments: constraints.capacity.find(x => x.volunteerId === v.id)?.maxAssignments ?? v.maxAssignments, availability: v.availability.filter(s => !constraints.unavailable.some(x => x.volunteerId === v.id && x.slotIds.includes(s)))}));
  return {tasks, volunteers};
}

export function manualProvenance(constraints) {
  return Object.entries(constraints).flatMap(([kind, rows]) => rows.map((value, index) => ({sourceId: `manual:${kind}:${index}`, kind, constraintIndex: index, quote: null, value, status: 'confirmed', origin: 'Structured controls'})));
}
