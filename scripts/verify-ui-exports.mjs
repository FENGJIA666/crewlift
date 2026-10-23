import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {auditAssignments,enumerateOptimum} from './verify-oracle.mjs';

// Read-only export retrieval from a run already created and accepted by the user
// or Lead Manager. This script cannot call plan, accept, reset or any provider.
const args=process.argv.slice(2);
const value=name=>args[args.indexOf(name)+1];
assert(args.includes('--run-id')&&args.includes('--revision'),'Pass the observed UI --run-id and accepted --revision.');
const runId=value('--run-id');
const revision=Number(value('--revision'));
const planId=args.includes('--plan-id')?value('--plan-id'):'minimal-change';
assert(/^[0-9a-f-]{36}$/i.test(runId),'Use the actual recorded UUID run ID.');
assert(Number.isInteger(revision)&&revision>0);
assert(['minimal-change','balanced'].includes(planId));
const base='http://127.0.0.1:4187';
const model='nvidia/Nemotron-3_5-Lightning';
const directory=new URL('../evidence/live/',import.meta.url);
await mkdir(directory,{recursive:true});
const exports={};
for(const format of ['json','csv','brief']){
  const response=await fetch(base+'/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId,planId,format})});
  assert.equal(response.status,200,`${format} export HTTP status`);
  const content=await response.text();
  exports[format]={content,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex'),contentType:response.headers.get('content-type'),disposition:response.headers.get('content-disposition')};
}
const pack=JSON.parse(exports.json.content);
assert.equal(pack.run.id,runId);
if(args.includes('--input-hash'))assert.equal(pack.run.inputHash,value('--input-hash'),'Matches the observed UI input hash');
if(args.includes('--output-hash'))assert.equal(pack.run.outputHash,value('--output-hash'),'Matches the observed UI output hash');
assert.equal(pack.revision.runId,runId);
assert.equal(pack.revision.number,revision);
assert.equal(pack.revision.planId,planId);
assert.equal(pack.plan.id,planId);
assert.equal(pack.run.requestedModel,model);
assert.equal(pack.run.returnedModel,model);
assert.equal(pack.run.model,model);
const usage=pack.run.usage;
for(const key of ['prompt_tokens','completion_tokens','total_tokens'])assert(Number.isInteger(usage[key])&&usage[key]>=0);
assert.equal(usage.prompt_tokens+usage.completion_tokens,usage.total_tokens);
assert(usage.total_tokens>0);
assert(pack.run.inferenceDurationMs>=0);
assert.deepEqual(pack.questions,[]);

const clause={unavailable:'Ava cannot attend any of the three shifts',demand:'The creative workshop in Studio A needs two facilitators from 10:00 to 11:00',locked:'Keep Chloe on the 09:00 gallery tour'};
const scenario=JSON.parse(await readFile(new URL('../fixtures/scenario.json',import.meta.url),'utf8'));
assert.deepEqual(pack.constraints,scenario.initialConstraints,'Reviewed default brief constraints');
assert.equal(pack.provenance.length,3);
for(const row of pack.provenance){
  assert.equal(row.sourceId,'brief:0');
  assert.equal(row.origin,'NVIDIA Nemotron extraction');
  assert.equal(row.constraintIndex,0);
  assert(scenario.defaultBrief.includes(row.quote),'Exact original source passage');
  assert(row.quote.includes(clause[row.kind]),'Full supporting clause for this exact constraint');
  assert.deepEqual(row.value,pack.constraints[row.kind][0]);
}
const assignments=Object.fromEntries(pack.plan.assignments.map(row=>[row.taskId,[...row.volunteerIds].sort()]));
const independent=auditAssignments(pack.scenario,pack.constraints,assignments);
assert.equal(independent.valid,true,independent.problems.join('; '));
const optimum=enumerateOptimum(pack.scenario,pack.constraints);
assert.equal(independent.covered,optimum.best.covered);
assert.equal(pack.plan.metrics.coveredSeats,independent.covered);
assert.equal(pack.plan.metrics.requiredSeats,independent.required);
assert.equal(pack.plan.metrics.changedPeople,independent.changedPeopleCount);
assert.equal(pack.plan.metrics.changedAssignments,independent.assignmentChanges);
assert.equal(pack.plan.metrics.loadSquaredSum,independent.squaredWorkload);
if(planId==='minimal-change')assert.equal(independent.changedPeopleCount,optimum.best.changedPeopleCount);
else assert.equal(independent.squaredWorkload,optimum.bestBalance.squaredWorkload);

const rows=[];let row=[],cell='',quoted=false;
for(let i=0;i<exports.csv.content.length;i+=1){const c=exports.csv.content[i];
  if(c==='"'){if(quoted&&exports.csv.content[i+1]==='"'){cell+='"';i+=1;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(cell);cell='';}
  else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
  else cell+=c;
}
assert.equal(quoted,false);
assert.deepEqual(rows.shift(),['revision','run_id','task_id','task','room','time','volunteer_id','volunteer','skills','source_ids']);
assert.equal(rows.length,independent.covered);
for(const fields of rows){
  assert.equal(fields.length,10);assert.equal(fields[0],String(revision));assert.equal(fields[1],runId);
  const task=pack.scenario.tasks.find(t=>t.id===fields[2]);
  const slot=pack.scenario.slots.find(s=>s.id===task.slotId);
  assert.equal(fields[3],task.title);assert.equal(fields[4],task.room);assert.equal(fields[5],slot.label);
  assert.equal(fields[7],pack.scenario.volunteers.find(v=>v.id===fields[6]).name);
}
assert.deepEqual(rows.map(fields=>`${fields[2]}:${fields[6]}`).sort(),pack.plan.assignments.flatMap(a=>a.volunteerIds.map(id=>`${a.taskId}:${id}`)).sort());

const text=exports.brief.content;
assert(text.includes(`Accepted revision ${revision}`));assert(text.includes(`Run: ${runId}\n`));
assert(text.includes(`Coverage: ${independent.covered}/${independent.required} places | Assignment conflicts: 0`));
const cards=text.split('PERSONAL HANDOFF CARDS\n')[1]?.split('\nSOURCE TRACE')[0];assert(cards);
assert.equal((cards.match(/^Before: /gm)??[]).length,pack.plan.changeCards.length);
assert.equal((cards.match(/^After: /gm)??[]).length,pack.plan.changeCards.length);
assert.deepEqual(pack.plan.changeCards.map(card=>card.volunteerId).sort(),independent.changedPeople.sort());
for(const card of pack.plan.changeCards){
  const block=cards.split(`\n${card.name}\n`)[1]?.split('\n\n')[0];assert(block);
  const before=card.before.map(t=>`${t.title} · ${t.room} · ${t.time}`).join('; ')||'Available crew';
  const after=card.after.map(t=>`${t.title} · ${t.room} · ${t.time}`).join('; ')||'No assigned shift';
  assert(block.includes(`Before: ${before}\n`));assert(block.includes(`After: ${after}\n`));assert(block.includes(card.reason));
  assert.deepEqual(card.before.map(t=>t.taskId).sort(),pack.scenario.tasks.filter(t=>t.initialAssignees.includes(card.volunteerId)).map(t=>t.id).sort());
  assert.deepEqual(card.after.map(t=>t.taskId).sort(),pack.plan.assignments.filter(a=>a.volunteerIds.includes(card.volunteerId)).map(a=>a.taskId).sort());
}
assert(text.includes(`Input SHA-256: ${pack.run.inputHash}`));assert(text.includes(`Output SHA-256: ${pack.run.outputHash}`));
const patterns=[/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,/Bearer\s+[A-Za-z0-9_./+=-]{8,}/i,/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,/"(?:apiKey|api_key|password|authorization|access_token|refresh_token|card_number|billing_address|address_line\d*)"\s*:\s*"[^"\n]+"/i];
for(const file of Object.values(exports))assert.equal(patterns.some(pattern=>pattern.test(file.content)),false,'Potential sensitive value in export; inspect locally without printing it.');
const files={};
for(const [format,file]of Object.entries(exports)){
  const filename=`final-ui-accepted-r${revision}-${format==='brief'?'handoff.txt':`plan.${format}`}`;
  await writeFile(new URL(filename,directory),file.content);
  files[format]={file:filename,bytes:file.bytes,sha256:file.sha256,contentType:file.contentType,contentDisposition:file.disposition};
}
const sourcePaths=['server.mjs','lib/nebius.mjs','lib/solver.mjs','lib/export.mjs','fixtures/scenario.json','public/app.js','scripts/verify-ui-exports.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(new URL(`../${path}`,import.meta.url))).digest('hex')])));
const report={verifiedAt:new Date().toISOString(),scope:'Independent read-only retrieval and validation of three exports from the observed accepted browser run; zero inference, accept or reset requests',runId,planId,acceptedRevision:pack.revision,modelIdentity:{requested:pack.run.requestedModel,returned:pack.run.returnedModel,displayed:pack.run.model},usage,inferenceDurationMs:pack.run.inferenceDurationMs,sourceClauses:3,metrics:pack.plan.metrics,independentAudit:{valid:independent.valid,covered:independent.covered,required:independent.required,changedPeople:independent.changedPeopleCount,assignmentChanges:independent.assignmentChanges,enumeratedCandidateRosters:optimum.completeCandidates},exports:files,privacy:{checkedFiles:3,suspiciousPatternsFound:0,scope:'Pattern checks on fictional export content, not a universal secret-detection guarantee'},sourceHashes};
await writeFile(new URL('final-ui-independent-verification.json',directory),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({runId,revision,model:pack.run.returnedModel,usage,coverage:`${independent.covered}/${independent.required}`,changedPeople:independent.changedPeopleCount,independentCandidateRosters:optimum.completeCandidates,exportsVerified:3,secretPatternsFound:0,inferenceRequests:0},null,2));
