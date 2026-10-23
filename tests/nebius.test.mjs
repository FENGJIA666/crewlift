import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {interpretBrief,validateExtraction,MODEL} from '../lib/nebius.mjs';
const scenario=JSON.parse(await readFile(new URL('../fixtures/scenario.json',import.meta.url),'utf8'));
const brief='Ava cannot attend any of the three shifts.';
const extracted={constraints:{unavailable:[{volunteerId:'ava',slotIds:['s1','s2','s3']}]},evidence:[{kind:'unavailable',constraintIndex:0,quote:brief}],questions:[]};
test('model extraction requires exact brief evidence and known entity IDs',()=>{
  assert.equal(validateExtraction(extracted,brief,scenario).provenance[0].status,'review');
  assert.throws(()=>validateExtraction({...extracted,evidence:[{kind:'unavailable',constraintIndex:0,quote:'invented sentence'}]},brief,scenario),{code:'MODEL_REVIEW_REQUIRED'});
  assert.throws(()=>validateExtraction({...extracted,constraints:{unavailable:[{volunteerId:'nobody',slotIds:['s1']}]}},brief,scenario),{code:'UNKNOWN_ENTITY'});
  const stringIndex=structuredClone(extracted);stringIndex.evidence[0].constraintIndex='0';
  assert.equal(validateExtraction(stringIndex,brief,scenario).provenance[0].constraintIndex,0);
  stringIndex.evidence[0].constraintIndex='1';
  assert.throws(()=>validateExtraction(stringIndex,brief,scenario),{code:'MODEL_REVIEW_REQUIRED'});
});
test('missing API key blocks live mode before network access',async()=>{
  let called=false;await assert.rejects(()=>interpretBrief(brief,scenario,{apiKey:'',fetchImpl:()=>{called=true;}}),{code:'NEBIUS_NOT_CONFIGURED'});assert.equal(called,false);
});
test('response contract explicitly requires source and question arrays; source maps remain rejected',async()=>{
  let prompt;
  await interpretBrief(brief,scenario,{apiKey:'test-only-key',maximumRequestBytes:16384,fetchImpl:async(_url,options)=>{
    prompt=JSON.parse(options.body).messages[0].content;
    return new Response(JSON.stringify({model:MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(extracted)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}));
  }});
  assert(prompt.includes('"evidence":[],"questions":[]'));
  assert(prompt.includes('evidence MUST be a JSON array of objects, never an object, dictionary, or map'));
  assert(prompt.includes('questions MUST be a JSON array of strings'));
  const objectMap={unavailable:extracted.evidence[0]};
  assert.throws(()=>validateExtraction({...extracted,evidence:objectMap},brief,scenario),error=>error.code==='MODEL_REVIEW_REQUIRED'&&error.message.includes('complete source map'));
  assert.throws(()=>validateExtraction({...extracted,evidence:undefined},brief,scenario),{code:'MODEL_REVIEW_REQUIRED'});
});
test('adapter sends the actual NVIDIA model and returns sanitized response metadata (mock transport)',async()=>{
  let request;
  const result=await interpretBrief(brief,scenario,{apiKey:'test-only-key',fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({model:MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(extracted)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,secret:'never-copy'}}),{status:200,headers:{'Content-Type':'application/json'}});}});
  assert.equal(JSON.parse(request.options.body).model,MODEL);assert.equal(request.url,'https://api.tokenfactory.nebius.com/v1/chat/completions');assert.equal(result.requestedModel,MODEL);assert.equal(result.returnedModel,MODEL);assert.equal(result.model,result.returnedModel);assert.deepEqual(result.usage,{prompt_tokens:100,completion_tokens:50,total_tokens:150});assert(!JSON.stringify(result).includes('test-only-key'));
  assert.deepEqual(JSON.parse(request.options.body).chat_template_kwargs,{enable_thinking:false});
  assert.equal(result.provider.finishReason,'stop');assert.equal(result.provider.requestedThinking,false);
});
test('live context contains original event data without sample constraint answers',async()=>{
  let request;
  await interpretBrief(brief,scenario,{apiKey:'test-only-key',fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({model:MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(extracted)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}),{status:200});}});
  const {context,brief:sentBrief}=JSON.parse(request.messages[1].content);
  assert.deepEqual(Object.keys(context).sort(),['skills','slots','tasks','volunteers']);
  assert.deepEqual(context.volunteers,scenario.volunteers.map(({id,name})=>({id,name})));assert.equal(sentBrief,brief);
  for(const task of context.tasks)assert.deepEqual(Object.keys(task).sort(),['end','id','room','slotId','start','title']);
  assert.deepEqual(context.tasks.find(t=>t.id==='workshop-2'),{id:'workshop-2',title:'Creative workshop',room:'Studio A',slotId:'s2',start:'10:00',end:'11:00'});
  assert(!JSON.stringify(context).includes('initialConstraints'));assert(!JSON.stringify(context).includes('currentConstraints'));
  for(const key of ['initialAssignees','required','maxAssignments','availability'])assert(!JSON.stringify(context).includes(`"${key}"`));
  assert(!JSON.stringify(context).includes(JSON.stringify(scenario.initialConstraints)));
  assert(request.messages[0].content.includes('using only rules stated in this brief'));
  assert(request.messages[0].content.includes('Do not restate unchanged original rules'));
  assert(!request.messages[0].content.includes('retaining current constraints'));
});
test('observed model output that invents baseline source quotations is rejected unchanged',async()=>{
  const recorded=JSON.parse(await readFile(new URL('../fixtures/rejected-model-extraction.json',import.meta.url),'utf8'));
  assert.equal(recorded.extraction.constraints.demand[0].taskId,'workshop-1');
  assert.equal(recorded.extraction.evidence[2].quote,'workshop-2 requires 1 facilitator.');
  assert.throws(()=>validateExtraction(recorded.extraction,recorded.brief,scenario),{code:'MODEL_REVIEW_REQUIRED'});
});
test('empty or incomplete output preserves only safe provider diagnostics for a bounded retry',async()=>{
  for(const [finishReason,content,expectedCode]of [['length',null,'MODEL_INCOMPLETE_RESPONSE'],['stop',null,'MODEL_EMPTY_CONTENT'],['stop','null','MODEL_REVIEW_REQUIRED']]){
    const response={model:MODEL,choices:[{finish_reason:finishReason,message:{content,reasoning_content:'private internal reasoning must not be copied'}}],usage:{prompt_tokens:500,completion_tokens:4096,total_tokens:4596,completion_tokens_details:{reasoning_tokens:4096}}};
    const error=await interpretBrief(brief,scenario,{apiKey:'test-only-key',fetchImpl:async()=>new Response(JSON.stringify(response),{status:200})}).then(()=>null,e=>e);
    assert.equal(error.code,expectedCode);assert.equal(error.provider.finishReason,finishReason);assert.equal(error.provider.returnedModel,MODEL);assert.equal(error.provider.usage.completion_tokens,4096);assert.equal(error.provider.reasoningTokens,4096);assert(error.provider.reasoningCharacters>0);
    const serialized=JSON.stringify(error.provider);assert(!serialized.includes('private internal reasoning'));assert(!serialized.includes('test-only-key'));assert(!serialized.includes('Authorization'));
  }
});
test('missing and different provider model identities cannot produce a verified live result',async()=>{
  for(const returnedModel of [undefined,'another-provider/another-model']){
    const error=await interpretBrief(brief,scenario,{apiKey:'test-only-key',fetchImpl:async()=>new Response(JSON.stringify({model:returnedModel,choices:[{finish_reason:'stop',message:{content:JSON.stringify(extracted)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}),{status:200})}).then(()=>null,e=>e);
    assert.equal(error?.code,returnedModel?'MODEL_IDENTITY_MISMATCH':'MODEL_IDENTITY_MISSING');
    assert.deepEqual(error.modelIdentity,{requestedModel:MODEL,returnedModel:returnedModel??null});
  }
});
test('source validation failures retain only whitelisted parsed extraction for diagnosis',async()=>{
  const bad=structuredClone(extracted);bad.evidence[0].constraintIndex=1;bad.reasoning='never copy this reasoning';bad.headers={Authorization:'never copy this header'};bad.constraints.unavailable[0].debug='never copy this debug field';
  const response={model:MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(bad),reasoning_content:'never copy private thinking'}}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}};
  const error=await interpretBrief(brief,scenario,{apiKey:'test-only-key',fetchImpl:async()=>new Response(JSON.stringify(response),{status:200})}).then(()=>null,e=>e);
  assert.deepEqual(error.extraction.evidence,bad.evidence);assert.deepEqual(error.extraction.constraints,extracted.constraints);assert.deepEqual(error.extraction.questions,[]);
  assert(!JSON.stringify(error.extraction).includes('never copy'));assert(!JSON.stringify(error.extraction).includes('test-only-key'));
});
