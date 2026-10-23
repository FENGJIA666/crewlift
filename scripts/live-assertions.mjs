import assert from 'node:assert/strict';
import {MODEL} from '../lib/nebius.mjs';
import {validateConstraints} from '../lib/constraints.mjs';

// This is a golden-fixture acceptance oracle, not a general semantic entailment claim.
const SUPPORT={
  unavailable:'Ava cannot attend any of the three shifts',
  demand:'The creative workshop in Studio A needs two facilitators from 10:00 to 11:00',
  locked:'Keep Chloe on the 09:00 gallery tour'
};

export function assertGoldenSources(result,brief,scenario){
  assert.equal(brief,scenario.defaultBrief,'Use the reviewed complete golden brief.');
  assert.deepEqual(result.constraints,validateConstraints(scenario.initialConstraints,scenario));
  assert.deepEqual(result.questions,[]);
  assert.equal(result.provenance.length,3);
  for(const [kind,support]of Object.entries(SUPPORT)){
    const items=result.provenance.filter(p=>p.kind===kind&&p.constraintIndex===0);
    assert.equal(items.length,1,`Exactly one source is required for ${kind}.`);
    const item=items[0];
    assert.equal(item.origin,'NVIDIA Nemotron extraction');assert.equal(item.status,'review');assert.equal(item.sourceId,'brief:0');
    assert.equal(typeof item.quote,'string');
    assert(brief.includes(item.quote),`${kind}: quote must be verbatim source text.`);
    assert(item.quote.includes(support),`${kind}: quote must contain its complete supporting clause, including the relevant entity, action and time scope.`);
    assert.deepEqual(item.value,result.constraints[kind][0],`${kind}: source must point to the extracted constraint.`);
  }
}

export function assertObservedModel(run){
  assert.equal(run.requestedModel,MODEL);
  assert.equal(run.returnedModel,MODEL,'The provider must return the requested model identity.');
  assert.equal(run.model,run.returnedModel,'The UI model field must reflect the provider response.');
}

export function tokenCharge(usage){
  const keys=['prompt_tokens','completion_tokens','total_tokens'];
  if(!usage||keys.some(k=>!Number.isInteger(usage[k])||usage[k]<0)||usage.total_tokens===0||usage.prompt_tokens+usage.completion_tokens!==usage.total_tokens)return null;
  // completion_tokens is already the provider's complete output count; never add
  // reasoning_tokens again, since it is a breakdown of completion tokens.
  return usage.prompt_tokens*0.06/1e6+usage.completion_tokens*0.24/1e6;
}

export function assertCsvExport(csv,record,plan,revision){
  const lines=csv.trimEnd().split(/\r?\n/);
  const rows=lines.map(line=>{
    const matches=[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)];
    assert.equal(matches.map(m=>m[0]).join(''),line,'CSV must preserve every quoted field.');
    return matches.map(m=>m[1].replaceAll('""','"'));
  });
  assert.deepEqual(rows[0],['revision','run_id','task_id','task','room','time','volunteer_id','volunteer','skills','source_ids']);
  const data=rows.slice(1);
  assert.equal(data.length,plan.metrics.coveredSeats);
  const actual=[];
  for(const row of data){assert.equal(row.length,10);assert.equal(row[0],String(revision.number));assert.equal(row[1],record.run.id);actual.push(`${row[2]}:${row[6]}`);}
  const expected=plan.assignments.flatMap(a=>a.volunteerIds.map(id=>`${a.taskId}:${id}`));
  assert.deepEqual(actual.sort(),expected.sort(),'CSV rows must match the selected plan exactly.');
}

export function assertBriefExport(text,record,plan,revision){
  assert(text.includes(`Accepted revision ${revision.number}`));
  assert(text.includes(`Run: ${record.run.id}\n`));
  assert(text.includes(`Coverage: ${plan.metrics.coveredSeats}/${plan.metrics.requiredSeats} places | Assignment conflicts: ${plan.metrics.conflicts}`));
  const cards=text.split('PERSONAL HANDOFF CARDS\n')[1]?.split('\nSOURCE TRACE')[0];
  assert(cards,'Brief must contain personal handoff cards.');
  assert.equal((cards.match(/^Before: /gm)??[]).length,plan.changeCards.length);
  assert.equal((cards.match(/^After: /gm)??[]).length,plan.changeCards.length);
  for(const card of plan.changeCards){
    assert(cards.includes(`\n${card.name}\n`));
    const block=cards.split(`\n${card.name}\n`)[1]?.split('\n\n')[0];
    assert(block);
    for(const task of card.before)assert(block.includes(`Before:`)&&block.split('\nAfter:')[0].includes(`${task.title} · ${task.room} · ${task.time}`));
    for(const task of card.after)assert(block.split('\nAfter:')[1]?.includes(`${task.title} · ${task.room} · ${task.time}`));
  }
  assert(text.includes(`Input SHA-256: ${record.run.inputHash}`));
  assert(text.includes(`Output SHA-256: ${record.run.outputHash}`));
}
