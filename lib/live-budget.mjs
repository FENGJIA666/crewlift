import {AppError} from './constraints.mjs';

export const LIVE_BUDGET=Object.freeze({
  model:'nvidia/Nemotron-3_5-Lightning',maximumRequestBytes:16384,
  templateTokenAllowance:1024,maximumOutputTokens:4096,
  inputUSDPerMillion:0.06,outputUSDPerMillion:0.24,
});
export const maximumTokenChargeUSD=((LIVE_BUDGET.maximumRequestBytes+LIVE_BUDGET.templateTokenAllowance)*LIVE_BUDGET.inputUSDPerMillion+LIVE_BUDGET.maximumOutputTokens*LIVE_BUDGET.outputUSDPerMillion)/1_000_000;

// NVIDIA's pinned tokenizer is ByteLevel BPE without a normalizer. Each UTF-8
// byte starts at most one token, then BPE merges reduce that count. The fixed
// two-message/no-tools chat template adds fewer than 1,024 tokens. The full JSON
// body is an intentionally larger bound than the two decoded message strings.
// Source revision: a9904d24bcc1d289a1950fa9d2b978c47cf903b9.
export function assertBoundedPayload(payload,encoded){
  const valid=payload.model===LIVE_BUDGET.model&&payload.max_tokens===LIVE_BUDGET.maximumOutputTokens&&payload.chat_template_kwargs?.enable_thinking===false&&!payload.tools&&payload.messages?.length===2&&payload.messages[0]?.role==='system'&&payload.messages[1]?.role==='user'&&payload.messages.every(m=>typeof m.content==='string');
  if(!valid||Buffer.byteLength(encoded)>LIVE_BUDGET.maximumRequestBytes)throw new AppError('REQUEST_TOO_LARGE','Shorten this brief to fit the demo inference allowance.',413);
}

export async function assertCurrentPricing({fetchImpl=fetch}={}){
  try{
    const response=await fetchImpl('https://tokenfactory.nebius.com/api/public/models_info',{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error();const models=await response.json();
    const model=models.flatMap(m=>m.flavors||[]).find(m=>m.model_id===LIVE_BUDGET.model);
    if(!Number.isFinite(model?.input_price_per_million_tokens)||!Number.isFinite(model?.output_price_per_million_tokens)||model.input_price_per_million_tokens<0||model.output_price_per_million_tokens<0||model.input_price_per_million_tokens>LIVE_BUDGET.inputUSDPerMillion||model.output_price_per_million_tokens>LIVE_BUDGET.outputUSDPerMillion)throw Error();
  }catch{throw new AppError('PRICING_CHECK_UNAVAILABLE','Live interpretation is awaiting its pricing check. Continue with the planning controls.',503);}
}
