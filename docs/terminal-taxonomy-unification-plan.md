# Incremental Terminal Integration Plan

## Practicality Judgment

Yes, this plan is practical if it stays narrow.

The practical part is not "unify terminals." The practical part is:

- make terminal opener drift visible
- extract repeated service-owned terminal route glue
- extract repeated owned-terminal access wrapper glue
- prove both helpers on deployment publish only

The plan becomes impractical if it turns back into a universal terminal model.
Shell, launch, Codex, auth, target scripts, setup doctor, workflow command, and
deployment publish all have real differences. The goal is to standardize the
small amount of plumbing that is clearly repeated, not to make those workflows
pretend to be the same thing.

## Decision

Do not do a broad terminal taxonomy rewrite.

The current app has one low-level terminal primitive and many product-specific
terminal workflows. That shape is mostly defensible. The problem worth fixing
now is narrower: service-owned command/job terminals can accidentally re-create
the same route, websocket, and access-wrapper plumbing every time a feature wants
to run a command and stream output.

This plan replaces the prior broad descriptor/refactor plan with five practical
slices:

1. Add an inventory/drift test so terminal openers cannot appear invisibly.
2. Add a tiny helper for owned terminal accessors:
   `read`, `close`, `subscribe`, `write`, and `resize`.
3. Add a tiny helper for service-owned terminal routes:
   `POST`, `GET`, `DELETE`, and websocket.
4. Apply those helpers only to deployment publish first.
5. Document the rule for future service-owned command/job terminals.

## Current Facts

These facts drive the plan.

- `packages/studio-terminal-core/src/server/terminalSessions.js` owns the
  generic pty/session primitive, `startTerminalSession`.
- `packages/studio-terminal-core/src/server/terminalAccess.js` already owns the
  shared owned-terminal access primitives:
  `readOwnedTerminalSession`, `closeOwnedTerminalSession`,
  `subscribeOwnedTerminalSession`, `writeOwnedTerminalSession`, and
  `resizeOwnedTerminalSession`.
- `packages/vibe64-core/src/server/terminalWebSocketRoutes.js` already owns the
  shared websocket route adapter, `registerTerminalWebSocketRoute`.
- Workflow command and project tool already have an established command-terminal
  implementation in `packages/vibe64-terminals/src/server/commandTerminal.js`.
  Project tool uses `startCommandTerminalProcess`; workflow command has extra
  workflow lifecycle in the same module. This plan does not touch either path.
- Deployment publish currently has a service-owned terminal in
  `vibe64-online/packages/private-online-deployments/src/server/service.js`.
  It starts a terminal directly and then exposes read/close/subscribe/write/resize
  wrappers around shared owned-terminal access functions.
- Deployment publish currently registers its own terminal route family in
  `vibe64-online/packages/private-online-deployments/src/server/registerRoutes.js`:
  `POST /publish-terminal`, `GET /publish-terminal/:terminalSessionId`,
  `DELETE /publish-terminal/:terminalSessionId`, and
  `/publish-terminal/:terminalSessionId/ws`.
- The client currently uses `terminal-kind="service"` for deployment publish in
  `vibe64-online/packages/private-online-core/src/client/app/deployments/DeploymentPublishTerminal.vue`.
- Shell, launch, Codex, auth, target scripts, and setup doctor have meaningful
  differences in lifecycle, ownership, interaction, restart, preview, auth,
  repair, or result behavior.

## Narrow Definition

This plan applies only to service-owned command/job terminals with this shape:

- the feature service owns a start method
- the start method creates or reuses a `startTerminalSession`
- output is streamed through the normal terminal snapshot/websocket machinery
- the service needs standard read/close/subscribe/write/resize operations
- the service needs the standard route family:
  `POST`, `GET`, `DELETE`, and websocket

Deployment publish is the proof case.

This plan does not apply to:

- shell, because it is an interactive session surface
- launch, because it owns preview/proxy/readiness/restart behavior
- Codex, because it owns agent/app-server/thread/attachment behavior
- Fix Codex, because it owns repair-job and prompt-injection behavior
- auth, because it owns provider modes, redaction, account state, and attention
  behavior
- target scripts, because they are current-app panel commands with adapter-owned
  semantics
- setup doctor, because its terminal actions are part of setup/repair checks
- command/project-tool, because they already have an established command
  execution path and are not the repeated service-owned route/accessor problem

## Goal

Make future service-owned "run a command/job and stream it" terminals cheap and
hard to wire incorrectly, without forcing unrelated terminal types through a
generic abstraction.

A future standard service-owned terminal should need:

- a service-specific `start` function
- a namespace/access policy callback
- a route base
- request input builders/validators
- optional feature-specific start/close side effects

It should not need to copy:

- boilerplate `GET`/`DELETE` terminal snapshot routes
- boilerplate websocket registration
- boilerplate `readOwnedTerminalSession` wrappers
- boilerplate `closeOwnedTerminalSession` wrappers
- boilerplate `subscribeOwnedTerminalSession` wrappers
- boilerplate `writeOwnedTerminalSession` wrappers
- boilerplate `resizeOwnedTerminalSession` wrappers

## Non-Goals

- Do not rewrite `startTerminalSession`.
- Do not introduce a universal terminal descriptor system.
- Do not collapse every terminal into one route or one UI component.
- Do not change command/project-tool command execution.
- Do not touch shell behavior.
- Do not touch launch/preview behavior.
- Do not touch Codex or Fix Codex behavior.
- Do not touch account auth terminal behavior.
- Do not touch target script terminal behavior.
- Do not touch setup doctor terminal behavior.
- Do not rename deployment publish routes.
- Do not change deployment publish behavior.
- Do not add a new dependency.
- Do not hide authorization or owner-policy differences behind magic defaults.

## Package Boundaries

Keep dependency direction simple.

- `studio-terminal-core` may expose the owned accessor helper because it already
  owns the owned terminal access primitives.
- `studio-terminal-core` must not import Vibe64 route helpers.
- `vibe64-core` may expose the route helper because it already owns
  `registerTerminalWebSocketRoute` and the Vibe64 route conventions.
- The route helper must not import deployment code.
- The route helper must not import terminal access code.
- Deployment publish may consume both helpers.

Expected helper homes:

- `packages/studio-terminal-core/src/server/terminalAccess.js`
- `packages/vibe64-core/src/server/serviceOwnedTerminalRoutes.js`

Expected public tests:

- `tests/server/terminalInventory.unit.test.js`
- `tests/server/terminalAccess.unit.test.js`
- `tests/server/serviceOwnedTerminalRoutes.unit.test.js`

Private deployment tests live in the private-online repo/package that
owns deployment publish.

## Evidence From Current Code

This plan is based on current code facts, not desired architecture.

Line numbers are intentionally not used as contract points because they drift
during normal edits. Re-check the symbols with `rg` before implementation.

### Public Repo Evidence

| Fact | Current Evidence | Planning Consequence |
| --- | --- | --- |
| Low-level pty/session primitive already exists. | `packages/studio-terminal-core/src/server/terminalSessions.js` exports `startTerminalSession`. | Do not rewrite terminal runtime. |
| Owned-terminal access primitives already exist. | `packages/studio-terminal-core/src/server/terminalAccess.js` defines and exports `readOwnedTerminalSession`, `closeOwnedTerminalSession`, `subscribeOwnedTerminalSession`, `writeOwnedTerminalSession`, and `resizeOwnedTerminalSession`. | Add `createOwnedTerminalAccessors` beside these primitives. |
| `studio-terminal-core` server subpaths are already wildcard-exported, and `src/server/index.js` exports `terminalAccess.js`. | `packages/studio-terminal-core/package.json` has `"./server/*": "./src/server/*.js"` and `packages/studio-terminal-core/src/server/index.js` exports `terminalAccess.js`. | Implement `createOwnedTerminalAccessors` directly in `terminalAccess.js` and add it to that file's export block. |
| Websocket terminal route helper already exists. | `packages/vibe64-core/src/server/terminalWebSocketRoutes.js` exports `registerTerminalWebSocketRoute`. | Build the service-owned route helper on top of this. |
| `vibe64-core` server subpaths are explicitly exported. | `packages/vibe64-core/package.json` lists each `./server/...` export individually and currently includes `./server/terminalWebSocketRoutes`. | A new `serviceOwnedTerminalRoutes.js` file must also be added to `package.json` exports if private code imports it by subpath. |
| `vibe64-core` server barrel exports are explicit. | `packages/vibe64-core/src/server/index.js` explicitly exports `terminalWebSocketRoutes.js`. | Add `export * from "./serviceOwnedTerminalRoutes.js";`. |
| `vibe64-core` API metadata documents server helper surfaces. | `packages/vibe64-core/package.descriptor.mjs` includes an `apiSummary` entry for `./server/terminalWebSocketRoutes`. | Add an `apiSummary` entry for `./server/serviceOwnedTerminalRoutes` to avoid metadata drift. |
| Workflow command/project tool are already a special command-terminal module. | `packages/vibe64-terminals/src/server/commandTerminal.js` contains workflow command lifecycle and `startCommandTerminalProcess`; project tool calls `startCommandTerminalProcess`. | Do not migrate command/project-tool in this plan. |
| Current server tests use Node's test runner. | `package.json` has `"test": "node --test tests/server/*.test.js"`. | New public server tests are `tests/server/*.unit.test.js`. |
| Existing websocket helper test pattern exists. | `tests/server/terminalWebSocketRoutes.unit.test.js` uses fake app/Fastify objects and `node:test`. | Model `serviceOwnedTerminalRoutes` tests on that style. |

Useful verification command:

```text
rg -n "startTerminalSession\\(|startTerminalSessionFn\\(|startCommandTerminalProcess\\(|registerTerminalWebSocketRoute\\(" packages src
```

### Private Online Evidence

| Fact | Current Evidence | Planning Consequence |
| --- | --- | --- |
| Deployment publish has a service-owned terminal start method. | `vibe64-online/packages/private-online-deployments/src/server/service.js` defines `startPublishTerminal(input = {})` and calls `startTerminalSession`. | Keep start logic deployment-owned. |
| Deployment publish has repeated owned-access wrappers. | The same service exposes `readPublishTerminal`, `closePublishTerminal`, `subscribePublishTerminal`, `writePublishTerminal`, and `resizePublishTerminal`, each delegating to owned terminal access functions with publish access options. | Replace only those wrappers with `createOwnedTerminalAccessors`. |
| Deployment publish hand-registers the standard route family. | `vibe64-online/packages/private-online-deployments/src/server/registerRoutes.js` registers `POST /publish-terminal`, `GET /publish-terminal/:terminalSessionId`, `DELETE /publish-terminal/:terminalSessionId`, and a websocket route at `/publish-terminal/:terminalSessionId/ws`. | Replace only this boilerplate with `registerServiceOwnedTerminalRoutes`, preserving paths. |
| Deployment publish client uses the generic service terminal path. | `vibe64-online/packages/private-online-core/src/client/app/deployments/DeploymentPublishTerminal.vue` uses `terminal-kind="service"` and `studioApiPath("vibe64/deployments/publish-terminal")`. | No client change is part of this plan; identical routes preserve the existing client path. |
| Private online server tests use Node's test runner. | `vibe64-online/package.json` has `"test": "node --test tests/server/*.test.js"`. | Add private tests under `vibe64-online/tests/server`. |
| Private deployment tests already use composition imports. | `vibe64-online/tests/server/deploymentService.unit.test.js` imports deployment service through `createOnlineCompositionApp` and `importFromComposition`. | Route/accessor migration tests can follow this pattern. |
| Online composition defaults to the managed public editor submodule. | `vibe64-online/lib/onlineComposition.js` resolves the public root from `VIBE64_PUBLIC_ROOT` or `submodules/public-vibe64-local-editor`. | Private verification before submodule update must set `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64`. |
| Private deployment package exports are narrow. | `vibe64-online/packages/private-online-deployments/package.json` exports `./server/actions` and `./server/projectDeploymentSummary`, not `server/registerRoutes`. | Private tests should import deployment internals through the existing composition `src/server/...` pattern, not a new package export. |

Useful verification command:

```text
rg -n "publish-terminal|startPublishTerminal|readPublishTerminal|closePublishTerminal|subscribePublishTerminal|writePublishTerminal|resizePublishTerminal" \
  /home/merc/vibe64/vibe64-online/packages/private-online-deployments/src/server
```

## File Change Map

### Public Vibe64 Repo

All paths in this table are under:

```text
/home/merc/vibe64/vibe64
```

| Slice | File | Change |
| --- | --- | --- |
| 1 | `tests/server/terminalInventory.unit.test.js` | Add inventory/drift test. |
| 2 | `packages/studio-terminal-core/src/server/terminalAccess.js` | Add and export `createOwnedTerminalAccessors`. |
| 2 | `tests/server/terminalAccess.unit.test.js` | Add helper delegation and validation tests. |
| 3 | `packages/vibe64-core/src/server/serviceOwnedTerminalRoutes.js` | Add route helper built on `registerTerminalWebSocketRoute`. |
| 3 | `packages/vibe64-core/src/server/index.js` | Export the new helper. |
| 3 | `packages/vibe64-core/package.json` | Add `"./server/serviceOwnedTerminalRoutes": "./src/server/serviceOwnedTerminalRoutes.js"` because this package uses explicit exports. |
| 3 | `packages/vibe64-core/package.descriptor.mjs` | Add `apiSummary` metadata for `./server/serviceOwnedTerminalRoutes`. |
| 3 | `tests/server/serviceOwnedTerminalRoutes.unit.test.js` | Add route helper registration/delegation tests. |
| 3 | `tests/server/terminalInventory.unit.test.js` | Add the new helper's internal `registerTerminalWebSocketRoute(` call to expected inventory. |
| 3 | `.jskit/helper-map.md` | Regenerate with `npx jskit helper-map update` if the new exported helper changes helper-map output. |
| 3 | `.jskit/helper-map.json` | Regenerate with `npx jskit helper-map update` if the new exported helper changes helper-map output. |
| 5 | `docs/terminal-taxonomy-unification-plan.md` | Keep this executable plan current. |

### Private Online Repo

These paths are under:

```text
/home/merc/vibe64/vibe64-online
```

Do not edit the deployment-managed public mirror at:

```text
/home/merc/vibe64/vibe64-online/submodules/public-vibe64-local-editor
```

| Slice | File | Change |
| --- | --- | --- |
| 4 | `packages/private-online-deployments/src/server/service.js` | Replace only publish terminal read/close/subscribe/write/resize wrappers with `createOwnedTerminalAccessors`; keep `startPublishTerminal` explicit. |
| 4 | `packages/private-online-deployments/src/server/registerRoutes.js` | Replace only publish terminal route/websocket boilerplate with `registerServiceOwnedTerminalRoutes`; preserve paths. |
| 4 | `tests/server/deploymentPublishTerminalRoutes.unit.test.js` | Add focused route-helper migration tests. |
| 4 | `tests/server/deploymentService.unit.test.js` | Add publish terminal behavior tests; do not spy on imported owned-terminal primitives. |

### Files Expected Not To Change

These files are not part of this plan. If they change, review why
before continuing.

| File | Reason |
| --- | --- |
| `src/components/studio/Vibe64CommandTerminal.vue` | Route compatibility avoids client component changes. |
| `src/composables/useVibe64CommandTerminalController.js` | The existing generic `terminal-kind="service"` path remains unchanged. |
| `packages/vibe64-terminals/src/server/commandTerminal.js` | Command/project-tool execution is out of scope. |
| `packages/vibe64-terminals/src/server/launchTargetTerminal.js` | Launch is out of scope. |
| `packages/vibe64-terminals/src/server/shellTerminal.js` | Shell is out of scope. |
| `packages/vibe64-terminals/src/server/codexTerminal.js` | Codex/Fix Codex are out of scope. |
| `packages/vibe64-accounts/src/server/service.js` | Auth terminal is out of scope. |
| `packages/current-app/src/server/service.js` | Target scripts are out of scope. |
| `packages/setup-doctor-core/src/server/setupDoctorGit.js` | Setup repair is out of scope. |
| `packages/setup-doctor-core/src/server/doctorPluginToolkit.js` | Setup repair toolkit is out of scope. |

## Slice Overview Checklist

Use this as the top-level execution checklist.

- [ ] Slice 1: add public inventory/drift test.
- [ ] Slice 2: add `createOwnedTerminalAccessors` and public tests.
- [ ] Slice 3: add `registerServiceOwnedTerminalRoutes`, exports, and public
      tests.
- [ ] Slice 4: migrate deployment publish accessors and routes in
      `vibe64-online`.
- [ ] Slice 5: document the new service-owned terminal rule in helper comments
      and inventory failure messages.
- [ ] Verify public repo.
- [ ] Verify private-online repo.
- [ ] Confirm no out-of-scope terminal files changed.

## Per-Slice Diff Guards

Before finishing each slice, run:

```text
git diff --name-only
```

The changed files must match the slice.

Slice 1 allowed public files:

- [ ] `tests/server/terminalInventory.unit.test.js`
- [ ] `docs/terminal-taxonomy-unification-plan.md` only if the inventory list in
      this plan is corrected during implementation

Slice 2 allowed public files:

- [ ] `packages/studio-terminal-core/src/server/terminalAccess.js`
- [ ] `tests/server/terminalAccess.unit.test.js`
- [ ] `docs/terminal-taxonomy-unification-plan.md` only if helper naming changes

Slice 3 allowed public files:

- [ ] `packages/vibe64-core/src/server/serviceOwnedTerminalRoutes.js`
- [ ] `packages/vibe64-core/src/server/index.js`
- [ ] `packages/vibe64-core/package.json`
- [ ] `packages/vibe64-core/package.descriptor.mjs`
- [ ] `tests/server/serviceOwnedTerminalRoutes.unit.test.js`
- [ ] `tests/server/terminalInventory.unit.test.js`
- [ ] `.jskit/helper-map.md` only if changed by
      `npx jskit helper-map update`
- [ ] `.jskit/helper-map.json` only if changed by
      `npx jskit helper-map update`
- [ ] `docs/terminal-taxonomy-unification-plan.md` only if helper naming changes

Slice 4 allowed private-online files:

- [ ] `packages/private-online-deployments/src/server/service.js`
- [ ] `packages/private-online-deployments/src/server/registerRoutes.js`
- [ ] `tests/server/deploymentPublishTerminalRoutes.unit.test.js`
- [ ] `tests/server/deploymentService.unit.test.js`

Slice 5 allowed files:

- [ ] `packages/studio-terminal-core/src/server/terminalAccess.js`
- [ ] `packages/vibe64-core/src/server/serviceOwnedTerminalRoutes.js`
- [ ] `tests/server/terminalInventory.unit.test.js`
- [ ] `docs/terminal-taxonomy-unification-plan.md`

If any other file appears, stop and either move it to a later explicit slice or
document why the extra file is required.

## Slice 1: Inventory And Drift Alarm

### Purpose

Make terminal additions visible before changing behavior.

This slice should not change runtime behavior. It only adds a test that fails
when a new terminal opener or terminal websocket route appears without an
explicit inventory update.

### Executable Checklist

- [ ] Create `tests/server/terminalInventory.unit.test.js`.
- [ ] Implement deterministic recursive file listing for `packages/` and `src/`.
- [ ] Ignore `node_modules/`, `dist/`, `build/`, `coverage/`, `docs/`, and
      `tests/`.
- [ ] Scan for `startTerminalSession(`.
- [ ] Scan for `startTerminalSessionFn(`.
- [ ] Scan for `startCommandTerminalProcess(`.
- [ ] Scan for `registerTerminalWebSocketRoute(`.
- [ ] Store expected opener inventory as sorted data entries.
- [ ] Store expected websocket inventory as sorted data entries.
- [ ] Include a `reason` field on every expected entry.
- [ ] Make failure output show added entries and missing entries separately.
- [ ] Include the helper guidance in the failure message.
- [ ] Run `node --test tests/server/terminalInventory.unit.test.js`.
- [ ] Run `npm run test`.
- [ ] Confirm no runtime files changed in this slice.

### Implementation Location

Add:

```text
tests/server/terminalInventory.unit.test.js
```

Use Node's existing `node:test` style, matching other server tests.

### What The Test Should Scan

Scan source files under:

```text
packages/
src/
```

Ignore:

```text
node_modules/
dist/
build/
coverage/
docs/
tests/
```

The first version can use deterministic file traversal plus targeted regexes.
Do not introduce a parser dependency.

Track these patterns:

```text
startTerminalSession(
startTerminalSessionFn(
startCommandTerminalProcess(
registerTerminalWebSocketRoute(
```

The test must not count comments. Implement a small comment stripper for
JavaScript block comments and line comments before counting patterns.

### Expected Inventory Shape

Use data, not scattered assertions.

Example:

```js
const EXPECTED_TERMINAL_OPENERS = [
  {
    file: "packages/current-app/src/server/service.js",
    pattern: "startTerminalSession(",
    count: 1,
    reason: "current-app target script terminal"
  },
  {
    file: "packages/vibe64-terminals/src/server/commandTerminal.js",
    pattern: "startCommandTerminalProcess(",
    count: 2,
    reason: "project tool command-run helper definition and use"
  }
];
```

Use file-relative paths sorted alphabetically in failure output.

Prefer expected `file + pattern + count` entries over line-number assertions.
Line numbers drift during normal edits and should not make the test noisy.

### Initial Expected Public Inventory

Start from these entries. Re-check with `rg` when implementing.

`startTerminalSession(` entries:

| File | Count | Reason |
| --- | ---: | --- |
| `packages/studio-terminal-core/src/server/terminalSessions.js` | 1 | Primitive definition, not an opener. |
| `packages/current-app/src/server/service.js` | 1 | Current-app target script terminal. |
| `packages/setup-doctor-core/src/server/doctorPluginToolkit.js` | 1 | Setup doctor plugin terminal action helper. |
| `packages/setup-doctor-core/src/server/setupDoctorGit.js` | 1 | Setup doctor git repair terminal helper. |
| `packages/vibe64-terminals/src/server/codexTerminal.js` | 3 | Session Codex, global Codex, and Fix Codex starts. |
| `packages/vibe64-terminals/src/server/launchTargetTerminal.js` | 1 | Launch/preview terminal. |
| `packages/vibe64-terminals/src/server/shellTerminal.js` | 1 | Interactive shell terminal. |

`startTerminalSessionFn(` entries:

| File | Count | Reason |
| --- | ---: | --- |
| `packages/vibe64-accounts/src/server/service.js` | 1 | Account auth injected terminal starter. |

`startCommandTerminalProcess(` entries:

| File | Count | Reason |
| --- | ---: | --- |
| `packages/vibe64-terminals/src/server/commandTerminal.js` | 2 | Project tool command-run helper definition and call site. |

`registerTerminalWebSocketRoute(` entries:

| File | Count | Reason |
| --- | ---: | --- |
| `packages/vibe64-core/src/server/terminalWebSocketRoutes.js` | 1 | Websocket route helper definition, not a route registration. |
| `packages/current-app/src/server/registerRoutes.js` | 1 | Current-app target script websocket. |
| `packages/vibe64-accounts/src/server/registerRoutes.js` | 1 | Account auth websocket. |
| `packages/vibe64-terminals/src/server/registerRoutes.js` | 7 | Global Codex, Fix Codex, project tool, session Codex, workflow command, launch, and shell websockets. |

Deployment publish is intentionally not in this public inventory because it
lives in `vibe64-online`. Slice 4 covers that private route family.

### Known Public Opener Families

The inventory should document at least these public repo families:

- workflow command through the existing workflow command terminal start path
- project tool through `startCommandTerminalProcess`
- shell terminal
- launch target terminal
- session Codex terminal
- global Codex terminal
- Fix Codex terminal
- current-app target script terminal
- setup doctor git terminal helpers
- setup doctor plugin toolkit terminal helpers
- account auth through injected `startTerminalSessionFn`

The test should also explicitly note that deployment publish lives outside the
public repo in `vibe64-online` and is covered by the deployment migration slice.

### Known Public Websocket Families

The inventory should document at least these websocket route families:

- global Codex
- Fix Codex
- project tool
- session Codex
- workflow command
- launch target
- shell
- current-app target script
- account auth

### Failure Message

The failure message should be actionable.

It should include:

- new file/pattern/count discovered
- missing expected file/pattern/count if an opener moved or was removed
- a short instruction:
  "If this is a new service-owned command/job terminal, use
  `registerServiceOwnedTerminalRoutes` and `createOwnedTerminalAccessors`.
  Otherwise update this inventory with the reason this terminal is special."

### Edge Cases

- If a file has multiple intentional `startTerminalSession(` calls, count them
  in one entry and explain the family.
- If a terminal opener is injected for tests, ignore the test directory.
- If a call moves files but behavior is unchanged, update the expected path and
  reason in the same commit.
- Do not block removal of dead terminal code. The test should show the missing
  expected entry so the developer can remove it intentionally.

### Verification

Run:

```text
node --test tests/server/terminalInventory.unit.test.js
npm run test
```

If the repository requires framework verification for the change, also run:

```text
npx jskit app verify
```

### Done When

- A new direct terminal opener cannot be added silently.
- A new websocket terminal route cannot be added silently.
- The test documents why each known opener exists.
- No runtime code changes were made in this slice.

## Slice 2: Owned Accessor Helper

### Purpose

Remove repeated service methods that only wrap:

- `readOwnedTerminalSession`
- `closeOwnedTerminalSession`
- `subscribeOwnedTerminalSession`
- `writeOwnedTerminalSession`
- `resizeOwnedTerminalSession`

This helper is intentionally boring. It does not start terminals. It does not
own authorization. It does not own namespaces. It does not know feature semantics.

### Executable Checklist

- [ ] Implement directly in
      `packages/studio-terminal-core/src/server/terminalAccess.js`.
- [ ] Add `createOwnedTerminalAccessors`.
- [ ] Validate `accessOptions` at construction time.
- [ ] Validate optional `wrap` at construction time.
- [ ] Validate optional operation overrides at construction time.
- [ ] Implement `read`.
- [ ] Implement `close`.
- [ ] Implement `subscribe`.
- [ ] Implement `write`.
- [ ] Implement `resize`.
- [ ] Ensure `accessOptions(input)` runs inside `wrap` when `wrap` exists.
- [ ] Export `createOwnedTerminalAccessors`.
- [ ] Add `tests/server/terminalAccess.unit.test.js`.
- [ ] Add delegation tests for all five methods.
- [ ] Add validation tests.
- [ ] Add wrapper-order test proving `accessOptions` is evaluated inside `wrap`.
- [ ] Run `node --test tests/server/terminalAccess.unit.test.js`.
- [ ] Run `npm run test`.
- [ ] Confirm no deployment/private files changed in this slice.

### Implementation Location

Add and export directly from:

```text
packages/studio-terminal-core/src/server/terminalAccess.js
```

Do not add a new module for the first implementation. The helper is a small
wrapper around functions already in `terminalAccess.js`, and keeping it there
avoids an unnecessary export/import change.

### Target API

```js
function createOwnedTerminalAccessors({
  accessOptions,
  wrap = null,
  operations = {}
} = {}) {
  // returns read/close/subscribe/write/resize
}
```

`accessOptions` is required.

`wrap` is optional. It exists for service result wrappers such as:

```js
deploymentResult(() => readOwnedTerminalSession(...))
```

`operations` is optional and exists only for unit tests or unusual local
composition. Defaults must be the existing owned terminal functions.

### Returned API

```js
{
  read(terminalSessionId, input = {}),
  close(terminalSessionId, input = {}),
  subscribe(terminalSessionId, subscriber, input = {}),
  write(terminalSessionId, data, input = {}),
  resize(terminalSessionId, size = {}, input = {})
}
```

### Required Semantics

Each method must evaluate `accessOptions(input)` inside the `wrap` callback when
`wrap` is present.

That preserves current service behavior where service-level result wrappers catch
and normalize errors from both access option construction and terminal access.

Pseudocode:

```js
function run(callback) {
  return typeof wrap === "function" ? wrap(callback) : callback();
}

read(terminalSessionId, input = {}) {
  return run(() => readOwnedTerminalSession(
    terminalSessionId,
    accessOptions(input)
  ));
}
```

### Required Validation

Fail loudly at construction time if:

- `accessOptions` is not a function
- any supplied operation override is not a function
- `wrap` is supplied but is not a function

Do not validate `terminalSessionId` in this helper. The existing owned terminal
functions already own terminal lookup and namespace behavior.

### Unit Tests

Add:

```text
tests/server/terminalAccess.unit.test.js
```

Test cases:

- `read` delegates to `readOwnedTerminalSession` with computed access options.
- `close` delegates to `closeOwnedTerminalSession` with computed access options.
- `subscribe` passes `terminalSessionId`, `subscriber`, and computed access
  options in the correct order.
- `write` passes `terminalSessionId`, `data`, and computed access options in the
  correct order.
- `resize` passes `terminalSessionId`, `size`, and computed access options in
  the correct order.
- `wrap` receives a callback and controls the return value.
- `accessOptions` is evaluated inside `wrap`.
- construction fails when `accessOptions` is missing.
- construction fails when `wrap` is not a function.
- construction fails when an operation override is not a function.

Use operation injection for unit tests so the tests do not need to create real
terminal sessions.

### Edge Cases

- Preserve synchronous return behavior if existing primitives return
  synchronously.
- Preserve promises if a wrapper returns a promise.
- Do not swallow thrown errors.
- Do not add logging in this helper.
- Do not attach metadata in this helper.

### Verification

Run:

```text
node --test tests/server/terminalAccess.unit.test.js
npm run test
```

### Done When

- The helper can express deployment publish's current
  read/close/subscribe/write/resize methods.
- Tests prove delegation order and wrapper behavior.
- Existing owned terminal primitives remain the only implementation of terminal
  access.

## Slice 3: Service-Owned Terminal Route Helper

### Purpose

Remove repeated HTTP/websocket route boilerplate for the standard
service-owned terminal job shape.

The helper registers exactly:

- `POST <basePath>`
- `GET <basePath>/:terminalSessionId`
- `DELETE <basePath>/:terminalSessionId`
- `<basePath>/:terminalSessionId/ws`

It delegates all behavior to caller-supplied service methods.

### Executable Checklist

- [ ] Create `packages/vibe64-core/src/server/serviceOwnedTerminalRoutes.js`.
- [ ] Import `registerTerminalWebSocketRoute` from
      `./terminalWebSocketRoutes.js`.
- [ ] Implement option validation.
- [ ] Implement default `buildStartInput`.
- [ ] Implement default `buildAccessInput`.
- [ ] Implement default service resolution through `app.make(serviceId)`.
- [ ] Register `POST <basePath>`.
- [ ] Register `GET <basePath>/:terminalSessionId`.
- [ ] Register `DELETE <basePath>/:terminalSessionId`.
- [ ] Register websocket route
      `${routes.routeBase}${basePath}/:terminalSessionId/ws`.
- [ ] Ensure websocket subscribe delegates to configured service method.
- [ ] Ensure websocket write delegates to configured service method.
- [ ] Ensure websocket resize delegates to configured service method.
- [ ] Add export from `packages/vibe64-core/src/server/index.js`.
- [ ] Add package export to `packages/vibe64-core/package.json`.
- [ ] Add `apiSummary` metadata to `packages/vibe64-core/package.descriptor.mjs`.
- [ ] Add `tests/server/serviceOwnedTerminalRoutes.unit.test.js`.
- [ ] Update `tests/server/terminalInventory.unit.test.js` so the new helper's
      internal `registerTerminalWebSocketRoute(` call is expected.
- [ ] Add route-shape tests.
- [ ] Add HTTP delegation tests.
- [ ] Add websocket delegation tests.
- [ ] Add validation failure tests.
- [ ] Run `npx jskit helper-map update` and keep `.jskit/helper-map.*` changes
      if the new exported helper appears there.
- [ ] Run `node --test tests/server/serviceOwnedTerminalRoutes.unit.test.js`.
- [ ] Run `node --test tests/server/terminalInventory.unit.test.js`.
- [ ] Run `npm run test`.
- [ ] Run `npm run verify:packages` to catch package export/boundary issues.
- [ ] Confirm no deployment/private files changed in this slice.

### Implementation Location

Add:

```text
packages/vibe64-core/src/server/serviceOwnedTerminalRoutes.js
```

This module may import:

```js
import { registerTerminalWebSocketRoute } from "./terminalWebSocketRoutes.js";
```

It must not import deployment code or terminal session/access code.

### Target API

```js
function registerServiceOwnedTerminalRoutes(app, routes, {
  basePath,
  body = null,
  buildAccessInput = () => ({}),
  buildStartInput = null,
  getService = null,
  methods,
  projectContext = null,
  serviceId,
  serviceUnavailableMessage,
  summaries = {}
} = {}) {
  // registers POST/GET/DELETE/ws
}
```

### Required Options

Required:

- `app`
- `routes`
- `basePath`
- `methods.start`
- `methods.read`
- `methods.close`
- `methods.subscribe`
- `methods.write`
- `methods.resize`
- `serviceId`
- `serviceUnavailableMessage`

Optional:

- `body`
- `buildStartInput`
- `buildAccessInput`
- `getService`
- `projectContext`
- `summaries`

Default `buildStartInput`:

```js
(request) => routes.requestBody(request)
```

Default `buildAccessInput`:

```js
() => ({})
```

Default `getService`:

```js
() => app.make(serviceId)
```

`getService` is used only by the helper's HTTP routes. Websocket service
resolution remains owned by `registerTerminalWebSocketRoute`, which calls
`app.make(serviceId)` internally. Do not change `registerTerminalWebSocketRoute`
for this plan.

For deployment publish, this is safe because `getDeploymentsService(app)` is
currently just `app.make(VIBE64_DEPLOYMENTS_SERVICE)`.

### HTTP Delegation Contract

Start route:

```js
routes.serviceRoute("POST", basePath, {
  body,
  summary: summaries.start
}, (request) => {
  const service = resolveService(request);
  return service[methods.start](buildStartInput(request));
});
```

Read route:

```js
routes.serviceRoute("GET", `${basePath}/:terminalSessionId`, {
  statusCode: 200,
  summary: summaries.read
}, (request) => {
  const service = resolveService(request);
  return service[methods.read](
    request.params.terminalSessionId,
    buildAccessInput(request)
  );
});
```

Close route:

```js
routes.serviceRoute("DELETE", `${basePath}/:terminalSessionId`, {
  statusCode: 200,
  summary: summaries.close
}, (request) => {
  const service = resolveService(request);
  return service[methods.close](
    request.params.terminalSessionId,
    buildAccessInput(request)
  );
});
```

### Websocket Delegation Contract

The helper must call `registerTerminalWebSocketRoute(app, ...)` with:

```js
routePath: `${routes.routeBase}${basePath}/:terminalSessionId/ws`
```

Delegation:

```js
subscribe(service, { request, subscriber, terminalSessionId }) {
  return service[methods.subscribe](
    terminalSessionId,
    subscriber,
    buildAccessInput(request)
  );
}

resize(service, { cols, request, rows, terminalSessionId }) {
  return service[methods.resize](
    terminalSessionId,
    { cols, rows },
    buildAccessInput(request)
  );
}

write(service, { data, request, terminalSessionId }) {
  return service[methods.write](
    terminalSessionId,
    data,
    buildAccessInput(request)
  );
}
```

### Required Validation

Fail loudly at registration time if:

- `basePath` is empty
- `basePath` does not start with `/`
- any required method name is missing
- `routes.serviceRoute` is not a function
- `routes.routeBase` is not a string
- `buildAccessInput` is not a function
- `buildStartInput` is supplied but is not a function
- `buildStartInput` is omitted and `routes.requestBody` is not a function
- `getService` is supplied but is not a function
- `serviceId` is empty
- `serviceUnavailableMessage` is empty

Fail loudly at request time if:

- service resolution fails
- the resolved service does not have the required method

Do not hide those errors behind generic terminal failures. Missing methods are
developer errors.

### Unit Tests

Add:

```text
tests/server/serviceOwnedTerminalRoutes.unit.test.js
```

Use a fake `routes` object that records calls:

```js
const registered = [];
const routes = {
  routeBase: "/api/app/:slug/vibe64/deployments",
  requestBody: () => ({ ok: true }),
  serviceRoute(method, path, options, handler) {
    registered.push({ method, path, options, handler });
  }
};
```

Use a fake `app`/Fastify similar to
`tests/server/terminalWebSocketRoutes.unit.test.js`.

Test cases:

- registers `POST <basePath>` with supplied body validator and summary.
- registers `GET <basePath>/:terminalSessionId` with status code 200.
- registers `DELETE <basePath>/:terminalSessionId` with status code 200.
- registers websocket route at
  `${routes.routeBase}${basePath}/:terminalSessionId/ws`.
- start handler calls the configured start method with `buildStartInput`.
- read handler calls the configured read method with terminal id and
  `buildAccessInput`.
- close handler calls the configured close method with terminal id and
  `buildAccessInput`.
- HTTP handlers use `getService` when supplied.
- websocket handlers use the service supplied by `registerTerminalWebSocketRoute`
  through `app.make(serviceId)`, not `getService`.
- websocket subscribe calls the configured subscribe method with terminal id,
  subscriber, and `buildAccessInput`.
- websocket resize calls the configured resize method with terminal id,
  `{ cols, rows }`, and `buildAccessInput`.
- websocket write calls the configured write method with terminal id, data, and
  `buildAccessInput`.
- registration fails for an empty base path.
- registration fails when a required method name is missing.
- registration fails when `buildAccessInput` is not a function.
- registration fails when `buildStartInput` is supplied but is not a function.
- registration fails when `buildStartInput` is omitted and
  `routes.requestBody` is not a function.
- registration fails when `getService` is supplied but is not a function.
- registration succeeds without `routes.requestBody` when `buildStartInput` is
  supplied.
- request handling fails clearly when the resolved service is missing a required
  method.

### Edge Cases

- Preserve caller-supplied route summaries.
- Preserve caller-supplied body validation on start only.
- Do not add a body validator to read or close.
- Do not assume a project slug. Let `routes.routeBase` and
  `registerTerminalWebSocketRoute` preserve existing project route behavior.
- Do not add support for extra route params in the first version.
- Do not add `PUT`, `PATCH`, `stop`, `list`, or `status`.
- Do not add terminal session descriptor metadata. Package API metadata in
  `packages/vibe64-core/package.descriptor.mjs` is required for the new helper
  export.

### Verification

Run:

```text
node --test tests/server/serviceOwnedTerminalRoutes.unit.test.js
node --test tests/server/terminalInventory.unit.test.js
npm run test
npm run verify:packages
```

### Done When

- A feature can register the standard service-owned terminal route family with
  one helper call.
- Tests prove route shape and delegation.
- No deployment behavior has changed yet.

## Slice 4: Migrate Deployment Publish Only

### Purpose

Prove the helpers against the real case that exposed the repeated code.

Deployment publish is the only migration in this plan.

### Executable Checklist

- [ ] Confirm public helper changes are committed or otherwise available to
      `vibe64-online`.
- [ ] In `packages/private-online-deployments/src/server/service.js`, import
      `createOwnedTerminalAccessors`.
- [ ] Keep `startPublishTerminal(input = {})` unchanged except for import or
      nearby helper wiring.
- [ ] Build `publishTerminalAccessors` with
      `accessOptions: publishTerminalAccessOptions` and `wrap: deploymentResult`.
- [ ] Replace `readPublishTerminal` wrapper with accessor delegation.
- [ ] Replace `closePublishTerminal` wrapper with accessor delegation.
- [ ] Replace `subscribePublishTerminal` wrapper with accessor delegation.
- [ ] Replace `writePublishTerminal` wrapper with accessor delegation.
- [ ] Replace `resizePublishTerminal` wrapper with accessor delegation.
- [ ] In `packages/private-online-deployments/src/server/registerRoutes.js`,
      import `registerServiceOwnedTerminalRoutes`.
- [ ] Replace only the three publish-terminal HTTP route blocks.
- [ ] Replace only `registerPublishTerminalWebSocketRoute`.
- [ ] Accept that the helper registers HTTP and websocket routes together instead
      of preserving the current split registration positions.
- [ ] Add a focused route test proving the same four publish-terminal paths are
      registered and delegate to the same service methods.
- [ ] Preserve existing route summaries.
- [ ] Preserve `deploymentPublishInputValidator` on start route.
- [ ] Preserve `requestBodyWithUser(routes)` behavior on start.
- [ ] Preserve `withVibe64User(request)` behavior on read/close/ws operations.
- [ ] Add or update private behavior tests for publish terminal service methods.
- [ ] Add or update private tests for route shape/delegation.
- [ ] Run focused private tests.
- [ ] Run `npm test` in `/home/merc/vibe64/vibe64-online`.
- [ ] Manually verify publish terminal open/reconnect/close.
- [ ] Confirm `DeploymentPublishTerminal.vue` did not need changes.

### Implementation Locations

Private online deployment files:

```text
vibe64-online/packages/private-online-deployments/src/server/service.js
vibe64-online/packages/private-online-deployments/src/server/registerRoutes.js
```

Client file for verification only:

```text
vibe64-online/packages/private-online-core/src/client/app/deployments/DeploymentPublishTerminal.vue
```

The client file remains unchanged because this slice preserves the same public
routes.

### Current Deployment Publish Inventory

Before migrating, verify these current symbols still exist:

Service file:

```text
packages/private-online-deployments/src/server/service.js
```

Expected publish terminal service methods:

- `startPublishTerminal(input = {})`
- `readPublishTerminal(terminalSessionId, input = {})`
- `closePublishTerminal(terminalSessionId, input = {})`
- `subscribePublishTerminal(terminalSessionId, subscriber, input = {})`
- `writePublishTerminal(terminalSessionId, data, input = {})`
- `resizePublishTerminal(terminalSessionId, size = {}, input = {})`

Route file:

```text
packages/private-online-deployments/src/server/registerRoutes.js
```

Expected publish terminal route registrations:

- `routes.serviceRoute("POST", "/publish-terminal", ...)`
- `routes.serviceRoute("GET", "/publish-terminal/:terminalSessionId", ...)`
- `routes.serviceRoute("DELETE", "/publish-terminal/:terminalSessionId", ...)`
- `registerTerminalWebSocketRoute(... routePath:
  "${routes.routeBase}/publish-terminal/:terminalSessionId/ws" ...)`

Pre-migration verification command:

```text
rg -n "publish-terminal|startPublishTerminal|readPublishTerminal|closePublishTerminal|subscribePublishTerminal|writePublishTerminal|resizePublishTerminal" \
  packages/private-online-deployments/src/server/service.js \
  packages/private-online-deployments/src/server/registerRoutes.js
```

### Service Migration Detail

Keep `startPublishTerminal(input)` explicit in deployment service code.

Do not move or generalize:

- `deploymentContext()`
- `currentProjectRequestContext()`
- `resolvePublishToolHome(input)`
- `writeDeploymentPublishTerminalInput(...)`
- `DEPLOYMENT_PUBLISH_TERMINAL_RUNNER`
- `process.execPath` runner invocation
- `commandPreview: "vibe64 publish"`
- deployment publish metadata
- cleanup of the terminal input file after failed start
- successful publish app auth sync
- deployment state writes
- deployment cleanup/resource behavior

Only replace the accessor wrappers.

Target shape:

```js
const publishTerminalAccessors = createOwnedTerminalAccessors({
  accessOptions: publishTerminalAccessOptions,
  wrap: deploymentResult
});
```

Then export methods equivalent to:

```js
readPublishTerminal: publishTerminalAccessors.read
closePublishTerminal: publishTerminalAccessors.close
subscribePublishTerminal: publishTerminalAccessors.subscribe
writePublishTerminal: publishTerminalAccessors.write
resizePublishTerminal: publishTerminalAccessors.resize
```

If method binding is unclear, wrap them explicitly:

```js
async readPublishTerminal(terminalSessionId, input = {}) {
  return publishTerminalAccessors.read(terminalSessionId, input);
}
```

Prefer clarity over cleverness.

### Route Migration Detail

Replace hand-written publish terminal routes with:

```js
registerServiceOwnedTerminalRoutes(app, routes, {
  basePath: "/publish-terminal",
  body: deploymentPublishInputValidator,
  projectContext,
  serviceId: VIBE64_DEPLOYMENTS_SERVICE,
  serviceUnavailableMessage: "Vibe64 deployment service is unavailable.",
  getService: () => getDeploymentsService(app),
  buildStartInput: requestBodyWithUser(routes),
  buildAccessInput: withVibe64User,
  methods: {
    start: "startPublishTerminal",
    read: "readPublishTerminal",
    close: "closePublishTerminal",
    subscribe: "subscribePublishTerminal",
    resize: "resizePublishTerminal",
    write: "writePublishTerminal"
  },
  summaries: {
    start: "Start a Vibe64 publish terminal for the current project.",
    read: "Read a Vibe64 publish terminal for the current project.",
    close: "Close a Vibe64 publish terminal for the current project."
  }
});
```

Adjust the exact `buildStartInput` and `buildAccessInput` callbacks to match the
existing helper signatures in `registerRoutes.js`. The behavior must remain
identical.

Current deployment code registers the three publish-terminal HTTP routes near
the publish action route, then registers the publish terminal websocket near the
end of `registerRoutes`. The new helper registers the four routes together. That
ordering change is accepted because the route paths are distinct. The required
test is route-shape/delegation coverage, not exact registration position.

### Routes That Must Not Change

Preserve exactly:

```text
POST /publish-terminal
GET /publish-terminal/:terminalSessionId
DELETE /publish-terminal/:terminalSessionId
/publish-terminal/:terminalSessionId/ws
```

No route rename is allowed in this slice.

### Behavior That Must Not Change

- Start request validation.
- Start request body/user merging.
- Read request user propagation.
- Close request user propagation.
- Websocket subscribe user propagation.
- Websocket write user propagation.
- Websocket resize user propagation.
- Namespace calculation.
- Owner/access behavior.
- Terminal metadata.
- Publish runner input file creation.
- Failed-start cleanup.
- Success app auth sync.

### Deployment Tests

Add:

```text
tests/server/deploymentPublishTerminalRoutes.unit.test.js
```

Update:

```text
tests/server/deploymentService.unit.test.js
```

Follow existing private test import style:

```js
await importFromComposition(
  composition.appRoot,
  "@vibe64-online/deployments/src/server/registerRoutes.js"
)
```

Do not import `@vibe64-online/deployments/server/registerRoutes` unless the
private package intentionally adds that export. The current package exports do
not expose that subpath.

Together, they must prove:

- route helper registration preserves all four public publish terminal paths
- route helper registration can move publish-terminal websocket registration next
  to the publish-terminal HTTP routes without changing path/delegation behavior
- start route calls `startPublishTerminal` with the same input as before
- read route calls `readPublishTerminal` with terminal id and user input
- close route calls `closePublishTerminal` with terminal id and user input
- websocket route calls subscribe/write/resize with the same arguments as before
- migrated publish terminal service methods preserve behavior under the
  deployment publish namespace and owner/access policy
- public `createOwnedTerminalAccessors` tests prove primitive delegation and
  argument order; private deployment tests do not need to spy on imported
  owned-terminal primitives
- failed start still removes the generated terminal input file

Keep route tests unit-level. Keep service tests behavior-oriented using real
terminal sessions or existing service-level seams where practical. Do not add
deployment-service dependency injection solely to spy on owned-terminal
primitive calls. Do not claim app-auth sync is unit-proven unless the existing
code already has a real full-path seam for it. Use manual or full-path smoke
verification for successful publish app-auth sync if a full publish is too
expensive for the regular test suite.

### Manual Verification

After the private migration, verify:

1. Open deployment publish terminal from the UI.
2. Confirm output streams.
3. Refresh/reconnect while terminal is running.
4. Close terminal from the UI.
5. Run a successful full publish path, or an existing full-path publish smoke,
   and confirm the same app auth sync behavior.
6. Run or simulate a failed start and confirm terminal input cleanup still
   happens.

### Verification Commands

Public helper changes:

```text
node --test tests/server/terminalAccess.unit.test.js
node --test tests/server/serviceOwnedTerminalRoutes.unit.test.js
node --test tests/server/terminalInventory.unit.test.js
npm run test
npm run verify
```

Private deployment migration:

```text
VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 node --test tests/server/deploymentPublishTerminalRoutes.unit.test.js
VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 node --test tests/server/deploymentService.unit.test.js
VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm run test
VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm run build
```

These commands are run from `/home/merc/vibe64/vibe64-online`.

Use `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64` until the online submodule
pointer has been updated to a public commit containing the new helpers. Without
that override, online composition uses the deployment-managed public editor
submodule and may not see the helper changes.

Post-submodule verification, after the online submodule pointer references the
public commit containing the new helpers and the override is no longer needed:

```text
npm run verify
npm run build
```

Run these from `/home/merc/vibe64/vibe64-online` with no `VIBE64_PUBLIC_ROOT`
override so the managed submodule path is tested.

### Rollback Plan

This slice should be easy to revert.

If deployment publish behavior changes unexpectedly:

- keep Slice 1 through Slice 3 helpers if their tests pass
- revert only the deployment publish migration
- leave the old deployment publish routes and access wrappers in place
- update this plan with the concrete behavior the helper failed to express

### Done When

- Deployment publish still works through the same public routes.
- Deployment publish no longer hand-writes the standard
  read/close/subscribe/write/resize wrappers.
- Deployment publish no longer hand-writes the standard terminal route family.
- The only deployment-specific terminal code left is genuinely deployment
  behavior.
- No client behavior changed.

## Slice 5: Document The Rule

### Purpose

Make the narrow policy explicit for future contributors.

### Executable Checklist

- [ ] Add a short top-of-file or JSDoc comment to
      `packages/vibe64-core/src/server/serviceOwnedTerminalRoutes.js`.
- [ ] Add a short JSDoc comment near `createOwnedTerminalAccessors`.
- [ ] Ensure `tests/server/terminalInventory.unit.test.js` failure text points
      to both helpers.
- [ ] Keep this plan updated with the final helper names if implementation names
      change.
- [ ] Add a compact deployment publish example near the route helper.
- [ ] Re-run `npm run test` after documentation comments if no code behavior was
      changed.

### Documentation Text

Add this rule near the new helpers and keep it in this plan:

```text
New service-owned run-command/job terminals must use
registerServiceOwnedTerminalRoutes and createOwnedTerminalAccessors unless they
document why they are not the standard shape.
```

### Where To Document

At minimum:

- JSDoc or top-of-file comment in
  `packages/vibe64-core/src/server/serviceOwnedTerminalRoutes.js`
- JSDoc or top-of-file comment near `createOwnedTerminalAccessors`
- failure message in `tests/server/terminalInventory.unit.test.js`
- this plan

### Example To Include

Use deployment publish as the example.

The example should show:

- service keeps explicit `startPublishTerminal`
- service uses `createOwnedTerminalAccessors` for standard I/O
- routes use `registerServiceOwnedTerminalRoutes`
- publish-specific side effects stay in deployment code

### Done When

- A future service-owned terminal addition has a clear recipe.
- The inventory test points developers to the recipe.
- The helper comments explain what the helpers intentionally do not cover.

## What Stays As-Is

### Workflow Command And Project Tool

Leave these alone for now.

Reason:

- They already live in the established command terminal module.
- Project tool uses `startCommandTerminalProcess`.
- Workflow command has additional workflow result/fact lifecycle.
- Project tool can be command-backed or prompt-backed.
- Changing them now risks broad behavior drift with little payoff.

Allowed later improvement:

- Only add focused tests or tiny cleanup if it makes the existing shared path
  easier to maintain.

### Shell

Leave shell alone.

Reason:

- It is an interactive terminal, not a command/job result surface.
- It has detached idle behavior and session tab behavior.

### Launch

Leave launch alone.

Reason:

- It is service orchestration: readiness markers, preview proxy, restart, stale
  recovery, stop, and open-preview behavior.
- It is not just "run command and stream output."

### Codex And Fix Codex

Leave Codex and Fix Codex alone.

Reason:

- Codex has app-server/thread/attachment/restart behavior.
- Fix Codex creates a repair job, auto-injects prompts, and reports completion
  through a helper.

### Account Auth

Leave auth alone.

Reason:

- Auth has provider modes, redaction, reuse, account state updates, and
  attention-only terminal display.

### Target Scripts

Leave target scripts alone.

Reason:

- They are current-app panel commands with retry/close behavior and adapter-owned
  script semantics.
- They might become a later candidate only if the deployment publish helper
  proves useful and target-script code has obvious repeated glue.

### Setup Doctor

Leave setup doctor alone.

Reason:

- Its repair terminal toolkit is compact and tied to setup checks.
- It should not be forced into the service-owned helper unless a concrete
  duplicated route/accessor problem appears.

## Acceptance Criteria For The Whole Plan

The plan is complete when:

- Inventory/drift tests exist and catch new terminal openers/routes.
- `createOwnedTerminalAccessors` exists and is tested.
- `registerServiceOwnedTerminalRoutes` exists and is tested.
- Deployment publish uses those helpers.
- Deployment publish behavior and public routes are unchanged.
- No unrelated terminal family was migrated.
- Command/project-tool command execution is unchanged.
- The codebase has a clear rule for future service-owned command/job terminals.

## What Would Make This Plan Not Practical

Stop and reassess if implementation starts to require any of the following:

- a universal terminal descriptor system
- a new generic terminal controller for all terminal types
- route renames
- auth policy changes
- migration of shell, launch, Codex, auth, target scripts, or setup doctor
- rewriting command/project-tool command execution
- feature-specific behavior inside the shared helpers
- helper APIs with many optional lifecycle hooks
- helper APIs that need to understand launch, Codex, auth, or setup semantics

Those are signs the slice is becoming the broad refactor this plan is meant to
avoid.

## Implementation Order

Use this exact order:

1. Add inventory/drift test.
2. Add owned accessor helper and tests.
3. Add service-owned route helper and tests.
4. Migrate deployment publish accessors.
5. Migrate deployment publish routes.
6. Run focused tests.
7. Run broader public verification.
8. Run private deployment verification.
9. Add/update the documentation rule.

Do not start with deployment publish. The helpers should exist and be tested
before touching the real service.

## Review Checklist

For each PR or commit in this plan, check:

- Did this slice change runtime behavior?
- If yes, was that slice supposed to?
- Are route paths unchanged?
- Are request input builders unchanged?
- Are websocket subscribe/write/resize arguments unchanged?
- Did any non-target terminal family change?
- Did helper code stay feature-agnostic?
- Did tests cover the helper contract directly?
- Did the inventory update include a reason?

## Expected End State

After this plan:

- Adding another deployment-like terminal is smaller and clearer.
- New terminal opener drift is visible in tests.
- Deployment publish has less repeated route/accessor code.
- Deployment publish still owns deployment-specific behavior.
- Existing special terminal families remain special.
- The codebase avoids both extremes:
  - no repeated route/accessor boilerplate for standard service-owned jobs
  - no universal terminal abstraction that erases real lifecycle differences
