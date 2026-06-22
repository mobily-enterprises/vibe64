# GitHub Actor-Scoped Execution Plan

## Summary

Vibe64 needs one shared, structural GitHub execution model that works for both products:

- **Vibe64** owns the reusable mechanism: GitHub provider-home resolution, terminal ownership, owner enforcement, brokered GitHub operations, command execution, logging, and tests.
- **vibe64-online** owns the hosted identity source: authenticate the browser request, attach the current `vibe64User`, set GitHub account mode to `user`, and enforce online project/session access.
- **Base/local Vibe64** uses the same shared code with GitHub account mode `local`.
- **Codex must not receive user GitHub credentials directly** because the Codex app-server is session-scoped and can be shared by multiple users.
- **User-facing terminals that can run `gh` must be actor-scoped** in online and local-scoped in base Vibe64.
- **Runtime app containers must not receive GitHub credentials**.

The desired end state:

```text
Vibe64 provides actor-aware GitHub execution.
vibe64-online provides the actor.
Codex requests GitHub operations through Vibe64.
GitHub credentials never leak into shared/session-scoped Codex runtimes.
```

## Non-Negotiable Rules

- [x] Do not duplicate GitHub execution logic in `vibe64-online`.
- [x] Do not put online-only concepts in public/shared Vibe64 packages.
- [x] Do not mount a user GitHub home into the shared Codex app-server.
- [x] Do not let Codex choose the GitHub actor.
- [x] Do not let Codex send arbitrary shell, `git`, or `gh` command strings to a privileged broker.
- [x] Do not silently fall back from `user` account mode to `local` account mode.
- [x] Do not give runtime app containers user GitHub provider credentials.
- [x] Do not fix this by hiding errors or making unauthenticated `gh` failures quieter.
- [x] Do not make terminal access control UI-only. Enforce it server-side.
- [x] Do not allow another user to attach to, write to, resize, or close a user-owned terminal.

## Product Boundary

### Shared Vibe64 Owns

- [x] GitHub account mode abstraction: `local` and `user`.
- [x] Actor-to-provider-home resolution.
- [x] User/local terminal ownership metadata.
- [x] Server-side terminal owner checks.
- [x] Actor-aware terminal process startup.
- [x] GitHub broker operation schema and implementation.
- [x] Codex broker helper generation and mounting.
- [x] Redaction, audit logs, and structured errors.
- [x] Tests for all shared behavior.

### vibe64-online Owns

- [x] Authenticating browser/API requests.
- [x] Attaching the current actor as `request.vibe64User`.
- [x] Setting shared GitHub account mode to `user`.
- [x] Enforcing online user/project/session access.
- [x] Surfacing broker/terminal errors in online UI.
- [x] No duplicated `gh`/`git` execution logic.

### Base/Local Vibe64 Owns

- [x] Running the same shared code with GitHub account mode `local`.
- [x] Using the local GitHub provider home.
- [x] Keeping local single-user behavior simple.
- [x] No dependency on `vibe64-online`.

## Current State To Preserve

- [x] Existing workflow command terminals already pass `request.vibe64User` in the online path.
- [x] Existing command terminal code already resolves a GitHub provider home from `vibe64User` or local mode.
- [x] Existing setup doctor paths already appear actor-aware in online mode.
- [x] Existing provider-home layout already separates:
  - `provider-homes/codex`
  - `provider-homes/github/local`
  - `provider-homes/github/<user-key>`
- [x] Existing command workflow scripts for commit, push, PR, issue, sync, and merge should be reused instead of rewritten where possible.

## Current Gaps

- [x] Shell terminals are not actor-scoped.
- [x] Project tool terminals are not actor-scoped.
- [x] Terminal read/write/resize/close/websocket operations do not enforce owner identity.
- [x] Codex app-server has no request actor and must not get user GitHub credentials.
- [x] Global Codex terminal must remain app-scoped and must not get user GitHub credentials.
- [x] Fix Codex jobs must not receive ambient user GitHub credentials unless they become explicitly actor-owned.
- [x] Workflow command terminal behavior needs tests proving user A and user B use different GitHub homes.
- [x] Online needs tests proving request actor identity cannot be spoofed from client request bodies.

## Terminology

- [x] **Actor**: the identity on whose behalf a request or operation runs.
- [x] **Account mode `local`**: base/local Vibe64 mode; GitHub home is `provider-homes/github/local`.
- [x] **Account mode `user`**: online mode; GitHub home is `provider-homes/github/<user-key>`.
- [x] **User key**: canonical safe key derived from authenticated Vibe64 user identity, currently email-based.
- [x] **Provider home**: filesystem home mounted as tool `HOME` for a provider.
- [x] **Terminal owner**: the actor allowed to read/write/resize/close/attach to a terminal.
- [x] **Broker**: shared Vibe64 service that runs named GitHub operations for the correct actor without exposing credentials to Codex.

## Phase 1: Shared Actor Model

- [x] Add or formalize a shared `GithubActor`/`ToolActor` data shape in public Vibe64 code.
- [x] Keep the shape generic:

```js
{
  accountMode: "local" | "user",
  vibe64User: null | {
    email: "...",
    github: {}
  }
}
```

- [x] Do not add tenant IDs, online account IDs, public URLs, private route names, or hosted deployment data to shared actor types.
- [x] Add a shared helper:

```js
resolveGithubToolHomeForActor({
  accountMode,
  providerHomesRoot,
  vibe64User
})
```

- [x] Implement strict behavior:
  - [x] `local` mode resolves `provider-homes/github/local`.
  - [x] `user` mode requires `vibe64User`.
  - [x] `user` mode without `vibe64User` returns a loud structured error.
  - [x] missing provider homes root returns a loud structured error.
  - [x] no fallback from `user` to `local`.
- [x] Return structured metadata:

```js
{
  ok: true,
  accountMode: "user",
  providerScope: "user",
  ownerUserKey: "...",
  ownerEmail: "...",
  toolHomeSource: "..."
}
```

- [x] Add unit tests for:
  - [x] local mode home resolution.
  - [x] user mode home resolution.
  - [x] user mode missing user failure.
  - [x] missing provider root failure.
  - [x] invalid/spoofed user key rejection.
  - [x] no silent fallback.

## Phase 2: Terminal Ownership Model

- [x] Define a shared terminal owner metadata shape:

```js
{
  ownerScope: "local" | "user" | "app",
  ownerUserKey: "",
  ownerEmail: "",
  githubProviderScope: "app" | "user",
  githubToolHomeSource: ""
}
```

- [x] Add helpers:
  - [x] `terminalOwnerForGithubActor(...)`
  - [x] `terminalOwnerMatchesRequest(...)`
  - [x] `terminalOwnerMetadata(...)`
  - [x] `terminalOwnerError(...)`
- [x] Store terminal owner metadata when a terminal is created.
- [x] Store enough metadata to distinguish:
  - [x] local user-facing terminal.
  - [x] online user-owned terminal.
  - [x] app-owned Codex/global terminal.
  - [x] runtime app/launch container with no GitHub actor.
- [x] Make owner metadata visible in debug logs without printing secrets.
- [x] Add unit tests for owner matching:
  - [x] same local actor allowed.
  - [x] same online user allowed.
  - [x] different online user rejected.
  - [x] anonymous request rejected in user mode.
  - [x] app-owned terminal does not accept a user GitHub identity by accident.

## Phase 3: Enforce Terminal Ownership Server-Side

- [x] Update terminal read routes to pass request actor into service methods where required.
- [x] Update terminal write routes to pass request actor into service methods where required.
- [x] Update terminal resize routes to pass request actor into service methods where required.
- [x] Update terminal close routes to pass request actor into service methods where required.
- [x] Update websocket subscribe/write/resize paths to pass request actor into service methods where required.
- [x] Enforce owner checks in the terminal service/controller layer, not only in routes.
- [x] Return explicit errors for owner mismatch:
  - [x] `403` for authenticated wrong user.
  - [x] `401` or product-standard auth error for missing actor in user mode.
  - [x] structured error code such as `vibe64_terminal_owner_mismatch`.
- [x] Log owner mismatch attempts with:
  - [x] terminal id.
  - [x] session id/tool id.
  - [x] terminal kind.
  - [x] expected owner scope/key.
  - [x] observed owner scope/key.
  - [x] no secrets.
- [x] Add tests for:
  - [x] read denied to wrong user.
  - [x] write denied to wrong user.
  - [x] resize denied to wrong user.
  - [x] close denied to wrong user.
  - [x] websocket attach denied to wrong user.
  - [x] owner checks happen server-side even if UI is bypassed.

## Phase 4: User-Scoped Shell Terminals

- [x] Change `/sessions/:sessionId/shell-terminal` route input to include server-derived `vibe64User`.
- [x] Do not accept client-supplied `vibe64User` as authoritative.
- [x] Resolve the GitHub tool home through the shared actor helper.
- [x] In online/user mode, fail loudly if the actor or GitHub provider home is unavailable.
- [x] In local mode, use the local GitHub provider home.
- [x] Mount the resolved GitHub-aware tool home for shell terminals.
- [x] Record terminal owner metadata.
- [x] Enforce owner checks on shell terminal read/write/resize/close/websocket.
- [x] Update UI behavior only after server enforcement is correct.
- [x] Add tests:
  - [x] local shell terminal gets local GitHub home.
  - [x] online shell terminal for user A gets user A home.
  - [x] online shell terminal for user B gets user B home.
  - [x] user B cannot attach to user A shell terminal.
  - [x] missing GitHub setup fails loudly in online mode.

## Phase 5: User-Scoped Project Tool Terminals

- [x] Change `/tools/:toolId/run` route input to include server-derived `vibe64User`.
- [x] Do not accept client-supplied `vibe64User` as authoritative.
- [x] Thread actor input through project tool run preparation without adding online-specific concepts.
- [x] Resolve GitHub tool home through the shared actor helper when the project tool terminal can run toolchain commands.
- [x] Record terminal owner metadata.
- [x] Enforce owner checks on project tool terminal read/write/resize/close/websocket.
- [x] Keep project tool command definitions independent of online identity.
- [x] Add tests:
  - [x] project tool terminal gets local GitHub home in local mode.
  - [x] project tool terminal gets user GitHub home in online mode.
  - [x] wrong user cannot attach to project tool terminal.
  - [x] project tool `gh auth status` sees the expected account home.

## Phase 6: Preserve And Test Command Workflow Terminals

- [x] Keep existing command terminal actor threading.
- [x] Refactor command terminal provider-home resolution to use the new shared helper.
- [x] Record terminal owner metadata consistently.
- [x] Enforce owner checks on command terminal read/write/resize/close/websocket.
- [x] Add tests proving:
  - [x] route-injected `vibe64User` wins over any client body value.
  - [x] command terminal in online mode uses user A GitHub home for user A.
  - [x] command terminal in online mode uses user B GitHub home for user B.
  - [x] user B cannot attach/write/close user A command terminal.
  - [x] local mode continues to use local GitHub home.
- [x] Confirm existing workflow scripts still work:
  - [x] commit changes.
  - [x] push branch.
  - [x] create issue.
  - [x] create PR.
  - [x] merge PR.
  - [x] sync main checkout.

## Phase 7: Setup Doctor Review

- [x] Review setup doctor routes and service actor threading.
- [x] Refactor setup doctor GitHub provider resolution to use the shared helper if practical.
- [x] Keep setup doctor product logic separate from terminal owner enforcement.
- [x] Ensure setup doctor terminals record owner metadata where they use GitHub credentials.
- [x] Enforce owner checks on setup doctor terminal read/write/resize/close/websocket if those terminals are exposed interactively.
- [x] Add tests:
  - [x] online setup doctor terminal uses actor GitHub home.
  - [x] local setup doctor terminal uses local GitHub home.
  - [x] wrong online user cannot attach to setup doctor terminal.
  - [x] setup doctor does not log GitHub tokens.

## Phase 8: Codex GitHub Broker

- [x] Add a shared Vibe64 GitHub broker service.
- [x] Broker must expose named operations only:
  - [x] `git_status`
  - [x] `git_diff_summary`
  - [x] `current_branch`
  - [x] `remote_info`
  - [x] `commit_changes`
  - [x] `push_branch`
  - [x] `commit_and_push`
  - [x] `create_issue`
  - [x] `create_pr`
  - [x] `comment_pr`
  - [x] optional later: `merge_pr`
  - [x] optional later: `sync_branch`
- [x] Broker must reject:
  - [x] arbitrary shell commands.
  - [x] arbitrary `git` command strings.
  - [x] arbitrary `gh` command strings.
  - [x] paths outside the session worktree.
  - [x] repo remotes that do not match the project/session repository.
  - [x] branch names outside the session policy.
- [x] Broker must derive actor from server-side state, not from Codex input.
- [x] Broker must use shared GitHub provider-home resolution.
- [x] Broker must run operations in a short-lived toolchain process or existing command terminal execution path.
- [x] Broker must redact output.
- [x] Broker must produce audit logs:
  - [x] operation.
  - [x] actor user key/email.
  - [x] session id.
  - [x] thread id.
  - [x] turn id.
  - [x] target root/worktree.
  - [x] result status.
  - [x] no tokens/secrets.
- [x] Broker must return structured results:

```js
{
  ok: true,
  operation: "commit_and_push",
  summary: "...",
  terminalSessionId: "...",
  outputTail: "...",
  artifacts: {}
}
```

- [x] Add tests:
  - [x] allowed operation runs with actor home.
  - [x] unknown operation rejected.
  - [x] arbitrary command rejected.
  - [x] path traversal rejected.
  - [x] wrong repo rejected.
  - [x] missing actor rejected in online mode.
  - [x] local mode works with local home.
  - [x] output redaction covers tokens and credential-like strings.

## Phase 9: Codex Turn Actor Binding

- [x] When a user prompt is delivered to Codex, record server-side turn actor metadata.
- [x] Metadata should include:

```js
{
  sessionId: "...",
  codexThreadId: "...",
  codexTurnId: "...",
  actorScope: "local" | "user",
  actorUserKey: "...",
  actorEmail: "...",
  targetRoot: "...",
  worktreePath: "...",
  createdAt: "...",
  expiresAt: "..."
}
```

- [x] The actor must come from the authenticated request or local mode, not from Codex.
- [x] The metadata must be stored in shared Vibe64 session/runtime state.
- [x] The metadata must be queryable by the broker.
- [x] The broker must verify:
  - [x] turn exists.
  - [x] turn belongs to session.
  - [x] turn belongs to active or recently valid Codex context.
  - [x] actor still has access to the project/session.
  - [x] operation target matches the recorded worktree.
- [x] Add expiration rules to prevent old turns being reused indefinitely.
- [x] Add tests:
  - [x] broker operation succeeds for matching turn actor.
  - [x] broker operation fails with missing turn id.
  - [x] broker operation fails with stale turn id.
  - [x] broker operation fails with mismatched session.
  - [x] broker operation fails if a different user tries to reuse the turn.

## Phase 10: Codex Helper And Instructions

- [x] Add a small helper script for Codex to call the broker.
- [x] Mount or expose it through environment:

```text
VIBE64_GITHUB_BROKER_HELPER=/path/to/helper
```

- [x] Helper must support:
  - [x] `--list`
  - [x] `--schema <operation>`
  - [x] `--json '<payload>'`
- [x] Helper must not contain GitHub credentials.
- [x] Helper must call back to the local/shared Vibe64 broker endpoint.
- [x] Helper must include a broker token only if needed, scoped to session/turn and not to GitHub.
- [x] Add Codex developer instructions explaining:
  - [x] do not run `gh auth login`.
  - [x] do not run `gh auth token`.
  - [x] do not run direct `git push` for user-authenticated operations.
  - [x] use the broker helper for GitHub operations.
  - [x] use `--list` and `--schema` to discover available operations.
  - [x] report broker failures clearly.
- [x] Keep instructions generic and shared. Do not mention online-only implementation details.
- [x] Add tests:
  - [x] Codex briefing includes broker helper instructions when helper is available.
  - [x] helper can list operations.
  - [x] helper rejects invalid JSON.
  - [x] helper rejects missing session/turn context.
  - [x] helper does not print secrets.

## Phase 11: Mutating Operation Confirmation Policy

- [x] Classify broker operations:
  - [x] read-only: no confirmation required.
  - [x] mutating: confirmation required unless the user explicitly requested it in the current turn.
- [x] Read-only operations:
  - [x] `git_status`
  - [x] `git_diff_summary`
  - [x] `current_branch`
  - [x] `remote_info`
- [x] Mutating operations:
  - [x] `commit_changes`
  - [x] `push_branch`
  - [x] `commit_and_push`
  - [x] `create_issue`
  - [x] `create_pr`
  - [x] `comment_pr`
  - [x] `merge_pr`
  - [x] `sync_branch`
- [x] Define how explicit authorization is represented in turn metadata.
- [x] If confirmation is required, broker returns:

```js
{
  ok: false,
  code: "vibe64_github_confirmation_required",
  operation: "commit_and_push",
  confirmation: {...}
}
```

- [x] UI can then ask the user or route to an existing Vibe64 workflow action.
  - The base Vibe64 UI now surfaces a `Confirm GitHub operation` workflow control when the broker records `vibe64_github_confirmation_required`.
  - The control sends an explicit confirmation through the existing Codex steer route, and the server writes actor-scoped authorization metadata only after the provider accepts the steered message.
  - The steer route attaches the authenticated server user and strips any spoofed body user.
- [x] Add tests:
  - [x] read-only operation works without confirmation.
  - [x] mutating operation with explicit current-turn authorization works.
  - [x] mutating operation without authorization is blocked.
  - [x] old authorization cannot be reused.
  - [x] UI confirmation state builds explicit steer prompts.
  - [x] Codex steer writes/clears same-turn mutating authorization metadata.
  - [x] Codex steer route uses the authenticated server user, not body spoofing.

## Phase 12: Terminal Home Composition Follow-Up

The terminal tool-home model is now composed. Shell, command, project-tool, and setup-doctor toolchain containers use a terminal cache home as `HOME`, while the actor GitHub provider home is mounted separately and addressed through explicit GitHub/Git config paths.

Implemented design:

- create a per-terminal or per-actor tool cache home for `HOME`, shell history, npm cache, and other mutable tool state.
- mount the actor GitHub provider home separately as read/write GitHub auth/config storage.
- set `GH_CONFIG_DIR` to the mounted actor GitHub config directory when the installed `gh` version supports that path cleanly.
- keep `.gitconfig` and credential helper configuration in an explicit mounted config path or generated terminal-local file that points at the actor provider home.
- keep the security boundary in server-side owner enforcement plus per-actor provider homes; the generic terminal cache home is not an auth boundary.

- [x] Design a composed tool home model:
  - [x] stable terminal cache home.
  - [x] GitHub auth/config mounted from actor provider home.
  - [x] `GH_CONFIG_DIR` or gh-compatible config handling where possible.
  - [x] `.gitconfig` handling without polluting generic tool home.
- [x] Decide whether composition is required before initial release or can be follow-up.
- [x] Add tests proving:
  - [x] `gh auth status` uses actor config.
  - [x] npm/shell cache does not write into GitHub provider home.
  - [x] git credential helper still works.
  - Verified by composed tool-home assertions in `tests/server/doctorToolchain.unit.test.js` and `tests/server/vibe64TerminalsService.unit.test.js`.

## Phase 13: Online Wiring

All `vibe64-online` changes must be wiring only.

- [x] Confirm online auth gate always attaches authenticated `request.vibe64User`.
- [x] Confirm online provider sets GitHub account mode to `user`.
- [x] Confirm online request actor cannot be spoofed by body fields.
- [x] Pass online actor into shared routes through existing shared route hooks.
- [x] Add missing actor passing for:
  - [x] shell terminal start.
  - [x] project tool run.
  - [x] Codex prompt delivery/turn actor binding.
  - [x] broker helper callback route.
- [x] Keep online project/session access checks in online.
- [x] Do not move Caddy, tenants, deployment state, public URLs, or hosted publish concepts into shared Vibe64.
- [x] Add online tests:
  - [x] user A terminal uses user A GitHub home.
  - [x] user B terminal uses user B GitHub home.
  - [x] user B cannot attach to user A terminal.
  - [x] user A Codex broker operation uses user A GitHub home.
  - [x] user B cannot reuse user A Codex turn broker token.
  - [x] anonymous request cannot start user-scoped GitHub terminal.
  - [x] online auth-gated route actors cannot be spoofed from terminal/broker request bodies.
  - [x] direct composed terminal owner/broker enforcement tests pass against the current shared checkout via `VIBE64_PUBLIC_ROOT`.
  - [x] run direct composed terminal owner/broker enforcement tests after the online public submodule contains the shared broker/ownership changes.
  - Direct composed tests can also be run before the submodule advances by setting `VIBE64_PUBLIC_ROOT` to a checkout containing these shared changes.

## Phase 14: Base/Local Vibe64 Wiring

- [x] Confirm base/local Vibe64 defaults GitHub account mode to `local`.
- [x] Ensure the same shared terminal code path works without `vibe64-online`.
- [x] Ensure local shell terminals use `provider-homes/github/local`.
- [x] Ensure local command terminals use `provider-homes/github/local`.
- [x] Ensure local project tool terminals use `provider-homes/github/local`.
- [x] Ensure local Codex broker operations use `provider-homes/github/local`.
- [x] Add local tests:
  - [x] no `vibe64User` required in local mode.
  - [x] local mode does not accidentally require online auth.
  - [x] local mode terminal owner checks still work.
  - [x] local mode broker operations work.

## Phase 15: Surfaces That Must Not Receive User GitHub Credentials

- [x] Codex app-server:
  - [x] remains app/session-scoped.
  - [x] does not mount user GitHub provider home.
  - [x] uses broker for GitHub operations.
- [x] Global Codex terminal:
  - [x] remains app-scoped.
  - [x] does not mount user GitHub provider home.
- [x] Runtime app containers:
  - [x] do not receive GitHub provider homes.
  - [x] do not receive GitHub tokens.
- [x] Launch/preview app containers:
  - [x] do not receive GitHub provider homes.
  - [x] do not receive GitHub tokens.
- [x] Hosted production deployment containers:
  - [x] do not receive user GitHub provider homes unless an explicit future product feature requires it.
- [x] Fix Codex:
  - [x] uses broker if GitHub work is needed.
  - [x] does not get ambient GitHub credentials by default.
- [x] Add tests or assertions where possible to prove these surfaces do not mount user GitHub homes.

## Phase 16: Logging And Audit

- [x] Add structured logs for GitHub provider-home resolution:
  - [x] mode.
  - [x] provider scope.
  - [x] owner key hash or safe key.
  - [x] terminal kind/operation.
  - [x] no token values.
- [x] Add structured logs for owner mismatch attempts.
- [x] Add structured logs for broker operations.
- [x] Add structured logs for broker confirmation blocks.
- [x] Add structured logs for broker failures.
- [x] Ensure command previews and logs redact:
  - [x] tokens.
  - [x] passwords.
  - [x] `gh auth token` output.
  - [x] credential helper output.
  - [x] GitHub auth headers.
- [x] Add tests for redaction.

## Phase 17: UI Behavior

Server-side enforcement comes first.

- [x] Update terminal UI to handle `403` owner mismatch clearly.
- [x] Update terminal UI to show GitHub not connected errors clearly.
- [x] Update terminal UI to avoid offering attach/reuse when owner does not match.
- [x] Update Codex UI to surface broker confirmation-required responses.
- [x] Update Codex UI to surface broker operation results.
- [x] Do not rely on UI checks for security.

## Phase 18: Migration And Compatibility

- [x] Decide what to do with already-running terminals without owner metadata:
  - [x] safest option: treat as legacy and deny GitHub-sensitive attach in online mode.
  - [x] alternatively: allow only if account mode is local.
  - [x] log every legacy terminal access.
- [x] Add a compatibility window if needed:
  - [x] ownerless terminal access emits warning.
  - [x] ownerless terminal cannot receive user GitHub provider home.
  - [x] resource cleanup closes old ownerless terminals after TTL.
- [x] Document behavior for users:
  - [x] Old terminals without owner metadata are denied in online mode and should be restarted to pick up user-scoped GitHub auth.
  - [x] Local mode allows legacy ownerless terminals during the compatibility window and logs every access.
  - [x] Codex does not receive user GitHub credentials; it uses the Vibe64 GitHub broker for GitHub operations.

## Phase 19: Test Matrix

### Shared Unit Tests

- [x] Provider home resolution local mode.
- [x] Provider home resolution user mode.
- [x] Provider home missing root.
- [x] Provider home missing user in user mode.
- [x] Terminal owner metadata creation.
- [x] Terminal owner same-user match.
- [x] Terminal owner wrong-user rejection.
- [x] Terminal owner local mode match.
- [x] Terminal owner app scope behavior.
- [x] Broker schema validation.
- [x] Broker path validation.
- [x] Broker repo validation.
- [x] Broker confirmation policy.
- [x] Broker redaction.

### Shared Integration Tests

- [x] Shell terminal starts with local GitHub home in local mode.
- [x] Shell terminal starts with user GitHub home in user mode.
- [x] Command terminal starts with user GitHub home in user mode.
- [x] Project tool terminal starts with user GitHub home in user mode.
- [x] Wrong user cannot read terminal.
- [x] Wrong user cannot write terminal.
- [x] Wrong user cannot close terminal.
- [x] Wrong user cannot attach websocket.
- [x] Codex broker read-only operation works.
- [x] Codex broker mutating operation works with authorization.
- [x] Codex broker mutating operation blocks without authorization.

### Online Tests

- [x] Online auth attaches actor to relevant terminal routes.
- [x] Client body cannot spoof `vibe64User`.
- [x] User A and user B use different GitHub provider homes.
- [x] User B cannot attach to user A terminal.
- [x] Codex turn actor is recorded from authenticated request.
- [x] Broker operation uses recorded actor.
- [x] Broker rejects mismatched/stale turn.
- [x] No online deployment or tenant concepts appear in shared Vibe64 code.

### Local Tests

- [x] No `vibe64User` required.
- [x] Local provider home used consistently.
- [x] Local shell/command/project-tool terminals continue to work.
- [x] Local Codex broker operations work.

## Phase 20: Manual Verification

- [x] In local Vibe64:
  - [x] connect local GitHub.
  - [x] open shell terminal.
  - [x] run `gh auth status`.
  - [x] confirm local GitHub identity.
  - [x] run command workflow commit/push.
  - [x] run project tool that uses GitHub.
  - [x] run Codex broker read-only operation.
  - Verified 2026-06-22 with a disposable local project at `/tmp/vibe64-gh-local-check`: `/api/app/vibe64-gh-local-check/vibe64/accounts` reported local GitHub connected as `mercmobily`, a real session `2026-06-22_09-58-40` was created, a project-root shell terminal started with `ownerScope: local` and GitHub provider source `/home/merc/.local/share/vibe64-local-editor/provider-homes/github/local`, `gh auth status` inside the terminal reported `mercmobily`, the terminal closed with `{ ok: true, closed: true }`, and no matching Docker container remained. The temp project and local server were removed after verification.
  - Verified 2026-06-22 with disposable local project `/tmp/vibe64-gh-command-workflow-check`: created a real Vibe64 session `manual_command_workflow_check` at the `changes_committed` step, started the real `commit_changes` command terminal with local GitHub provider source `/home/merc/.local/share/vibe64-local-editor/provider-homes/github/local`, and used a bare origin under the temp project root. The terminal exited `0`, lifecycle finished as `done` with outcome `completed`, metadata recorded `accepted_commit=c5170b671c0e24144495ea8c5217d83697977c84`, `branch_pushed=vibe64/manual-command-workflow-check`, and `branch_push_remote=origin`, and the bare remote branch resolved to the same commit as the worktree HEAD. The temp project was removed and no matching Docker container remained.
  - Verified 2026-06-22 with disposable project `/tmp/vibe64-gh-projecttool-check`: cloned `https://github.com/mobily-enterprises/vibe64.git`, ran project tool `sync_main_with_main` through `/api/app/vibe64-gh-projecttool-check/vibe64/tools/sync_main_with_main/run`, observed `terminalKind: "project-tool"` with GitHub provider source `/home/merc/.local/share/vibe64-local-editor/provider-homes/github/local`, and the terminal exited `0` after `git fetch origin main` / `git pull --ff-only origin main` from GitHub.
  - Verified 2026-06-22 with disposable project `/tmp/vibe64-gh-command-check`: created a real session `2026-06-22_10-04-34`, ran the `create_worktree` command terminal with local GitHub provider metadata, then exercised the read-only GitHub broker route with synthetic current-turn actor metadata using `operation: "git_status"` and `turnId: "manual-turn-local-check"`. The broker returned `{ ok: true, operation: "git_status", exitCode: 0 }` and logged `vibe64.github_broker.operation_finished`. This proves broker execution/logging with recorded actor metadata, but it was not a nested Codex-authored prompt.
- [x] In online:
  - [x] log in as user A.
  - [x] open shell terminal.
  - [x] run `gh auth status`.
  - [x] confirm user A identity.
  - [x] log in as user B.
  - [x] open same project/session if allowed.
  - [x] confirm user B gets user B identity in newly opened user-owned terminal.
  - [x] confirm user B cannot attach to user A terminal.
  - [x] ask Codex to commit and push after explicit request.
  - [x] confirm broker uses user who sent the turn.
  - [x] confirm Codex app-server itself does not have user GitHub credentials.
  - Retested 2026-06-22 after deploying `vibe64-online` commit `c822f38` with public Vibe64 commit `1342e38`: login worked, dashboard loaded, Publish link was visible, `/api/app/beepollen/vibe64/accounts` reported user-scoped GitHub connected as `mercmobily`, an authenticated project-scoped worktree shell started with owner `tonymobily@gmail.com`, `gh auth status` reported `mercmobily`, and the shell closed successfully. Codex app-server containers reported no logged-in GitHub hosts.
  - Retested 2026-06-22 after deploying `vibe64-online` commit `edcf485` with public Vibe64 commit `355e090`: Tony and Chiara both reached the project-scoped beepollen session route, `/api/app/beepollen/vibe64/accounts` reported Tony's user-scoped GitHub identity as `mercmobily` and Chiara's as `chiaramobily`, separate worktree shell terminals were created with terminal owners `tonymobily@gmail.com` and `chiaramobily@gmail.com`, `gh auth status` inside each terminal reported the matching GitHub account, Chiara's read/write attempts against Tony's terminal returned HTTP `403` with `code: "vibe64_terminal_owner_mismatch"`, both terminals closed cleanly, no matching Docker shell/terminal containers remained, and `vibe64@mercmobily.service` stayed active with `NRestarts=0`.
  - Retested 2026-06-22 after deploying `vibe64-online` commit `33fafc2` with public Vibe64 commit `f72f744`: created disposable beepollen session `2026-06-22_11-14-22`, ran real `create_worktree` and `install_dependencies` command terminals, routed a Codex prompt that explicitly authorized `commit_and_push`, confirmed the app-server helper existed inside the container at `/studio-attachments/.vibe64-github-broker/e86340038f4bc1be/vibe64-github-broker.mjs`, confirmed the socket existed in the same mounted root, confirmed the host files existed under `/srv/vibe64/tenants/mercmobily/state/attachments/.vibe64-github-broker/e86340038f4bc1be`, and confirmed `node "$VIBE64_GITHUB_BROKER_HELPER" --list` worked inside the deployed container. Codex committed and pushed branch `vibe64/2026-06-22_11-14-22` with short commit `82a5886`; the broker operation finished with `ok: true`, `exitCode: 0`, actor `tonymobily@gmail.com`, target root `/srv/vibe64/tenants/mercmobily/projects/beepollen`, and worktree `/srv/vibe64/tenants/mercmobily/projects/beepollen/.vibe64-local/sessions/active/2026-06-22_11-14-22/worktree`. The disposable session was abandoned after verification.
- [x] Verify logs:
  - [x] owner checks logged.
  - [x] broker operations logged.
  - [x] no tokens printed.
  - [x] failures visible and not silenced.
  - Verified 2026-06-22: remote `journalctl -u vibe64@mercmobily.service` showed the expected `vibe64.github_provider_home.resolved` entry for Tony's online shell terminal without secrets, a remote token-pattern grep for `gho_`, `github_pat_`, `GH_TOKEN`, and `GITHUB_TOKEN` returned no matches, and local server output showed the earlier schema validation error plus the local provider-home resolution log instead of hiding those events. Owner-mismatch and broker-success logs still need manual live exercise.
  - Verified 2026-06-22: local server output showed `vibe64.github_broker.operation_finished` for the disposable `git_status` broker operation with actor scope `local`, operation `git_status`, turn id `manual-turn-local-check`, and no secret values.
  - Verified 2026-06-22: remote `journalctl -u vibe64@mercmobily.service` showed `vibe64.terminal.owner_denied` for both `read` and `write-text`, with expected owner `tonymobily@gmail.com`, observed owner `chiaramobily@gmail.com`, terminal namespace `vibe64-shell:project:beepollen:2026-06-21_08-54-03`, and `statusCode: 403`. The same post-deploy log window contained no `EPIPE`, uncaught exception, or unhandled-error entries.
  - Verified 2026-06-22: remote `journalctl -u vibe64@mercmobily.service` showed broker operations from the live Codex app-server test, including successful `current_branch`, `git_status`, `git_diff_summary`, and `commit_and_push` entries with actor `tonymobily@gmail.com`, thread `019eef0a-2837-7003-979f-ad1c9956edd8`, turn `019eef0b-1c5a-7da0-bf90-604593c2a872`, and no token values. One earlier malformed `commit_and_push` attempt logged `vibe64_github_actor_turn_mismatch`, which remained visible and did not get silenced; Codex retried with the correct context and the later broker mutation succeeded.

## Phase 21: Rollout Order

- [x] Implement shared provider-home actor helper first.
- [x] Implement terminal owner metadata and owner checks second.
- [x] Convert command terminal to use shared helper and owner checks.
- [x] Convert shell terminal.
- [x] Convert project tool terminals.
- [x] Review setup doctor.
- [x] Add online actor wiring for any missing routes.
- [x] Add local mode tests.
- [x] Add online mode tests.
- [x] Add broker service without Codex helper.
- [x] Add broker helper and Codex instructions.
- [x] Add confirmation policy.
- [x] Run full terminal/account test suites.
  - Verified with the broad server suite using `node --test --test-concurrency=1 ...`; a parallel run still exposes an existing cross-file global-state flake in the Codex reconciliation test.
- [x] Deploy to staging/remote.
- [x] Manually verify with two online users.
- [x] Considered enabling broker mutating operations by default after live verification; kept the safer current-turn authorization policy instead of enabling unrestricted mutating operations.

## Open Design Decisions

- [x] Should shell terminals use the GitHub provider home as the entire `HOME` for v1, matching command terminals?
- [x] Should we implement composed terminal homes immediately or as follow-up?
- [x] What is the exact current-turn authorization signal for mutating broker operations?
- [x] Should mutating broker operations always require UI confirmation, even when user text explicitly requested them?
  - Decision: no. A conservative current-turn prompt match authorizes exactly one mutating broker operation for that turn; otherwise the broker returns `vibe64_github_confirmation_required`.
- [x] How long should Codex turn actor metadata remain valid?
  - Decision: one hour, with additional active/recent Codex turn validation before the broker runs anything.
- [x] Should old ownerless terminals be closed immediately in online mode?
  - Decision: no immediate forced close. Online mode denies ownerless terminal access and tells the user to restart; local mode allows the compatibility path with warnings.
- [x] Should Fix Codex ever receive actor-owned GitHub access directly, or always use broker?
  - Decision: Fix Codex does not receive ambient actor-owned GitHub credentials; GitHub operations go through the broker.

## Definition Of Done

- [x] Base/local Vibe64 uses shared GitHub actor execution with local provider home.
- [x] vibe64-online uses shared GitHub actor execution with per-user provider homes.
- [x] Shell terminal `gh` is user-scoped in online.
- [x] Command workflow terminal `gh` is user-scoped in online.
- [x] Project tool terminal `gh` is user-scoped in online.
- [x] Setup doctor GitHub terminals are verified actor-scoped.
- [x] Wrong online user cannot attach to another user's GitHub-capable terminal.
- [x] Codex app-server never receives user GitHub credentials.
- [x] Codex can perform GitHub operations only through the broker.
- [x] Broker uses recorded turn actor, not Codex-provided identity.
- [x] Runtime app/launch containers do not receive GitHub credentials.
- [x] Logs expose failures and cleanup events without secrets.
- [x] Shared Vibe64 contains the reusable mechanism.
- [x] `vibe64-online` contains only identity/access wiring.
- [x] Tests cover local mode, online user mode, terminal ownership, broker authorization, and redaction.
