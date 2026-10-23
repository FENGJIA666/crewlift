function csvCell(value) { const s=String(value??''); const safe=/^[=+@\-\t\r]/.test(s)?`'${s}`:s;return `"${safe.replaceAll('"','""')}"`; }
export function exportPlan(record, planId, format, revision) {
  const plan=record.plans.find(p=>p.id===planId);
  if(!plan)return null;
  const pack={application:'CrewLift',dataLabel:'Sample scenario — fictional people and event',schemaVersion:1,run:record.run,revision:revision??null,scenario:record.scenario,constraints:record.constraints,provenance:record.provenance,questions:record.questions??[],plan};
  if(format==='json')return {type:'application/json; charset=utf-8',extension:'json',content:JSON.stringify(pack,null,2)};
  if(format==='csv') {
    const header=['revision','run_id','task_id','task','room','time','volunteer_id','volunteer','skills','source_ids'];
    const rows=plan.assignments.flatMap(a=>{const task=record.effectiveTasks.find(t=>t.id===a.taskId);const slot=record.scenario.slots.find(s=>s.id===task.slotId);return a.volunteerIds.map(id=>{const v=record.scenario.volunteers.find(p=>p.id===id);return [revision?.number??'draft',record.run.id,task.id,task.title,task.room,slot.label,id,v.name,task.skills.join(';'),record.provenance.map(p=>p.sourceId).join(';')];});});
    return {type:'text/csv; charset=utf-8',extension:'csv',content:[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n'};
  }
  if(format==='brief') {
    const m=plan.metrics;
    const lines=[`CrewLift | ${record.scenario.title}`,`${plan.title} · ${revision?`Accepted revision ${revision.number}`:'Review draft'} · ${record.label}`,`Run: ${record.run.id}`,`Coverage: ${m.coveredSeats}/${m.requiredSeats} places | Assignment conflicts: ${m.conflicts}`,`${m.retainedAssignments} original assignments retained | ${m.changedPeople} people receive updated plans`,'',...plan.explanation,'','PERSONAL HANDOFF CARDS'];
    for(const card of plan.changeCards){lines.push('',card.name,`Before: ${card.before.map(t=>`${t.title} · ${t.room} · ${t.time}`).join('; ')||'Available crew'}`,`After: ${card.after.map(t=>`${t.title} · ${t.room} · ${t.time}`).join('; ')||'No assigned shift'}`,card.reason);}
    if(plan.uncovered.length)lines.push('','COVERAGE ACTIONS',...plan.uncovered.map(u=>`${u.taskId}: ${u.missing} additional qualified volunteer(s). ${u.reason}`));
    lines.push('','SOURCE TRACE',...record.provenance.map(p=>`${p.sourceId} | ${p.kind} | ${p.quote??JSON.stringify(p.value)}`),'',`Input SHA-256: ${record.run.inputHash}`,`Output SHA-256: ${record.run.outputHash}`);
    return {type:'text/plain; charset=utf-8',extension:'txt',content:lines.join('\n')+'\n'};
  }
  return null;
}
