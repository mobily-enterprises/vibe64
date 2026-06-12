# Local Editor Mode TODO

This file captures the current decisions and implementation notes for restoring Vibe64's original local-editor workflow while keeping the hosted workflow clean.

## Goal

Support running Vibe64 directly against a local folder:

```bash
vibe64 .
vibe64 /path/to/project
```

In this mode, Vibe64 opens that directory as the project target directly. It bypasses Vibe64/Supabase tenant login and hosted billing concerns, but it still uses the normal GitHub and AI-provider accounts.

## Current Code Reality

- `server.js` already accepts `options.targetRoot` and passes it into `configureStudioProjectContext({ explicitTargetRoot })`.
- Lower project/session/runtime layers already understand `targetRoot`.
- Project state now uses the target directory directly: shared state in `<target>/.vibe64` and private runtime state in `<target>/.vibe64-local`.
- `bin/server.js` currently parses a positional argument as a managed project slug through `normalizeProjectSlug()`, so `vibe64 .` does not currently mean "open this folder".
- `src/App.vue` wraps the app in `Vibe64AuthGate`.
- `src/components/auth/Vibe64AuthGate.vue` currently assumes Supabase/Vibe64 auth and then checks setup prerequisites.
- `server/lib/auth/index.js` currently uses Supabase-backed auth and rejects unauthenticated API calls through `registerVibe64AuthGate()`.
- `src/components/manage/Vibe64ManagementPage.vue` hardcodes hosted-style management tabs: Projects, Studio setup, AI Accounts, Users.
- Billing is not implemented yet. There is no current billing system to disable.

## Runtime Modes

Introduce an explicit runtime profile instead of scattered conditionals:

```txt
mode: hosted | local
authRequired: true | false
billingEnabled: false
managedProjectsEnabled: true | false
tenantUsersEnabled: true | false
projectAccessManagementEnabled: true | false
singleTargetRoot: string
```

Hosted mode:

```txt
Supabase/Vibe64 login required
tenant/project membership enforced
managed projects root enabled
tenant user invites enabled
GitHub required
Codex/AI provider required when needed
future billing enabled
```

Local mode:

```txt
Supabase/Vibe64 login bypassed
synthetic local owner user
billing disabled
full entitlements
single targetRoot from CLI directory
managed project catalog disabled or reduced
tenant user invites disabled
GitHub still required
Codex/AI provider still required when needed
```

## Billing Decision

Billing is currently out of scope and not implemented.

Future billing should run on a separate host, for example:

```txt
billing.vibe64.dev
```

The hosted Vibe64 runtime should ask that service for tenant entitlements and usage decisions. The local editor runtime should never call it.

"Billing disabled" means:

```txt
Do not contact billing.vibe64.dev.
Do not load hosted entitlement limits.
Do not record billable usage.
Do not block features based on plans or subscriptions.
Use full local entitlements.
```

Local mode should have 100 percent product entitlements. The only limits that still make sense are machine safety limits, such as process count, disk guardrails, or max concurrent local sessions.

## GitHub Decision

GitHub remains required in local mode.

Reason: GitHub is part of Vibe64's development contract, not just hosted access control. It handles identity, commits, branches, pull requests, merge flow, recovery, and auditability.

Correct split:

```txt
hosted mode:
  require Vibe64/Supabase user
  require tenant/project membership
  require GitHub identity

local mode:
  synthesize local Vibe64 owner
  skip tenant/project membership
  still require GitHub identity
```

Local mode bypasses Vibe64 tenancy login. It does not bypass GitHub setup.

## CLI Behavior

Desired behavior:

```bash
vibe64 .
vibe64 /path/to/project
```

Those commands should:

- resolve the path to an absolute directory
- validate that it exists, is readable, and is writable
- start Vibe64 in local mode
- pass the directory as `targetRoot`
- open the browser directly to that local project

Managed project opening should be explicit if we keep it:

```bash
vibe64 --project beepollen
```

This avoids ambiguity between filesystem paths and managed project slugs.

## Auth Behavior

Local mode should not poke holes through every route. It should provide a local auth service/profile.

Server-side:

- `/api/auth/state` returns `authenticated: true`
- `authProvider` is `"local"`
- `user` is a synthetic local owner
- `request.vibe64User` is attached by the auth gate for protected routes
- GitHub prerequisite checks still run after the synthetic local user exists

Client-side:

- `Vibe64AuthGate` should treat local auth state as authenticated
- it should not show Supabase login screens
- it should still show prerequisite setup when GitHub or required AI accounts are missing
- account UI should not offer hosted-only account actions in local mode

## Project Behavior

Local mode should operate on exactly one target project: the CLI directory.

Open question for implementation: the URL slug can be derived from the folder basename, but the server must not use that slug to resolve the project root. The authoritative target is the explicit `targetRoot`.

State should not use an external state registry. Vibe64 stores local project state in the target itself: shared configuration under `.vibe64` and private runtime/session state under `.vibe64-local`.

See [Technical reference](docs/site/dev/technical-reference.md) for the full managed-mode and local-editor directory contract.

## Management UI

Keep a management area, but make visible sections mode/capability-driven.

Hosted management:

```txt
Projects
Studio setup
AI Accounts
Users
```

Local management:

```txt
Local project
Studio setup
AI Accounts
```

Hosted-only UI in local mode:

- tenant user invites
- Supabase user list
- project access management for tenant users
- add managed project from GitHub repository

Useful local UI:

- current local project path
- GitHub repository/branch status
- Studio setup checks
- AI account setup
- open/reopen local project

## Security Rule

No-auth local mode must bind to localhost by default.

If local mode is requested while binding to a public interface such as `0.0.0.0`, the server should refuse to start unless there is a deliberately scary unsafe flag. Local mode must not accidentally become an unauthenticated public server.

## Implementation Steps

1. Add runtime profile resolution in server startup.
2. Change CLI parsing so a positional directory starts local mode with `targetRoot`.
3. Add explicit managed-project CLI syntax if needed, such as `--project <slug>`.
4. Add local auth behavior that returns a synthetic local owner.
5. Make server auth gate consume the runtime profile and attach the local user in local mode.
6. Keep GitHub prerequisite checks active in local mode.
7. Make the client auth gate understand local authenticated state.
8. Route local mode directly to the local project view.
9. Make management tabs/actions capability-driven.
10. Hide hosted-only invite/user/project-access UI in local mode.
11. Add tests for hosted behavior to ensure it remains unchanged.
12. Add tests for local mode CLI path parsing, auth state, GitHub prerequisite behavior, and single-target project routing.

## Verification Needed

At minimum:

- `vibe64 .` opens the current folder as the project target.
- `vibe64 /absolute/path` opens that folder as the project target.
- local mode does not show Supabase login.
- local mode still blocks on missing GitHub identity.
- local mode still blocks on missing Codex/AI provider where required.
- local mode does not show tenant invite/user management UI.
- hosted mode still requires Supabase login.
- hosted mode still uses managed projects.
- hosted mode still shows Users and project access management.
- local mode refuses unsafe public no-auth binding.
