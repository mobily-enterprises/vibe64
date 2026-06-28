# Dashboard Committed Config Plan

## Goal

Fix the Vibe64 Online project/dashboard breakage without weakening the source
ownership model.

The dashboard must be project-scoped and session-agnostic. Session tools must
be source/session-scoped. Dashboard routes must not silently choose an active
session source, and session tools must not write project/runtime/provider state
into source `.vibe64`.

Success means a local online-mode run can create a project, seed it, configure
it, use Codex, inspect dashboard pages, preview, runtime config, and deployment
screens without hitting ownership ambiguity or hidden config behavior.

## Core Architecture

### Two Config Readers

Introduce two explicit config readers with separate call sites.

`sessionSourceConfig`

- Reads and writes `<session>/source/.vibe64`.
- Requires an explicit `sessionId` or `sourcePath`.
- Used by session-owned tools:
  - session Config screen
  - source edits
  - seed/session setup
  - Codex workdir setup
  - preview/session launch
  - Git diff
- May write source config.
- Must never write Vibe64 runtime/provider/deployment metadata.

`committedProjectConfig`

- Read-only.
- Reads `.vibe64` from committed Git state.
- Used by dashboard/project-owned tools:
  - dashboard Setup summaries
  - Runtime Config schema/profile
  - Env
  - Publish
  - Release
  - other project-level read views that need adapter/project shape
- Must never write `.vibe64`.
- Must never choose an active session source.

Rule:

```text
Dashboard reads committed source config.
Session tools read/write selected session source config.
```

### Local And Online Consistency

Local dashboard code should not read the live working tree `.vibe64` directly
when answering dashboard/project questions. It should read committed Git config,
just like Online.

Local implementation:

- Use the selected repo Git object database.
- Read `.vibe64/project_type` and `.vibe64/config/*` with `git show <ref>:...`.
- Default ref is the selected branch/HEAD.
- If the repo has no commit or committed `.vibe64` is missing, return an
  explicit unavailable state.

Online implementation:

- Use `<project>/git-cache/repository.git`.
- Read `.vibe64/project_type` and `.vibe64/config/*` from the configured
  branch/commit in `project.json`.
- Refresh/fetch behavior must be explicit.
- `projectInfoCache.json` may cache derived facts only. It is disposable and
  never authoritative config.

## Runtime Config

Runtime Config has two layers:

- Runtime values are Vibe64-owned project runtime state.
- Runtime schema/profile can depend on source-owned `.vibe64`.

Therefore dashboard Runtime Config must:

- Store/read values from the Vibe64 runtime bucket.
- Derive schema/profile from `committedProjectConfig`.
- Ignore uncommitted active session config.
- Avoid `sessionId` guessing.
- Show a clear unavailable state when committed source config is missing.

It must not:

- Read an arbitrary active session.
- Require a hidden dashboard session.
- Treat `project.json` as permanent config truth.
- Write runtime values into source `.vibe64`.

## Brand-New Online Onboarding

Before any source exists, Online may temporarily store setup answers in
`project.json` under pending `bootstrapConfig`.

Rules:

- `bootstrapConfig` is temporary online metadata.
- It may support onboarding only before source materialization.
- When the seed/source-editing session materializes source, write answers into
  that session source `.vibe64`.
- After successful materialization, delete `bootstrapConfig`.
- Dashboard must not treat `bootstrapConfig` as committed config truth.
- If dashboard needs committed config before commit exists, it must show an
  intentional unavailable state and direct the user to the session setup/config
  flow.

## Fix Scope

### Server/Core

1. Add committed-source config helpers.
2. Keep session-source config helpers separate.
3. Update dashboard-facing routes/services to use committed config:
   - `/runtime-config`
   - dashboard Setup state
   - Env
   - Publish
   - Release
   - any project state endpoint feeding those pages
4. Keep session-facing routes/services on session config:
   - `/project-type?sessionId=...`
   - `/project-config?sessionId=...`
   - session Config saves
   - Codex/session/preview setup
5. Remove silent fallbacks that hide missing source/runtime context.
6. Add clear unavailable states for missing committed config.

### UI

Dashboard:

- Remains session-agnostic.
- Shows Setup, Runtime Config, Env, Publish, Release, Session History.
- Does not show source Config.
- Does not write source `.vibe64`.
- Handles missing committed config without crashing.

Session menu:

- Shows Config as a session-aware tool.
- Requires a selected session/source.
- Writes source `.vibe64`.
- Makes changes visible in session diff.

AI chat/session UI:

- Starts Codex against the selected session source.
- Shows sending state only in the top status location.
- Keeps the composer usable after reload/reconnect.
- Does not depend on dashboard session guesses.

## Contract Tests

Create fixtures with:

- committed `.vibe64` in Git
- two active session sources with different uncommitted `.vibe64`
- missing committed `.vibe64`
- brand-new project with pending `bootstrapConfig`
- runtime-config user values
- online-shaped project root with `project.json`, `sessions`, `git-cache`,
  `runtime`, `runtime-config`, `deployments`

Assertions:

- Dashboard reads committed `.vibe64`.
- Dashboard ignores active session `.vibe64`.
- Dashboard does not throw `vibe64_project_config_session_required`.
- Session Config reads selected session `.vibe64`.
- Session Config writes only selected session `.vibe64`.
- Uncommitted session config does not affect dashboard.
- Committed config changes affect dashboard after refresh.
- Runtime/provider/session/deployment state does not enter source `.vibe64`.
- `bootstrapConfig` survives reload before seeding.
- `bootstrapConfig` is deleted after successful source materialization.
- `.vibe64/project.json` is not accidentally deleted by normal config saves
  without an intentional migration path.

## Complete Local Online-Mode Product Test

Use the local online run as the main verification loop. Do not rely on
production deploys while iterating.

Start from a clean online-shaped local tenant/project state and test the app
completely.

### Project Creation And Seeding

Test:

- Login.
- Create a fresh project.
- Create or connect a GitHub repository as needed.
- Start seeding.
- Choose initial project type/config.
- Reload after saving initial config but before seeding.
- Confirm pending setup answers survive reload.
- Materialize seed session source.
- Confirm `.vibe64/project_type` and `.vibe64/config/*` are written into the
  seed session source.
- Confirm pending `bootstrapConfig` is deleted.
- Confirm source changes appear in Git diff.

### Dashboard Focus

Test every dashboard page:

- Projects list/open project.
- Setup.
- Runtime Config.
- Env.
- Publish.
- Release.
- Session History.

For each page verify:

- Page loads.
- API calls either succeed or return intentional unavailable states.
- No `vibe64_project_config_session_required` errors.
- No dashboard page writes source `.vibe64`.
- State survives browser reload.
- Dashboard reflects committed config, not uncommitted session config.

### Session-Aware Menu Focus

Test:

- Run.
- Session.
- Config.
- Diff.
- Preview/launch controls.
- Terminal controls.
- Switching between sessions.
- Multiple active sessions with different `.vibe64`.

Verify:

- Session tools use the selected session.
- Config is not available as dashboard config.
- Config saves write only selected session source.
- Diff shows source `.vibe64` changes.
- No source write happens without a session source.
- Ambiguous session states are surfaced clearly.

### AI Chat Focus

Test:

- Send a message to Codex.
- Confirm only the top `Sending to Codex...` state appears.
- Confirm no duplicate bottom sending status.
- Confirm Codex starts in the selected session source.
- Confirm terminal opens.
- Confirm AI response appears.
- Reload during/after a turn.
- Send a follow-up.
- Inspect session diff after AI changes.
- Verify commit/push/PR flow where available.

### Preview Focus

Test:

- Launch preview from a session.
- Confirm preview URL loads.
- Confirm reload token behavior works.
- Confirm stale preview URLs do not break the current active preview.
- Confirm Caddy/local proxy equivalent routes to the active socket/runtime.

### Runtime Config Focus

Test:

- Dashboard Runtime Config reads committed config schema.
- Runtime values are stored in the runtime bucket.
- User-owned values can be added/edited/removed.
- Vibe64-owned values cannot be edited as user values.
- Materialization writes generated env files only to correct runtime/session
  source locations.
- Missing committed config produces a clear unavailable state.

## Ownership Audit During Implementation

For every touched path/value, classify ownership as exactly one:

- source-owned project config
- Vibe64 project runtime state
- Vibe64 tenant/account/provider state
- online project metadata
- disposable cache
- generated artifact
- user secret/runtime env
- JSKIT-generated metadata/data definition

Treat unclear ownership as a bug.

High-risk names that require scrutiny:

- `targetRoot`
- `projectRoot`
- `stateRoot`
- `localRoot`
- `sharedRoot`
- `configRoot`

They are acceptable only when the surrounding code makes source/runtime/record
meaning unambiguous.

## Build And Composition Loop

When code changes are needed:

1. Change `/home/merc/vibe64/vibe64`.
2. Run focused tests.
3. Commit public repo changes.
4. Update/build `/home/merc/vibe64/vibe64-online` against the new public commit.
5. Run online composition/build locally.
6. Run local online-mode product tests.
7. Do not deploy until the local end-to-end pass is clean.

Use `npx jskit ...`, never bare `jskit`.

Do not edit the deployment-managed mirror:

```text
/home/merc/vibe64/vibe64-online/submodules/public-vibe64-local-editor
```

## Final Verification Before Deploy

Required checks before deployment:

- focused server tests for config ownership
- client tests for dashboard/session UI
- online composition tests
- local online manual/browser sweep
- `npx jskit app verify`
- `npm run build`
- broader `npm test` where appropriate

Deploy only after the local online run passes the complete product test.

After deploy, smoke test:

- production login
- open project
- dashboard pages
- session Config
- Codex chat
- preview
- Runtime Config
- Env/Publish/Release pages where credentials permit

## Success Criteria

- Dashboard is project-scoped and committed-config based.
- Session tools are session/source-scoped.
- AI chat and preview actually work.
- Source config changes appear in Git diffs.
- Runtime/provider/deployment state never enters source `.vibe64`.
- The app can be used end to end in local online mode before production deploy.
