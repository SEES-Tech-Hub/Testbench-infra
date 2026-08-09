# Testbench-infra

Deploy configs and ops tooling for Testbench's backend services. This repo does **not**
contain application code — `testbench-api` and `testbench-pipeline` each live in their
own repo and deploy independently to the Heroku apps described below.

## Services

| App | Repo | Stack | Role |
|---|---|---|---|
| [testbench-api](https://dashboard.heroku.com/apps/testbench-api) | testbench-api | FastAPI (Python) | Public API, owns the DB schema |
| [testbench-pipeline](https://dashboard.heroku.com/apps/testbench-pipeline) | testbench-pipeline | Node/Express | OCR/LLM extraction |

- testbench-api: https://testbench-api-53f53b05d813.herokuapp.com/
- testbench-pipeline: https://testbench-pipeline-0a144388bf78.herokuapp.com/

## Dyno tier — read this before touching dyno settings

**Both apps must run on Basic dynos. Never switch either app to Eco.**

Eco dynos sleep after 30 minutes of inactivity, which is disqualifying for this
project (always-on is a hard requirement). Basic dyno = $7/mo per app, always-on,
no sleep.

If you ever see a dyno formation show `Eco` for either app, fix it immediately:
```
heroku ps:type basic -a testbench-api
heroku ps:type basic -a testbench-pipeline
```

## First deploy — dyno formation

Heroku only creates a `web` process type once a Procfile has actually been deployed.
Since this repo holds templates only (not the app code), the dyno type/scale below
could **not** be set at infra setup time — each service owner must run this once,
right after their first `git push heroku main`:

```
heroku ps:type basic -a testbench-api
heroku ps:scale web=1 -a testbench-api

heroku ps:type basic -a testbench-pipeline
heroku ps:scale web=1 -a testbench-pipeline
```

## Deploying

From each service's own repo (not this one):

```
heroku git:remote -a testbench-api        # or testbench-pipeline
git push heroku main
```

Alternatively, set up GitHub auto-deploy per app in the Heroku dashboard
(Deploy tab → GitHub → connect repo → enable automatic deploys).

## Database

A single Heroku Postgres **essential-0** ($5/mo) database is provisioned on
`testbench-api` and shared by both services — it is not reprovisioned on
`testbench-pipeline`. Both services read `DATABASE_URL` from their own config vars;
the value must match across both apps.

To rotate/regenerate credentials, use `heroku pg:credentials:rotate -a testbench-api`
and re-sync `DATABASE_URL` to testbench-pipeline afterward — the shared value will
change.

## Deploy templates

Each service's `app.json`, `Procfile`, and `.env.example` live under
`/deploy/<service-name>/` in this repo, for the service repo to copy or reference:

```
deploy/testbench-api/app.json
deploy/testbench-api/Procfile
deploy/testbench-api/.env.example
deploy/testbench-pipeline/app.json
deploy/testbench-pipeline/Procfile
deploy/testbench-pipeline/.env.example
```

## Config vars

### testbench-api

| Var | Status |
|---|---|
| `DATABASE_URL` | ✅ set (from Postgres provisioning) |
| `JWT_SECRET` | ✅ set (generated, `openssl rand -hex 32`) |
| `R2_ACCOUNT_ID` | ✅ set |
| `R2_ACCESS_KEY` | ✅ set |
| `CLOUDFLARE_WORKER_TRIGGER_URL` | ✅ set — `https://testbench-worker.bdev5592.workers.dev` (see [Cloudflare Worker](#cloudflare-worker) below) |

### testbench-pipeline

| Var | Status |
|---|---|
| `DATABASE_URL` | ✅ set (same value as testbench-api — shared DB) |
| `R2_ACCOUNT_ID` | ✅ set |
| `R2_ACCESS_KEY` | ✅ set |
| `R2_SECRET_KEY` | ✅ set |
| `OCR_API_KEY` | ✅ set — Azure AI Services (Document Intelligence) subscription key |
| `GROQ_API_KEY` | ✅ set |
| `VISION_LLM_API_KEY` | ✅ set — same Azure key as `OCR_API_KEY` (one Azure resource serves both OCR and vision extraction) |
| `CONFIDENCE_THRESHOLD` | ✅ set to `0.65` — calibrated against a real scanned exam script via Azure Document Intelligence (`prebuilt-layout`). See note below. |
| `AZURE_OCR_ENDPOINT` | ✅ set — not in the original var list, but required by Azure alongside the key. Format: `https://<resource>.cognitiveservices.azure.com/` |
| `AZURE_OCR_REGION` | ✅ set — Azure region of the Cognitive Services resource (`southafricanorth`) |

**Note on OCR provider:** the original plan assumed a generic OCR provider; this was
switched to Azure AI Services (Document Intelligence) during setup. `OCR_API_KEY` and
`VISION_LLM_API_KEY` intentionally hold the same value since one Azure resource covers
both.

**Note on `CONFIDENCE_THRESHOLD`:** tested against a real scanned exam script.
Word-level OCR confidence split cleanly into two failure modes — genuine misreads
(handwriting, misoriented symbols) scored below ~0.6, while correctly-read technical
notation (subscripts, exponents, scientific units) often scored 0.7–0.9 despite being
accurate. `0.65` was chosen to catch the former without over-flagging the latter. This
was calibrated on one document — revisit once more real scanned submissions are
available.

## Cloudflare Worker

The glue between the two backend services — triggered by the Floater's
`POST /uploads/:id/start`, fire-and-forwards to Pipeline's `POST /internal/process`,
returns `202` immediately so neither service blocks on the other. Source lives in
this repo under `/worker`:

```
worker/wrangler.toml
worker/src/index.js
```

- **Live URL**: `https://testbench-worker.bdev5592.workers.dev`
- **Account subdomain**: `bdev5592.workers.dev` (registered once via the Cloudflare
  dashboard — a per-account, one-time step; not something `wrangler` can do for a
  brand-new account)
- No custom domain is wired up — `tech.seesunilag.com` is not currently a Cloudflare
  zone under this account, so `workers.dev` is used instead. Fine for this use case:
  it's an internal trigger URL, never exposed to students. Revisit if the domain is
  ever added to Cloudflare.

To redeploy after changing `worker/src/index.js`:

```
cd worker
CLOUDFLARE_API_TOKEN=<token> npx wrangler deploy
```

Token needs Workers Scripts edit permission, scoped to the account (the
"Edit Cloudflare Workers" template on the Cloudflare API Tokens page covers this).

Verified end-to-end (Worker → Pipeline → Postgres write) during setup — this test
also caught and fixed a real bug: Pipeline's Postgres connection wasn't configured
for SSL, which Heroku Postgres requires. See `testbench-backend`'s commit history
(`src/lib/db.ts`) for the fix.

## Budget

| Item | Cost |
|---|---|
| testbench-api — Basic dyno | $7/mo |
| testbench-pipeline — Basic dyno | $7/mo |
| Postgres essential-0 (on testbench-api) | $5/mo |
| **Total** | **$19/mo** |

Note: this exceeds the original $13/mo GitHub Student credit estimate, which had only
budgeted for one Basic dyno. Confirmed and accepted at setup time — both apps need to
be always-on (Basic), which requires two dynos. No worker dynos or other paid add-ons
are provisioned beyond what's listed above; keep it that way unless the budget is
revisited.
