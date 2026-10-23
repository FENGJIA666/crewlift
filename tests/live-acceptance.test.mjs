import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertGoldenSources,assertObservedModel,tokenCharge,assertCsvExport,assertBriefExport} from '../scripts/live-assertions.mjs';
import {validateExtraction,MODEL} from '../lib/nebius.mjs';
import {solvePlans} from '../lib/solver.mjs';
import {exportPlan} from '../lib/export.mjs';
const scenario=JSON.parse(await readFile(new URL('../fixtures/scenario.json',import.meta.url),'utf8'));
const sentences=scenario.defaultBrief.match(/[^.]+\./g).map(s=>s.trim());
const raw={constraints:scenario.initialConstraints,evidence:['unavailable','demand','locked'].map((kind,i)=>({kind,constraintIndex:0,quote:sentences[i]})),questions:[]};
const result=()=>validateExtraction(structuredClone(raw),scenario.defaultBrief,scenario);

test('golden sources require the corresponding complete support for absence, demand and lock',()=>{
  assertGoldenSources(result(),scenario.defaultBrief,scenario);
  for(const quotes of [['Ava','Ava','Ava'],[sentences[0],sentences[0],sentences[0]],[sentences[0],'two facilitators',sentences[2]],[sentences[0],sentences[1],'Chloe']]){
    const bad=structuredClone(raw);bad.evidence.forEach((item,i)=>item.quote=quotes[i]);
    // These are verbatim substrings, but they do not establish the three constraints.
    const parsed=validateExtraction(bad,scenario.defaultBrief,scenario);
    assert.throws(()=>assertGoldenSources(parsed,scenario.defaultBrief,scenario));
  }
});
test('observed-model assertion rejects requested-only and mismatched identities',()=>{
  assertObservedModel({requestedModel:MODEL,returnedModel:MODEL,model:MODEL});
  assert.throws(()=>assertObservedModel({requestedModel:MODEL,model:MODEL}));
  assert.throws(()=>assertObservedModel({requestedModel:MODEL,returnedModel:'another-model',model:MODEL}));
});
test('incomplete, negative and inconsistent token usage yields unknown cost',()=>{
  for(const usage of [undefined,{total_tokens:150},{prompt_tokens:100,completion_tokens:-1,total_tokens:99},{prompt_tokens:100,completion_tokens:50,total_tokens:151}])assert.equal(tokenCharge(usage),null);
  assert.equal(tokenCharge({prompt_tokens:100,completion_tokens:50,total_tokens:150,completion_tokens_details:{reasoning_tokens:20}}),0.000018);
});
test('CSV and handoff verification checks actual run, revision, assignments and cards',()=>{
  const extracted=result(),solved=solvePlans(scenario,extracted.constraints);
  const record={scenario,label:'Sample scenario · mocked verification only',...extracted,...solved,run:{id:'offline-fixture-run',inputHash:'input-fixture-hash',outputHash:'output-fixture-hash'}};
  const plan=solved.plans[0],revision={number:1};
  const csv=exportPlan(record,plan.id,'csv',revision).content,brief=exportPlan(record,plan.id,'brief',revision).content;
  assertCsvExport(csv,record,plan,revision);assertBriefExport(brief,record,plan,revision);
  assert.throws(()=>assertCsvExport(csv.replaceAll('offline-fixture-run','wrong-run'),record,plan,revision));
  assert.throws(()=>assertCsvExport(csv.split('\r\n').slice(0,-2).join('\r\n'),record,plan,revision));
  assert.throws(()=>assertBriefExport(brief.replace('Accepted revision 1','Accepted revision 2'),record,plan,revision));
  assert.throws(()=>assertBriefExport(brief.replaceAll(' · Atrium · ',' · Wrong room · '),record,plan,revision));
});
