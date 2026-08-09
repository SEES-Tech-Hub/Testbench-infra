# Heroku Deploy Guide — testbench-pipeline

For whoever's deploying testbench-pipeline for the first time. Covers the crash
currently blocking the app, plus general Heroku basics.

## The current crash — read this first

Looking at `heroku logs -a testbench-pipeline`, the last deploy built successfully
but the dyno crashes immediately on boot with:

```
TypeError: Cannot read properties of undefined (reading 'fileExists')
    at readConfig (ts-node/dist/configuration.js:91)
```

**This is not a bug in your application code.** The current Procfile runs:

```
web: npx ts-node src/server.ts
```

`npx ts-node` re-downloads `ts-node` fresh on every dyno boot instead of using a
pinned version from your own `node_modules`. On this boot it fetched `ts-node@10.9.2`,
which doesn't line up with whatever `typescript` version actually resolves in the
Heroku build environment — the two versions disagree about an internal API, and
`ts-node` dies before your server code ever runs.

Running TypeScript directly via `ts-node` in production is fragile in general (slow
boot, an extra moving part, and exactly this kind of version-drift risk). The fix is
to **compile TypeScript to JS during the build, and run the compiled JS** — that's
also faster on every boot.

### Fix

1. In `package.json`, make sure you have a build script and a start script that
   point at compiled output (adjust paths to match your `tsconfig.json`'s `outDir`
   and entry file):

   ```json
   "scripts": {
     "build": "tsc",
     "start": "node dist/server.js"
   }
   ```

2. Change the Procfile to:

   ```
   web: npm start
   ```

   Heroku's Node buildpack automatically runs `npm run build` (if a `build` script
   exists) before boot, then runs `npm start` — you don't invoke `tsc` yourself in
   the Procfile.

3. Make sure `typescript` is listed under `"dependencies"`, not only
   `"devDependencies"`. Heroku's build runs with `NODE_ENV=production` by default,
   which skips devDependencies — and the build step needs the TypeScript compiler
   available to run `tsc`. Either move it to `dependencies`, or run:

   ```
   heroku config:set NPM_CONFIG_PRODUCTION=false -a testbench-pipeline
   ```

   (moving `typescript` to `dependencies` is the cleaner fix)

4. Commit and redeploy:

   ```
   git add package.json Procfile
   git commit -m "Compile TypeScript during build instead of running ts-node at runtime"
   git push heroku main
   ```

5. Watch it boot:

   ```
   heroku logs --tail -a testbench-pipeline
   ```

If it still crashes after this, check that `src/server.ts` binds to
`process.env.PORT` (Heroku assigns this dynamically — a hardcoded port like `3000`
will fail health checks even if the process itself starts fine).

## Heroku basics (first-time setup)

1. **Install the CLI** (if not already): https://devcenter.heroku.com/articles/heroku-cli
2. **Log in:**
   ```
   heroku login
   ```
   (opens a browser to authenticate — you should already have collaborator access
   to testbench-pipeline via the email invite)
3. **Point your local repo at the Heroku app** (run this once, inside the
   testbench-pipeline repo):
   ```
   heroku git:remote -a testbench-pipeline
   ```
4. **Deploy:**
   ```
   git push heroku main
   ```
   (must push whichever local branch maps to your deployed branch — if you work on
   a different branch locally, push it to Heroku's `main`:
   `git push heroku yourbranch:main`)

## Useful commands while debugging

| Command | What it does |
|---|---|
| `heroku logs --tail -a testbench-pipeline` | Live-stream logs — the first place to look at any crash |
| `heroku ps -a testbench-pipeline` | Current dyno status (up / crashed / etc.) |
| `heroku restart -a testbench-pipeline` | Restart the dyno |
| `heroku config -a testbench-pipeline` | List config var names currently set (values included — treat output as sensitive) |
| `heroku run bash -a testbench-pipeline` | Open a one-off shell on a temporary dyno, useful for poking around the deployed filesystem |
| `heroku releases -a testbench-pipeline` | Deploy/config-change history |

## Config vars

All required config vars are already set on the app (you don't need to set these
yourself) — see the table in the main [README.md](../../README.md) for the full
list and status. If your local `.env` needs the actual values for local dev, ask
whoever ran the infra setup to share them again — don't commit real values to the
repo (`.env.example` in this folder lists just the variable names).

## Reminder

Dyno tier must stay **Basic**, never Eco (Eco sleeps after 30 min idle, which is
disqualifying for this project). It's already set correctly — don't change it. See
the main README for details.
