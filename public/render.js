export const $ = id => document.getElementById(id);
export const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const firstName = (scenario, id) => scenario.volunteers.find(p => p.id === id)?.name.split(' ')[0] || id;
const title = (scenario, id) => scenario.tasks.find(t => t.id === id)?.title || id;
const slotName = (scenario, id) => scenario.slots.find(s => s.id === id)?.label || id;
const initials = name => name.split(' ').map(n => n[0]).slice(0,2).join('');

export function renderRules(scenario, constraints) {
  const rules = [];
  for (const r of constraints.unavailable || []) rules.push(`${firstName(scenario,r.volunteerId)} · ${r.slotIds.length === scenario.slots.length ? 'away today' : r.slotIds.map(s => slotName(scenario,s)).join(', ') + ' away'}`);
  for (const r of constraints.demand || []) {
    const task = scenario.tasks.find(t => t.id === r.taskId);
    rules.push(`${r.required} at ${task?.room || title(scenario,r.taskId)} · ${slotName(scenario,task?.slotId).split('–')[0]}`);
  }
  for (const r of constraints.locked || []) rules.push(`${firstName(scenario,r.volunteerId)} · ${title(scenario,r.taskId)} kept`);
  for (const r of constraints.capacity || []) rules.push(`${firstName(scenario,r.volunteerId)} · up to ${r.maxAssignments} shifts`);
  for (const r of constraints.skillRequirements || []) rules.push(`${title(scenario,r.taskId)} · ${r.skills.join(', ')}`);
  $('rule-chips').innerHTML = rules.map(r => `<span class="rule-chip"><span class="chip-icon" aria-hidden="true">✓</span>${html(r)}</span>`).join('') + '<span class="rule-chip context">Skills &amp; availability matched</span>';
  $('rules-json').value = JSON.stringify(constraints,null,2);
}

export function renderPlans(result, selectedId) {
  $('plan-options').innerHTML = result.plans.map(plan => {
    const minimal = plan.id === 'minimal-change';
    const selected = plan.id === selectedId;
    return `<button class="plan-option ${selected ? 'selected' : ''}" data-plan="${html(plan.id)}" aria-pressed="${selected}"><span class="radio-dot" aria-hidden="true"></span><div><div class="option-title-row"><h3>${minimal ? 'Keep the rhythm' : 'Share the energy'}</h3><span class="option-tag">${minimal ? 'MINIMAL CHANGE' : 'BALANCED LOAD'}</span></div><p>${minimal ? 'Preserve familiar roles. Focus updates where they matter.' : 'Spread the contribution. Give more crew members a part.'}</p><div class="option-stats"><span><strong>${html(plan.metrics.coveragePct)}%</strong> covered</span><span><strong>${html(plan.metrics.changedPeople)}</strong> people to update</span><span><strong>${html(plan.metrics.workloadSpread)}</strong> shift load gap</span></div></div></button>`;
  }).join('');
}

export function renderOutcome(plan, result) {
  const m = plan.metrics;
  const full = m.coveragePct === 100;
  $('result-badge').textContent = full ? 'Recovery ready' : 'Next steps mapped';
  $('outcome-heading').innerHTML = full ? 'Every role covered.<br>Team spirit, lifted.' : 'Your next step,<br>clearly in view.';
  $('outcome-copy').textContent = full ? 'A coordinated plan that makes every contribution count.' : `${m.coveredSeats} roles matched. ${m.requiredSeats - m.coveredSeats} more opportunities to bring your crew together.`;
  $('coverage-value').textContent = `${m.coveragePct}%`;
  $('coverage-note').textContent = `${m.coveredSeats} of ${m.requiredSeats} crew places filled with the right skills, at the right time.`;
  $('retained-value').textContent = m.retainedAssignments;
  $('changes-value').textContent = m.changedPeople;
  $('conflicts-value').textContent = m.conflicts;
  $('outcome-footer-text').textContent = 'Skills, availability & capacity checked together';
  $('mode-badge').innerHTML = `<span></span>${html(result.mode === 'live' ? 'Live Nemotron' : 'Sample scenario')}`;
  $('engine-caption').innerHTML = `<span class="status-dot"></span>${html(result.mode === 'live' ? 'Nemotron rules + constraint solver' : 'Constraint solver · sample event')}`;
  $('run-status').textContent = `Plan computed in ${result.run.durationMs} ms · ${result.mode === 'live' ? 'Live Nemotron' : 'Sample scenario'}`;
  document.querySelector('.outcome-panel').setAttribute('aria-busy','false');
}

export function renderSchedule(scenario, plan, constraints, view) {
  const unavailable = new Set((constraints.unavailable || []).flatMap(r => r.slotIds.map(s => `${r.volunteerId}:${s}`)));
  const assignments = view === 'before' ? scenario.tasks.map(t => ({taskId:t.id,volunteerIds:t.initialAssignees})) : plan?.assignments || [];
  const rows = scenario.volunteers.map((person, i) => {
    const cells = scenario.slots.map(slot => {
      const tasks = scenario.tasks.filter(t => t.slotId === slot.id && assignments.find(a => a.taskId === t.id)?.volunteerIds.includes(person.id));
      const away = unavailable.has(`${person.id}:${slot.id}`) || !person.availability.includes(slot.id);
      let content = tasks.map(task => {
        const added = view === 'after' && !task.initialAssignees.includes(person.id);
        return `<span class="assignment ${added ? 'new' : ''} ${away ? 'needs-action' : ''}" title="${html(task.room || task.title)}${away ? ' · Availability update' : ''}">${added ? '<span class="new-symbol" aria-hidden="true">+</span>' : ''}${html(task.title)}${away ? ' · update needed' : ''}</span>`;
      }).join('');
      if (!content) content = away ? `<span class="assignment unavailable">${person.availability.includes(slot.id) ? 'Away this shift' : 'Outside availability'}</span>` : '<span class="free-slot">Available</span>';
      return `<div>${content}</div>`;
    }).join('');
    return `<div class="schedule-row"><div class="schedule-person"><span class="person-avatar tint-${i%4}">${html(initials(person.name))}</span><div><strong>${html(person.name)}</strong><span class="person-skill">${html(person.skills.join(' · '))}</span></div></div>${cells}</div>`;
  }).join('');
  $('schedule').style.setProperty('--slot-count',scenario.slots.length);
  $('schedule').innerHTML = `<div class="schedule-header"><div>YOUR CREW</div>${scenario.slots.map((s,i) => `<div><span class="slot-title">SHIFT ${i+1}</span>${html(s.label)}</div>`).join('')}</div>${rows}`;
  $('roster-description').textContent = view === 'before' ? 'Your starting roster, with the current availability updates.' : 'Every role has a name. Every teammate has a clear next move.';
  $('crew-directory').innerHTML = scenario.volunteers.map((person,i) => `<div class="crew-card"><span class="person-avatar tint-${i%4}">${html(initials(person.name))}</span><div><strong>${html(person.name)}</strong><p>${html(person.skills.join(' · '))}</p><p>Up to ${html((constraints.capacity || []).find(c => c.volunteerId === person.id)?.maxAssignments ?? person.maxAssignments)} shifts</p></div></div>`).join('');
}

export function renderEvidence(result, plan) {
  const items = [
    ['Event data', 'Makers Morning · sample scenario'],
    ['Rule source', result.mode === 'live' ? 'NVIDIA Nemotron via Nebius Token Factory' : 'Explicit planning rules'],
    ['Plan', `${plan.title} · ${plan.metrics.coveragePct}% coverage`],
    ['Run ID', result.run.id],
    ['Created', new Date(result.run.createdAt).toLocaleString('en-SG', {timeZone:'Asia/Singapore'}) + ' SGT'],
    ['Compute duration', `${result.run.durationMs} ms`],
    ['Model', result.run.model || 'Local constraint solver'],
    ['Input hash', result.run.inputHash],
    ['Output hash', result.run.outputHash]
  ];
  if(result.run.usage) items.push(['Tokens', `${result.run.usage.total_tokens} total`]);
  $('evidence-content').innerHTML = `<dl class="evidence-list">${items.map(([k,v]) => `<div><dt>${html(k)}</dt><dd class="${k.includes('hash') ? 'hash' : ''}">${html(v)}</dd></div>`).join('')}</dl><ul class="run-notes">${(plan.explanation || []).map(s => `<li>${html(s)}</li>`).join('')}</ul>`;
}

export function renderDeltas(scenario, plan) {
  const deltas = scenario.volunteers.map(person => {
    const updates = (plan.changes || []).flatMap(change => {
      const task = scenario.tasks.find(t => t.id === change.taskId);
      const when = slotName(scenario,task?.slotId);
      if (change.added.includes(person.id)) return [`Join ${task?.title} · ${when}`];
      if (change.removed.includes(person.id)) return [`Hand over ${task?.title} · ${when}`];
      return [];
    });
    return updates.length ? `<div class="delta-person"><strong>${html(person.name)}</strong><span>${updates.map(html).join('<br>')}</span></div>` : '';
  }).join('');
  $('person-deltas').innerHTML = deltas || '<p class="all-set-message">Your crew’s current assignments carry forward together.</p>';
}
