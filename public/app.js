import {request, downloadPlan} from './api.js';
import {$, html, renderRules, renderPlans, renderOutcome, renderSchedule, renderEvidence, renderDeltas} from './render.js';

const state = {scenario:null, config:null, constraints:null, result:null, selectedId:'minimal-change', view:'after', busy:false, accepted:null, dirty:false};
const clone = value => JSON.parse(JSON.stringify(value));
const selectedPlan = () => state.result?.plans.find(p => p.id === state.selectedId) || state.result?.plans[0];
let toastTimer;
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3800);
}
function showError(error) {
  $('error-banner').textContent = error.message || String(error); $('error-banner').hidden = false;
  $('error-banner').scrollIntoView({block:'nearest',behavior:'smooth'});
}
function clearError() { $('error-banner').hidden = true; }
function setBusy(busy, live = false) {
  state.busy = busy;
  for (const id of ['run-button','extract-button','reset-button','accept-button']) $(id).disabled = busy;
  $('run-button').firstElementChild.textContent = busy ? (live ? 'Nemotron is shaping your rules…' : 'Finding your best crew plans…') : 'Build recovery plans';
  document.querySelector('.outcome-panel').setAttribute('aria-busy',String(busy));
}
function populateScenario() {
  const s = state.scenario;
  $('event-name').textContent = s.title;
  $('crew-count').textContent = `${s.volunteers.length} volunteers · ${s.slots.length} shifts`;
  $('scenario-preset').innerHTML = '<option value="default">Original change brief</option>' + s.presets.map(p => `<option value="${html(p.id)}">${html(p.label)}</option>`).join('');
  $('unavailable-person').innerHTML = '<option value="">Everyone available</option>' + s.volunteers.map(p => `<option value="${html(p.id)}">${html(p.name)}</option>`).join('');
  $('unavailable-slot').innerHTML = '<option value="all">All event slots</option>' + s.slots.map(p => `<option value="${html(p.id)}">${html(p.label)}</option>`).join('');
  $('demand-task').innerHTML = '<option value="">Keep original sizes</option>' + s.tasks.map(t => `<option value="${html(t.id)}">${html(t.title)} · ${html(s.slots.find(s => s.id === t.slotId)?.start)}</option>`).join('');
  $('demand-count').max = s.volunteers.length;
}
function syncRules() {
  renderRules(state.scenario,state.constraints);
  const absent = state.constraints.unavailable?.[0];
  $('unavailable-person').value = absent?.volunteerId || '';
  $('unavailable-slot').value = absent?.slotIds.length === 1 ? absent.slotIds[0] : 'all';
  const demand = state.constraints.demand?.[0];
  $('demand-task').value = demand?.taskId || '';
  $('demand-count').value = demand?.required ?? 2;
  state.formSnapshot = readFormRules();
}
function readFormRules() {
  return {person:$('unavailable-person').value,slot:$('unavailable-slot').value,taskId:$('demand-task').value,count:$('demand-count').value};
}
function renderResult() {
  const plan = selectedPlan(); if (!plan) return;
  renderPlans(state.result, plan.id);
  renderOutcome(plan,state.result);
  renderSchedule(state.scenario,plan,state.result.constraints,state.view);
  renderDeltas(state.scenario,plan);
  const questions = state.result.questions || [];
  $('review-questions').hidden = !questions.length;
  $('review-questions').innerHTML = `<strong>Clarify these details to complete your plan</strong><ul>${questions.map(q => `<li>${html(q)}</li>`).join('')}</ul><p>Confirm them in Edit rules, then build recovery plans.</p>`;
  $('rule-provenance').innerHTML = (state.result.provenance || []).map(p => `<div><strong>${html(p.kind)} · ${html(p.origin)}</strong><span>${p.quote ? `“${html(p.quote)}”` : 'Confirmed through the structured planning controls.'}</span></div>`).join('') || '<p>Original event requirements and availability.</p>';
  const accepted = state.accepted?.runId === state.result.run.id && state.accepted?.planId === plan.id;
  const requiresNextRun = state.accepted?.runId === state.result.run.id && !accepted;
  $('accept-button').disabled = accepted || requiresNextRun || state.busy || state.dirty || plan.metrics.coveragePct < 100 || questions.length > 0;
  $('accept-button').innerHTML = state.dirty ? 'Build plans to apply rules' : accepted ? '✓ Plan accepted' : requiresNextRun ? 'Build fresh plans to switch' : 'Use this plan <span aria-hidden="true">→</span>';
  $('accept-caption').textContent = state.dirty ? 'Your updated rules are ready. Build fresh plans to apply them.' : accepted ? `Revision ${state.accepted.revision.number} · ready for the next update` : plan.metrics.coveragePct < 100 ? 'Adjust availability or team sizes to complete coverage before accepting.' : questions.length ? 'Confirm the brief details in Edit rules, then build recovery plans.' : 'Set this plan as the starting point for your next change.';
  if(state.dirty) $('result-badge').textContent = 'Last computed plan';
  $('action-heading').textContent = accepted ? 'Your crew’s next chapter is ready.' : 'Ready to rally your crew.';
  for(const button of document.querySelectorAll('[data-export]')) button.disabled = false;
}
async function run(mode = 'sample') {
  if (state.busy) return;
  clearError(); setBusy(true,mode === 'live');
  try {
    state.result = await request('/api/plan',{mode, constraints:state.constraints, brief:$('change-brief').value});
    state.constraints = clone(state.result.constraints);
    state.dirty = false;
    syncRules(); renderResult();
    if (mode === 'live') toast('Nemotron structured your update. Review the rules and choose your plan.');
  } catch(error) { if(error.code === 'NEBIUS_NOT_CONFIGURED') $('connect-dialog').showModal(); else showError(error); }
  finally { setBusy(false); if(state.result) renderResult(); }
}
function rulesEdited(clearPreset = true) {
  state.dirty = true;
  renderRules(state.scenario,state.constraints);
  $('brief-help').textContent = 'Rules updated. Build recovery plans to apply them.';
  if(clearPreset) $('scenario-preset').value = 'default';
  $('run-button').firstElementChild.textContent = 'Apply rules & build plans';
  if(state.result) renderResult();
}
function updateFormRules({markDirty = true} = {}) {
  const current = readFormRules(), prior = state.formSnapshot || current;
  const {person,slot,taskId,count} = current;
  const required = Number(count);
  if(taskId && (count === '' || !Number.isInteger(required) || required < 0 || required > state.scenario.volunteers.length)) { showError(new Error(`Choose a team size from 0 to ${state.scenario.volunteers.length} people.`)); return false; }
  const previous = JSON.stringify(state.constraints);
  const previousUnavailable = state.constraints.unavailable || [];
  const previousDemand = state.constraints.demand || [];
  if(person !== prior.person || slot !== prior.slot) state.constraints.unavailable = person ? [{volunteerId:person,slotIds:slot === 'all' ? state.scenario.slots.map(s => s.id) : [slot]},...previousUnavailable.slice(1).filter(r => r.volunteerId !== person)] : previousUnavailable.slice(1);
  if(taskId !== prior.taskId || count !== prior.count) state.constraints.demand = taskId ? [{taskId,required},...previousDemand.slice(1).filter(r => r.taskId !== taskId)] : previousDemand.slice(1);
  state.formSnapshot = current;
  clearError();
  if(markDirty && previous !== JSON.stringify(state.constraints)) rulesEdited();
  return true;
}
async function acceptPlan() {
  if(!state.result || state.busy) return;
  clearError(); setBusy(true);
  try {
    const plan = selectedPlan();
    const response = await request('/api/accept',{runId:state.result.run.id,planId:plan.id});
    state.accepted = {runId:state.result.run.id,planId:plan.id,revision:response.revision};
    // Keep the current view's baseline until the next run so its changes remain visible.
    state.nextScenario = response.scenario || await request('/api/scenario');
    $('revision-label').textContent = `Accepted · revision ${response.revision.number}`;
    toast('Plan accepted. Your next update will build on this crew schedule.');
  } catch(error) { showError(error); }
  finally { setBusy(false);renderResult(); }
}
async function startRun(mode) {
  // Read visible controls at the action boundary as well as on each input event.
  // This keeps keyboard edits, autofill, and stepper edits in the submitted rules.
  if(mode === 'sample' && !$('constraints-editor').hidden && !updateFormRules({markDirty:false})) return;
  if(state.nextScenario) { state.scenario = state.nextScenario; state.nextScenario = null; }
  await run(mode);
}
async function reset() {
  if(state.busy) return;
  clearError();setBusy(true);
  try {
    await request('/api/reset',{});
    state.scenario = await request('/api/scenario');
    state.nextScenario = null; state.accepted = null; state.selectedId = 'minimal-change';state.dirty = false;
    state.constraints = clone(state.scenario.initialConstraints);
    $('change-brief').value = state.scenario.defaultBrief;
    $('revision-label').textContent = 'Choose a plan to move forward';
    $('brief-help').textContent = state.config.liveAvailable ? 'Include all active availability, staffing and preserved-role rules.' : 'Sample brief · Edit planning rules to explore another scenario.';
    populateScenario(); syncRules();
  } catch(error) { showError(error); return; }
  finally { setBusy(false); }
  await run();toast('Makers Morning is ready for a fresh plan.');
}
function bindEvents() {
  $('run-button').addEventListener('click',() => startRun('sample'));
  $('extract-button').addEventListener('click',() => state.config.liveAvailable ? startRun('live') : $('connect-dialog').showModal());
  $('connect-button').addEventListener('click',() => $('connect-dialog').showModal());
  document.querySelectorAll('[data-close-dialog]').forEach(b => b.addEventListener('click',() => b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click',e => { if(e.target === d) { const r=d.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close(); } }));
  $('reset-button').addEventListener('click',reset);
  $('accept-button').addEventListener('click',acceptPlan);
  $('edit-constraints-button').addEventListener('click',() => {
    const open = $('constraints-editor').hidden;
    $('constraints-editor').hidden = !open; $('edit-constraints-button').setAttribute('aria-expanded',String(open));
    $('edit-constraints-button').innerHTML = open ? 'Close editor ↑' : 'Edit rules ↗';
  });
  for(const id of ['unavailable-person','unavailable-slot','demand-task']) $(id).addEventListener('change',() => updateFormRules());
  $('demand-count').addEventListener('input',() => updateFormRules());
  $('demand-count').addEventListener('change',() => updateFormRules());
  $('apply-json').addEventListener('click',() => {
    try {
      const rules = JSON.parse($('rules-json').value);
      if(!rules || Array.isArray(rules) || typeof rules !== 'object') throw new Error('Use a JSON object containing your planning rules.');
      const expected = ['unavailable','demand','locked','skillRequirements','capacity'];
      for(const key of Object.keys(rules)) {
        if(!expected.includes(key) || !Array.isArray(rules[key])) throw new Error('Use supported rule names containing arrays of entries.');
        if(rules[key].some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Each rule must be an object.');
      }
      if((rules.unavailable || []).some(r => !Array.isArray(r.slotIds)) || (rules.skillRequirements || []).some(r => !Array.isArray(r.skills))) throw new Error('Time slots and skills must be arrays.');
      state.constraints = rules; syncRules();rulesEdited();clearError();toast('Planning rules applied. Build plans to see your new options.');
    } catch(error) { showError(new Error(`Please check your planning rules: ${error.message}`)); }
  });
  $('scenario-preset').addEventListener('change',() => {
    const preset = state.scenario.presets.find(p => p.id === $('scenario-preset').value);
    state.constraints = clone(preset?.constraints || state.scenario.initialConstraints);
    $('change-brief').value = preset?.brief || state.scenario.defaultBrief;
    syncRules();rulesEdited(false);$('brief-help').textContent = 'Scenario selected. Build plans to see your options.';
  });
  $('change-brief').addEventListener('input',() => $('brief-help').textContent = 'Include all active availability, staffing and preserved-role rules.');
  $('plan-options').addEventListener('click',event => { const card=event.target.closest('[data-plan]');if(card) { state.selectedId=card.dataset.plan;renderResult(); } });
  for(const view of ['before','after']) $(`view-${view}`).addEventListener('click',() => {
    state.view=view;
    for(const v of ['before','after']) { $(`view-${v}`).classList.toggle('selected',v===view);$(`view-${v}`).setAttribute('aria-pressed',String(v===view)); }
    renderSchedule(state.scenario,selectedPlan(),state.result.constraints,view);
  });
  $('crew-toggle').addEventListener('click',() => { const open=$('crew-directory').hidden;$('crew-directory').hidden=!open;$('crew-toggle').setAttribute('aria-expanded',String(open));$('crew-toggle').textContent=open?'Close crew directory ↑':'Meet the crew ↓'; });
  document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click',async () => {
    if(!state.result) return;button.disabled=true;
    try { await downloadPlan(state.result.run.id,selectedPlan().id,button.dataset.export);toast('Your action pack is ready to share with your crew.'); } catch(error) { showError(error); } finally { button.disabled=false; }
  }));
  $('evidence-button').addEventListener('click',() => { if(state.result) { renderEvidence(state.result,selectedPlan());$('evidence-dialog').showModal(); } });
}
async function init() {
  bindEvents();
  for(const button of document.querySelectorAll('[data-export]')) button.disabled=true;
  setBusy(true);
  try {
    [state.config,state.scenario] = await Promise.all([request('/api/config'),request('/api/scenario')]);
    state.constraints=clone(state.scenario.initialConstraints);
    populateScenario();syncRules();$('change-brief').value=state.scenario.defaultBrief;
    $('change-brief').readOnly = !state.config.liveAvailable;
    $('brief-mode-label').textContent = state.config.liveAvailable ? 'YOUR BRIEF' : 'SAMPLE BRIEF';
    $('change-brief-label').textContent = state.config.liveAvailable ? 'Describe your event update' : 'Sample change brief';
    $('brief-help').textContent = state.config.liveAvailable ? 'Include all active availability, staffing and preserved-role rules.' : 'Sample brief · Edit planning rules to explore another scenario.';
    if(state.scenario.revision?.number) $('revision-label').textContent = `Current baseline · revision ${state.scenario.revision.number}`;
    $('connect-button').innerHTML=state.config.liveAvailable?'Nebius configured <span aria-hidden="true">✓</span>':'Connect Nebius <span aria-hidden="true">↗</span>';
    setBusy(false);await run();
  } catch(error) { setBusy(false);showError(error);$('run-status').textContent='Connect to the local CrewLift server to start planning.'; }
}
init();
