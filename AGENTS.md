# Vibe64 Agent Notes

## Where you're running

Development normally happens inside a Vibe64 session, often with connected
sources listed in `.development/connected.json`. Agents also run directly in a
checkout on the person's laptop. The Git workflow depends on which:

- **Inside a Vibe64 session**: the session's source checkout is your working
  copy. Vibe64 creates it with the session and, on archive, preserves its work
  in the recovery archive before removing it; do not create, replace or delete
  it yourself. Bring work into main with the session's **Save**. Connected
  checkouts save to their own contribution branches (**Save connected first**),
  which the receiving project merges through **Incoming changes**. Keep the
  session current with **Update this session (rebase)** and its connected
  checkouts with **Update connected repositories** (see **Shared development
  checkouts**). Do not fetch, pull, reset or rebase these checkouts yourself.
- **On a laptop**: the main checkout is a read-only home base. A session-start
  fast-forward keeps it current, only when it has no local commits; never merge,
  reset or rebase it, and leave its local edits alone. Make each change in a
  `git worktree` created from current `origin/main`, push it, then remove your
  worktree. Your own worktree has no other owner: run its focused tests there.

Either way, never discard or overwrite another person's or agent's work.

## Standing permission for JSKIT development

The person authorizes coding agents working on Vibe64 to make the JSKIT source,
documentation and focused test changes necessary to complete an already-authorized
development task. Do not ask again merely because the fix belongs in JSKIT. This
supersedes a project-only editing restriction for that dependency work; a later
explicit human restriction still takes precedence.

In a Vibe64 session, edit JSKIT only in the connected checkout listed in
`.development/connected.json` (its `sourceRoot`); do not assume the active tab,
a remembered session path or an Env value names it. On a laptop, use a JSKIT
worktree as above. Preserve existing work and coordinate overlapping files with
the JSKIT owner. Coordination establishes who edits and tests; it is not another
permission request. Tests run in the owning project's session. Send the exact
focused command, checkout and changed files through the supported project-message
mechanism; the owner checks for an existing run, runs or queues the check, and
replies with its result and log location. Do not bypass the execution boundary
or describe its refusal as missing human consent. These relevant checks do not
need another human approval.

Use supported development source composition (connected sources) without
changing release versions just to consume source edits. Report missing
source-composition support as an implementation gap. This permission alone does
not authorize npm publication, deployment, destructive Git operations or
unrelated framework work. Existing architectural boundaries and test-scope
requirements still apply.

## Shared development checkouts

Connected repositories (for example JSKIT and Genesis) are checkouts owned by a
receiving contribution session in their own project, named after the consuming
session. `.development/connected.json` lists each one's `sourceRoot`; treat it
as an integration workspace with an owning agent, not an unrestricted shared
editor. Existing permission to edit a dependency still applies; coordination
does not require another human approval.

Workspace preparation (on session creation, after **Update this session
(rebase)** and on **Prepare workspace**) and **Update connected repositories**
rebase each connected checkout onto its integration branch, carrying its edits.
They skip one whose agent is working, whose Save or Update is running, whose
published contribution awaits acceptance, or whose update would conflict, and
the preparation output says why. Main Save refuses while a connected checkout is
behind its branch. Before editing one, check its preparation line; if it was not
updated, resolve the stated cause and choose **Update connected repositories**
again rather than fetching, resetting or pulling it yourself.

Before editing a shared checkout, tell its owner the task and intended files.
Agree who owns overlapping files before either agent edits them; independent,
nonoverlapping edits may proceed. Include shared contracts when identifying
possible overlaps, not just filenames. Preserve other agents' work and report
changed files and verification results when handing ownership back.

Tests run in the owning project's session. Its owner serializes runs and arranges
a stable checkout for each check: no concurrent edits to the code, fixtures or
dependencies being tested. Other agents request the exact focused command and
receive its result and log location. Do not run sibling-project commands to
bypass this boundary.

Do not reconcile, rebase, merge, reset or replace a shared checkout while an
agent is editing or testing it. Arrange a checkpoint with all active writers;
the checkout owner then reconciles under the existing repository rules,
preserving tracked, untracked and staged work. A connected checkout is not a
write lock on its project.

Keep large independent plans in separate sessions so the receiving contribution
session can handle integration requests. Bring completed, tested slices back
through the normal review and publication workflow. Incorporate main at agreed
checkpoints, not in the middle of edits or tests. Address a particular colleague
and replies by exact session ID; use the project default only when its selected
owner is the intended recipient. If the recipient is unclear, ask instead of
guessing.

## Ownership Extractions

NO REIMPLEMENTATION FROM SCRATCH. An ownership move starts from the existing
implementation and its behavioral tests. Classify each piece before extracting:
move to the shared owner, stay in the application, or supply as a host facility.
Changes in how the code works are allowed when necessary to keep ownership
correct; identify that necessity explicitly. Preserve established process sharing,
account isolation, recovery and lifecycle guarantees. Do not build a parallel
implementation and use new tests to justify replacing the original. Keep genuine
new facilities that have no existing counterpart. Preserve a reviewable reference
and current work before corrective extraction.

The user-confirmed production implementation is the reference: it has been used,
tested and tuned over days. Smaller replacement code is not evidence of parity.
The conversation-runtime extraction must also meet the seven requirements in
[`docs/conversation-runtime-extraction-requirements.md`](docs/conversation-runtime-extraction-requirements.md);
read them before working on it.

For each extraction, record the original source, destination, necessary ownership
adaptation and original test evidence before calling it complete. A new test suite
cannot replace that evidence. Discuss any material redesign before implementing it.

When moving a consumer onto shared code, move the coordination that consumer
relied on at the same time, and check every other user of the same resource.

## Repository boundaries

This repository is implemented with JSKIT runtime APIs and package-owned source
patterns, but the product is Vibe64. JSKIT has no general source-authoring CLI;
its supported commands only manage and check the package graph. Use the
repository's npm scripts, selected Genesis Stack guidance, and JSKIT's
authoritative documentation and package-owned patterns for maintenance and
verification.

- This repository's `origin/main` is the public Vibe64 source of truth; edit it
  only as described in **Where you're running**.
- Genesis owns project intent, technology guidance, explanatory Program, agent skills, hooks, verification guidance, and Machine/Program Cities. Its portable files live below `genesis/`, `.genesis/`, `.agents/skills/`, `.codex/hooks.json`, `.claude/settings.json`, and the generated `.opencode/plugins/genesis-project-guidance.js`.
- `vibe64.project.json` and `vibe64.runtime-lock.json` are unsupported obsolete contracts. Do not recreate or read them.
- `.vibe64/` is not product, prompt, Stack, Program, indexing, or City authority. Keep only narrowly declared application helpers such as a Vibe64 Launch preview-identity executable when required.
- Runtime/session state is Vibe64-owned runtime-local state, not source-owned repository content.
- Do not create loose workboard files.
- Do not restore `jskit doctor`, generator commands, scaffold provenance,
  receipts, migration copies, or CLI-managed CI state. Verify current source,
  runtime behavior, package boundaries, and tests through their direct owners.
- Session source permissions on a host shared by several Unix identities must be
  correct when files are created; never add recursive permission repair after
  Git, agent, package or preview work. See
  [`docs/managed-session-filesystem-contract.md`](docs/managed-session-filesystem-contract.md).
- Never deploy unless the user explicitly requests deployment.

## Deployment Terminology

- The Deploy feature is product functionality that publishes the selected
  user's project from its Vibe64-owned Deployment contract. Genesis composes
  and returns that Stack section as opaque text; it does not define deployment.
- This repository's `## Deployment` section describes only how this public
  Vibe64 application itself may run as a managed application. Its schema is
  interpreted mechanically by `@local/vibe64-genesis`, not by Genesis.

Keep these two scopes separate even though they share the word "deploy."

## Colleague Usage Documentation

Every application change must update the affected Colleague usage documentation
in the same change; this is part of completion, not a later documentation task.
It covers features, labels, navigation, permissions, prerequisites, defaults,
outcomes, errors and recovery. Create a missing usage topic when necessary.

Keep task-oriented guides under `docs/colleague-usage/` in the repository that
owns the behavior: shared editor guides belong here; hosts own their additional
guides. Ship them with the matching release. Describe exact visible controls and
steps, relevant desktop/mobile differences, expected results, recovery, and which
steps Colleague can perform or require the person's interaction. Verify them
against the actual UI and actions. Blueprint, Program and action schemas do not
replace usage guides.

Colleague must answer how-to questions with useful instructions and offer to
perform the supported task. A how-to question or an offer does not authorize
execution; an accepted offer or direct request uses the existing actions,
permissions and confirmation rules. Keep human-only steps explicit. Usage
knowledge grants no source, shell or screenshot access.

## Persisted State Upgrades

For a persisted application-data or metadata format change (including message
history), or a historical repair, read
[`docs/state-upgrades.md`](docs/state-upgrades.md). Add a numbered upgrade to
`packages/vibe64-core/src/server/stateUpgrades/` and its ordered registry.
Deployments run these with writers stopped; successful IDs are recorded once.
Do not add lazy backfills to account reads, request handlers, project opening,
or normal startup. New writes must produce the current format. Upgrades need
read-only preflight, actionable warnings/errors, backup, safe retry and focused
tests. Published upgrade scripts and ordering are immutable; fixes use a new
script. The implemented API is `{ id, run }`; each script currently owns its
backups. The guide distinguishes this from the proposed, unimplemented
`prepare()`/`backupPaths` API. Do not assume the runner or deployment creates
backups for you.

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
- Focused local tests are not the whole proof. After pushing to `main`, check
  that repository's GitHub CI run (`gh run list`, `gh run watch`) and, if it is
  red, fix it before moving on.
