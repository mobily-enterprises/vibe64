# Vibe64 Agent Notes

This repository is implemented with JSKIT runtime APIs and package-owned source
patterns, but the product is Vibe64. JSKIT has no general source-authoring CLI;
its supported commands only manage and check the package graph. Use the
repository's npm scripts, selected Genesis Stack guidance, and JSKIT's
authoritative documentation and package-owned patterns for maintenance and
verification.

Important boundaries:

- `/home/merc/Development/current/vibe64` is the writable public Vibe64 source of truth.
- `/home/merc/Development/current/vibe64-online/submodules/public-vibe64-local-editor` is a deployment-managed read-only submodule mirror. Do not edit, commit, or deploy from inside that submodule.
- To release editor changes to hosted Vibe64: change, commit, and push this
  repository, commit and push any ordinary Online changes, then run `npm run
  deploy` from `/home/merc/Development/current/vibe64-online`. The Online
  deploy workflow verifies both published checkouts and owns the public-editor
  gitlink update and its pointer-only commit; do not duplicate those steps by
  hand.
- Genesis owns project intent, technology guidance, explanatory Program, agent skills, hooks, verification guidance, and Machine/Program Cities. Its portable files live below `genesis/`, `.genesis/`, `.agents/skills/`, and `.codex/hooks.json`.
- `vibe64.project.json` and `vibe64.runtime-lock.json` are unsupported obsolete contracts. Do not recreate or read them.
- `.vibe64/` is not product, prompt, Stack, Program, indexing, or City authority. Keep only narrowly declared application helpers such as a Vibe64 Launch preview-identity executable when required.
- Runtime/session state is Vibe64-owned runtime-local state, not source-owned repository content.
- Do not create loose workboard files.
- Do not restore `jskit doctor`, generator commands, scaffold provenance,
  receipts, migration copies, or CLI-managed CI state. Verify current source,
  runtime behavior, package boundaries, and tests through their direct owners.
- Never deploy unless the user explicitly requests deployment.

## Deployment Terminology

- The Deploy feature presented by hosted Vibe64 is product functionality that
  publishes the selected user's project from its Vibe64-owned Deployment
  contract. Genesis composes and returns that Stack section as opaque text; it
  does not define deployment.
- This repository's `## Deployment` section describes only how this public
  Vibe64 application itself may run as a managed application. Its schema is
  interpreted mechanically by `@local/vibe64-genesis`, not by Genesis.
- Releasing public Vibe64 into the hosted platform is neither of those things;
  it is owned by `npm run deploy` in the private `vibe64-online` repository.

Keep those scopes separate even though they share the word "deploy."

## Persisted State Upgrades

For a persisted application-data or metadata format change (including message
history), or a historical repair, read
[`docs/state-upgrades.md`](docs/state-upgrades.md). Add a numbered upgrade to
`packages/vibe64-core/src/server/stateUpgrades/` and its ordered registry.
Deployments run these with writers stopped; successful IDs are recorded once.
Do not add lazy backfills to account reads, request handlers, project opening,
or normal startup. New writes must produce the current format. Upgrades need
read-only preflight, actionable warnings/errors, safe retry and focused tests.
Published upgrade scripts and ordering are immutable; fixes use a new script.
The implemented API is `{ id, run }`; each script currently owns its backups.
The guide distinguishes this from the proposed, unimplemented
`prepare()`/`backupPaths` API. Do not assume the runner creates backups for you.

## Test Execution Safety

Do not start tests unless they are relevant to the current work, and never
overlap a test run already active for this checkout.

- During development, run exactly one relevant test file with
  `npm test -- tests/server/<name>.test.js`. The root test command refuses to
  run without exactly one explicit test file. Write optional Node test runner
  arguments in `--option=value` form.
- Do not pass a glob, directory, or multiple test files to `npm test`, and do
  not bypass this guard with a direct broad `node --test` command.
- Every repository-owned Node test command fixes test-file concurrency at one.
  Do not raise or bypass this limit.
- `npm run test:full` and `npm run verify` are broad verification commands.
  Run them only after the human has confirmed that the feature works and has
  explicitly approved full verification.

## Known Session Defects To Fix

These defects were reproduced on the hosted `sas/dogandgroom` session
`2026-08-15_01-59-27` on 2026-08-15. Do not lose them during the Genesis-first
session rewrite:

- Direct chat can continue successfully while a stale
  `step-state/<current-step>` record remains `waiting_for_input` with
  `source: system_recovery`. The UI then incorrectly shows “This session needs
  recovery”. Goal state and direct-chat delivery must have one unambiguous
  owner, and successful later delivery must supersede any stale recovery
  marker without deleting or restarting the Codex thread.
- Session source permissions must be correct when files are created. Every
  hosted writer enters through the shared `vibe64` group with umask `0007`, and
  managed project roots are setgid and carry the mandatory inherited default
  group ACL. Do not add recursive permission repair after Git, agent, package,
  or preview work; a host that cannot satisfy the creation-time contract must
  fail before work begins. The incident evidence, exact modes, ACLs, and
  cross-identity verification requirements are durable in
  `docs/managed-session-filesystem-contract.md`.
