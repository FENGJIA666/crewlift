# Deploy CrewLift on Vercel

CrewLift serves static assets from `public/` and its API from `api/index.mjs`. The public API stores each browser's roster, revisions and five most recent runs in durable Redis. The existing `npm start` command continues to provide a standalone local workspace.

## Configuration

Use a persistent Redis database with eviction disabled. Upstash's Free plan is sufficient for the demonstration. An anonymous 72-hour database is not suitable for the judging period. Configure the following production environment variables through your hosting account:

| Variable | Value or purpose |
| --- | --- |
| `CREWLIFT_PUBLIC_ORIGIN` | Exact published HTTPS origin, without a trailing slash |
| `CREWLIFT_SESSION_SECRET` | At least 32 cryptographically random characters |
| `NEBIUS_API_KEY` | Server-only Nebius Token Factory key |
| `KV_REST_API_URL` | Redis integration's HTTPS REST endpoint |
| `KV_REST_API_TOKEN` | Redis integration's server-only REST token |
| `CREWLIFT_STORE_NAMESPACE` | Stable, project-specific prefix; default `crewlift-production` |
| `CREWLIFT_LIVE_REQUEST_LIMIT` | Explicit authorized total request allocation; default `0` disables public inference |

`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are supported aliases. Keep the same namespace across deployments. Never expose these values in browser code, screenshots, command output or the repository.

Initialize the quota ledger once after authorizing the allocation. With storage credentials in a private ignored environment file, run:

```sh
CREWLIFT_LIVE_REQUEST_LIMIT=100 node --env-file=.env.local scripts/init-live-quota.mjs
```

The example is a 100-request allocation and must match the amount explicitly authorized for the deployment. Existing ledgers retain their original limit and usage. The ledger never expires; a missing ledger disables inference instead of creating a fresh allowance. A lower environment limit can reduce an existing allocation. Increasing it cannot reset or raise the stored allocation.

Deploy the intended Vercel project with Node.js 24, framework `Other`, output directory `public`, and the committed `vercel.json`. The published production domain must match `CREWLIFT_PUBLIC_ORIGIN`. Preview aliases intentionally fail the public API's exact-host check. Hosting creation, credentials and production deployment are operator-controlled steps.

## Request and cost controls

Every public live request checks Nebius's public model catalog, then atomically reserves one request in Redis before invoking the model. The accepted price ceilings are US$0.06 per million input tokens and US$0.24 per million output tokens. Failed requests consume their reservation, and the app never retries automatically. Each session receives at most five live attempts within its 24-hour window, separated by at least 30 seconds. Structured planning remains available independently of the live allocation.

The fixed request has two plain-text messages, no tools, at most 16,384 UTF-8 bytes for the entire encoded payload, and at most 4,096 output tokens with thinking disabled. NVIDIA's pinned tokenizer uses ByteLevel BPE without normalization, so its byte tokens can only be merged. Bounding the input by the entire encoded payload plus a conservative 1,024 tokens for the fixed chat template gives at most 17,408 input tokens. At the verified price ceilings:

```text
17,408 × $0.06 / 1,000,000 + 4,096 × $0.24 / 1,000,000
= $0.00202752 per request
100 requests ≤ $0.202752 in model token charges
```

For a deployment configured with a US$0.50 model-token ceiling across 100 requests, this bound fits within a conservative US$0.005 allocation per request. It depends on the provider honoring the published model tokenizer, output-token cap and catalog prices. The live pricing gate rejects higher or unavailable prices. It does not include unrelated account usage or hosting costs, and it is separate from an observed billing ledger.

Sources: [Nebius model catalog](https://tokenfactory.nebius.com/api/public/models_info), [NVIDIA tokenizer](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16/blob/a9904d24bcc1d289a1950fa9d2b978c47cf903b9/tokenizer.json), [NVIDIA chat template](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16/blob/a9904d24bcc1d289a1950fa9d2b978c47cf903b9/chat_template.jinja), [Upstash atomic Lua operations](https://upstash.com/blog/lua-scripting-on-upstash-redis-atomic-operations-over-http).

## Verification

```sh
npm test
node --env-file=.env.local scripts/verify-deployment-store.mjs
```

The second command uses a disposable `crewlift-verification-*` namespace, verifies real Redis concurrency and fencing, and deletes its own test keys. It never calls Nebius or modifies the production quota ledger.

After deployment, verify the actual public page and these behaviors: two browser sessions remain independent; a live brief produces the observed NVIDIA model and source-linked rules; accepting a plan advances only that browser's revision; JSON, CSV and action-brief exports match the accepted run. Public sessions use signed, `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Redis failure disables operations safely; no worker silently falls back to shared process state.
