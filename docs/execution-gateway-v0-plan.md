# Vibe64 Execution Gateway V0 Plan

## Goal

Create `packages/vibe64-execution` as the single owner of command execution policy.

Core rule:

```js
runVibe64Command(...)
```

is the only approved product-code path for running commands.

Feature packages request execution. They do not assemble execution.

## Non-Goals

- Preserve every existing execution behavior.
- Maintain backwards compatibility for old internal execution APIs.
- Add another wrapper layer while leaving existing policy paths active.
- Keep execution policy spread across terminal, Codex, adapter, preview, and deployment packages.

## Target Package Shape

```text
packages/vibe64-execution/
  package.json
  package.descriptor.mjs

  src/server/
    index.js
    runVibe64Command.js
    request.js
    result.js

    actor/
      resolveActor.js
      userIdentity.js

    env/
      resolveCommandEnv.js
      databaseEnv.js
      credentialEnv.js
      gitEnv.js
      gitIdentityEnv.js
      sharedToolEnv.js

    runtime/
      resolveRuntimePath.js
      browserRuntime.js
      runtimePacks.js

    policy/
      cwdPolicy.js
      gitPolicy.js
      permissionPolicy.js

    engines/
      capture.js
      pty.js
      detached.js
      helperClient.js

  src/host/
    execHelper.js

  tests/
    executionGateway.unit.test.js
    executionInvariants.unit.test.js
```

## Hierarchy

- `runVibe64Command.js` is the only public gateway.
- `actor/` decides who runs the command.
- `env/` decides what environment the command gets.
- `runtime/` decides which tools and PATH the command gets.
- `policy/` decides whether the command is allowed.
- `engines/` decides how the command is executed.
- `host/` contains the privileged helper installed to `/usr/lib/vibe64/vibe64-exec-helper`.

Subfolders are implementation details. Callers import only:

```js
import { runVibe64Command } from "@local/vibe64-execution/server";
```

## Request Contract

```js
await runVibe64Command({
  actor: "daemon" | "owner-user" | "named-user" | "app",
  userKey: "merc",
  purpose: "account" | "terminal" | "codex" | "github" | "source-editor" | "preview" | "adapter" | "deployment" | "setup",
  project,
  session,
  cwd,
  command,
  args,
  stdin,
  mode: "capture" | "pty" | "detached",
  envPolicy: "session" | "project" | "preview" | "auth" | "deployment",
  runtimes: ["node22", "git", "gh", "mysql", "playwright"]
});
```

## Hard Invariants

- [x] Product feature code does not call `spawn`, `execa`, `runHostCommand`, `runHostUserCommand`, or `startTerminalSession` directly.
- [x] Product feature code does not assemble `HOME`, `XDG_*`, or `PATH` directly.
- [x] If `HOME=/home/merc`, the final process uid/gid must belong to `merc`.
- [x] GitHub user-mode commands run as the real GitHub owner user, not the daemon user.
- [x] Codex internal `git` and `gh` calls are transported to the execution gateway.
- [x] DB env is resolved once and is visible consistently to terminals, Codex, preview, adapter commands, and deployment commands.
- [x] Git commit identity is resolved once and is visible consistently to terminals, Codex, workflow commands, adapter commands, and preview setup.
- [x] Missing GitHub authentication must not block local/non-GitHub commits when a Vibe64 fallback Git identity is available.
- [x] GitHub authentication and Git author/committer identity are separate readiness concepts.
- [x] Runtime PATH is resolved once and applied consistently.
- [x] Shared tool cache env is resolved once and applied consistently.
- [x] Every Vibe64-launched command gets `VIBE64_SHARED_CACHE_ROOT`.
- [x] Every Vibe64-launched command gets `PLAYWRIGHT_BROWSERS_PATH`.
- [x] Playwright browsers live in shared cache, not per-user `~/.cache`.
- [x] Helper execution receives normalized execution payloads only.

## Phase 0: Guardrails

- [x] Create a dedicated branch, for example `execution-gateway-v0`.
- [x] Preserve current live hotfix source changes before refactoring.
- [x] Add static bypass tests for direct command execution in product packages.
- [x] Add static bypass tests for `node:child_process` imports in product packages.
- [x] Add static bypass tests for direct `HOME`, `XDG_*`, and `PATH` construction in product packages.
- [x] Define a temporary allowlist for existing bypasses.
- [x] Make the allowlist shrink during migration.
- [x] Document every temporary allowlist entry with the owning phase that removes it.

## Phase 1: Package Skeleton

- [x] Add `packages/vibe64-execution/package.json`.
- [x] Add `packages/vibe64-execution/package.descriptor.mjs`.
- [x] Add `src/server/index.js`.
- [x] Add `src/server/runVibe64Command.js`.
- [x] Add `src/server/request.js`.
- [x] Add `src/server/result.js`.
- [x] Add `src/server/actor/resolveActor.js`.
- [x] Add `src/server/actor/userIdentity.js`.
- [x] Add `src/server/osUserIdentity.js`.
- [x] Add `src/server/env/resolveCommandEnv.js`.
- [x] Add `src/server/env/databaseEnv.js`.
- [x] Add `src/server/env/credentialEnv.js`.
- [x] Add `src/server/env/gitEnv.js`.
- [x] Add `src/server/env/gitIdentityEnv.js`.
- [x] Add `src/server/env/sharedToolEnv.js`.
- [x] Add `src/server/runtime/resolveRuntimePath.js`.
- [x] Add `src/server/runtime/browserRuntime.js`.
- [x] Add `src/server/runtime/runtimePacks.js`.
- [x] Add `src/server/policy/cwdPolicy.js`.
- [x] Add `src/server/policy/gitPolicy.js`.
- [x] Add `src/server/policy/permissionPolicy.js`.
- [x] Add `src/server/engines/capture.js`.
- [x] Add `src/server/engines/pty.js`.
- [x] Add `src/server/engines/detached.js`.
- [x] Add `src/server/engines/helperClient.js`.
- [x] Add `src/host/execHelper.js`.
- [x] Wire the new package into JSKIT/package composition.
- [x] Export the gateway and shared tool env from `src/server/index.js`.

## Phase 2: Normalize Requests And Results

- [x] Normalize actor values.
- [x] Normalize purpose values.
- [x] Normalize mode values.
- [x] Normalize env policy values.
- [x] Normalize runtime names.
- [x] Validate unknown actor/purpose/mode/runtime values.
- [x] Reject caller-provided raw `HOME`, `PATH`, and `XDG_*` policy.
- [x] Define one result shape for capture mode.
- [x] Define one result shape for PTY mode.
- [x] Define one result shape for detached mode.
- [x] Normalize capture `maxBuffer` centrally.
- [x] Add unit tests for invalid requests.
- [x] Add unit tests for result normalization.

## Phase 3: Actor Resolution

- [x] Implement `daemon` actor resolution.
- [x] Implement `owner-user` actor resolution.
- [x] Implement `named-user` actor resolution.
- [x] Implement `app` actor resolution.
- [x] Resolve username, uid, gid, home, and credential scope.
- [x] Fail if a requested real user does not exist.
- [x] Fail if uid/gid cannot be resolved.
- [x] Fail if `HOME` does not match the executing uid for real-user actors.
- [x] Add regression test for the old bad state: daemon uid with `HOME=/home/merc`.
- [x] Add test that GitHub actor `merc` resolves to the OS user `merc`.

## Phase 4: Environment Resolution

- [x] Move project config env resolution behind `resolveCommandEnv`.
- [x] Move runtime config env resolution behind `resolveCommandEnv`.
- [x] Move managed DB env resolution behind `resolveCommandEnv`.
- [x] Canonicalize `DB_*` and MySQL client alias env through `vibe64-execution`.
- [x] Move GitHub credential env resolution behind `resolveCommandEnv`.
- [x] Move GitHub/Codex credential-home resolution into `vibe64-execution`.
- [x] Move OS user identity resolution into `vibe64-execution`.
- [x] Move Git author/committer identity resolution behind `resolveCommandEnv`.
- [x] Move shared tool cache env resolution behind `resolveCommandEnv`.
- [x] Move Codex/opencode env resolution behind `resolveCommandEnv`.
- [x] Move preview env resolution behind `resolveCommandEnv`.
- [x] Support env policies: `session`, `project`, `preview`, `auth`, `deployment`.
- [x] Ensure command env includes actor-correct `HOME`.
- [x] Ensure command env includes actor-correct `USER` and `LOGNAME`.
- [x] Ensure command env includes actor-correct `XDG_CACHE_HOME`.
- [x] Ensure command env includes actor-correct `XDG_CONFIG_HOME`.
- [x] Ensure command env includes actor-correct `XDG_DATA_HOME`.
- [x] Ensure command env includes `VIBE64_SHARED_CACHE_ROOT`.
- [x] Ensure command env includes `PLAYWRIGHT_BROWSERS_PATH`.
- [x] Default `VIBE64_SHARED_CACHE_ROOT` to `/var/cache/vibe64`.
- [x] Default `PLAYWRIGHT_BROWSERS_PATH` to `/var/cache/vibe64/playwright`.
- [x] Ensure command env includes `GIT_AUTHOR_NAME` when a command can create commits.
- [x] Ensure command env includes `GIT_AUTHOR_EMAIL` when a command can create commits.
- [x] Ensure command env includes `GIT_COMMITTER_NAME` when a command can create commits.
- [x] Ensure command env includes `GIT_COMMITTER_EMAIL` when a command can create commits.
- [x] Resolve Git identity from explicit project/session/user config first.
- [x] Resolve Git identity from GitHub identity second when available.
- [x] Resolve Git identity from deterministic Vibe64 fallback last.
- [x] Use `.invalid` email domains for fallback identities.
- [x] Include tenant/workspace and user key in fallback identity generation.
- [x] Do not require GitHub auth for local/non-GitHub repository commits.
- [x] Keep GitHub fetch/push/PR readiness separate from local commit readiness.
- [x] Add test that terminal and Codex see identical DB env for the same session.
- [x] Add test that preview sees the DB env when launching app servers.
- [x] Add test that adapter commands see runtime config env.
- [x] Add test that deployment commands do not receive session-only secrets by default.
- [x] Add test that terminal and Codex see identical `PLAYWRIGHT_BROWSERS_PATH`.
- [x] Add test that preview and setup doctor see identical `PLAYWRIGHT_BROWSERS_PATH`.
- [x] Add test that a non-GitHub project can commit with fallback identity and no GitHub auth.
- [x] Add test that a GitHub project can create a local commit with fallback identity even when push auth is missing.
- [x] Add test that GitHub push still fails readiness when credentials are missing.

## Git Commit Identity Policy

- [x] Treat Git commit identity as execution environment, not as adapter-specific setup.
- [x] Prefer explicit configured identity:
  - [x] user/project `git.user.name`
  - [x] user/project `git.user.email`
- [x] Then prefer GitHub-derived identity when GitHub account data is available:
  - [x] GitHub display name or login for author name
  - [x] verified/public GitHub email only when available
- [x] Then fall back deterministically:
  - [x] author name: `<userKey> via Vibe64`
  - [x] author email: `<userKey>@<tenant>.users.vibe64.invalid`
  - [x] committer name: `Vibe64`
  - [x] committer email: `vibe64@<tenant>.users.vibe64.invalid`
- [x] Sanitize fallback user and tenant labels before building email addresses.
- [x] Never invent deliverable email addresses.
- [x] Surface fallback status in setup/readiness UI as "using Vibe64 fallback Git identity".
- [x] Do not present fallback identity as a GitHub login.
- [x] Remove one-off `git config user.name Vibe64` and `git config user.email vibe64@example.invalid` snippets from workflow scripts after gateway migration.
- [x] Remove setup doctor blockers that require manual Git identity for non-GitHub/local-only repositories.
- [x] Keep setup doctor blockers for GitHub authentication when a workflow requires remote fetch, push, issue, PR, or merge actions.

## Shared Tool Cache And Browser Policy

- [x] Treat shared tool cache paths as execution environment, not as terminal-specific shell startup.
- [x] Define one exported shared tool env resolver in `vibe64-execution`, conceptually:
  - [x] `VIBE64_SHARED_CACHE_ROOT=${VIBE64_SHARED_CACHE_ROOT:-/var/cache/vibe64}`
  - [x] `PLAYWRIGHT_BROWSERS_PATH=$VIBE64_SHARED_CACHE_ROOT/playwright`
- [x] Keep the shared tool env resolver in `vibe64-execution`, not in `studio-terminal-core`, so terminal, Codex, setup doctor, adapter, preview, and future deployment code all depend on the same execution package.
- [x] Route process env through `runVibe64Command`/`resolveCommandEnv`, not through terminal compatibility helpers.
- [x] Route all terminal, Codex, preview, adapter, setup doctor, verifier, and workflow command env through this resolver.
- [x] `packages/vibe64-terminals/src/server/projectExecutionEnv.js` only loads raw project/runtime env records; it does not own shared tool cache policy.
- [x] `packages/studio-terminal-core/src/server/codexRuntimeContext.js` merges shared tool env into both Codex `runtimeEnv` and `terminalProcessEnv`.
- [x] `packages/studio-terminal-core/src/server/studioToolHome.js` validates gateway-provided tool env instead of exporting `HOME`, `PATH`, or browser cache policy itself.
- [x] Do not duplicate `PLAYWRIGHT_BROWSERS_PATH` string construction in `studioToolHome`, Codex runtime context, terminal environment, adapter scripts, or preview launch code after migration.
- [x] Add one exported shell-startup helper for shared tool env so shells do not reimplement the browser path expression.
- [x] Shared tool env wins over caller request env in `runVibe64Command`.
- [x] Shared tool env wins over project/runtime config env in `runVibe64Command`/`resolveCommandEnv`.
- [x] Host/runtime-pack bootstrap owns the Vibe64 browser installation command.
- [x] Install/create `/var/cache/vibe64/playwright` as root-owned and `vibe64` group-writable with setgid permissions.
- [x] Use an install command equivalent to `install -d -o root -g vibe64 -m 2775 /var/cache/vibe64/playwright`.
- [x] Browser installation is performed once by the metal/runtime-pack installer, not once per tenant and not during app/session execution.
- [x] Install Playwright Chromium into `/var/cache/vibe64/playwright`, not into any user's home directory.
- [x] Use the shared Node/Playwright runtime pack for browser installation.
- [x] Run browser installation from the shared Playwright runtime pack, not from arbitrary project `node_modules`.
- [x] Prefer a host/runtime-pack installer command over `sudo -u v64d_<tenant> npx playwright install chromium`; tenant users should consume the browser cache, not populate it.
- [x] Tenant daemon users can read and execute the installed browser files without taking ownership of the shared cache.
- [x] Do not use `npx playwright install` from arbitrary project directories for host browser bootstrap.
- [x] Install required Chromium system libraries and fonts as part of metal/VM bootstrap.
- [x] Verify browser install with `PLAYWRIGHT_BROWSERS_PATH=/var/cache/vibe64/playwright node -e 'const { chromium } = require("playwright"); console.log(chromium.executablePath())'`.
- [x] Verify Chromium can actually launch, not only that `executablePath()` returns a path.
- [x] Verify the launcher path and launch smoke through the same shared Node/Playwright runtime pack used by Vibe64 commands.
- [x] Setup doctor fails if `PLAYWRIGHT_BROWSERS_PATH` is missing.
- [x] Setup doctor fails if no Chromium or chrome-headless-shell binary exists below `PLAYWRIGHT_BROWSERS_PATH`.
- [x] Setup doctor fails if `PLAYWRIGHT_BROWSERS_PATH` resolves below `/home/`.
- [x] Setup doctor fails if Chromium cannot launch.
- [x] Setup doctor reports the resolved browser executable path.
- [x] Add regression test that host browser bootstrap does not use `npx` or install browsers under `/home/*/.cache`.

## Phase 5: Runtime PATH

- [x] Implement `resolveRuntimePath`.
- [x] Define runtime packs in one place.
- [x] Include Node 22.
- [x] Include Node 20.
- [x] Include Git.
- [x] Include GitHub CLI.
- [x] Include ripgrep.
- [x] Include bubblewrap.
- [x] Include PHP.
- [x] Include Composer.
- [x] Include MariaDB/MySQL tools.
- [x] Include Playwright.
- [x] Include Playwright browser installer/runtime metadata.
- [x] Include operator CLIs.
- [x] Add wrapper/shim path support as execution gateway policy.
- [x] Ensure Codex Git shim precedes real `git`.
- [x] Ensure runtime-pack wrappers do not reorder Vibe64 shim paths.
- [x] Add tests for `node`, `npm`, `git`, `gh`, `mysql`, and `npx` PATH resolution.
- [x] Add tests for Playwright package resolution.
- [x] Add tests for shared Playwright browser cache resolution.
- [x] Gateway owns `NPM_CONFIG_PREFIX` and inserts `$NPM_CONFIG_PREFIX/bin` into PATH after gateway shims and runtime packs.

## Phase 6: Engines

- [x] Implement capture engine.
- [x] Implement PTY engine.
- [x] Implement detached engine.
- [x] Implement helper client engine.
- [x] Move `runHostCommand` behavior into capture engine.
- [x] Move legacy shell command helper implementation into `vibe64-execution`.
- [x] Move low-level `startTerminalSession` primitive under the execution package.
- [x] Move detached process start/log/pid ownership behind detached engine; keep Codex app-server socket/thread reuse metadata in the Codex app-server provider.
- [x] Move helper payload creation into helper client engine.
- [x] Move `/usr/lib/vibe64/vibe64-exec-helper` source to `src/host/execHelper.js`.
- [x] Make helper accept only normalized execution payloads.
- [x] Make helper reject unknown operations.
- [x] Make helper reject cwd outside allowed policy.
- [x] Make helper preserve stdout/stderr correctly for capture commands.
- [x] Add capture tests.
- [x] Add capture `maxBuffer` test.
- [x] Add PTY tests.
- [x] Add detached tests.
- [x] Add helper-client tests.

## Phase 7: Migrate Command Terminal

- [x] Move current-app target script terminal startup to `runVibe64Command({ mode: "pty", purpose: "terminal" })`.
- [x] Replace local host-user/helper branching in `commandTerminal.js`.
- [x] Replace direct command env assembly in command terminal.
- [x] Replace direct `startTerminalSession` calls in command terminal.
- [x] Command terminal uses `runVibe64Command({ mode: "pty", purpose: "terminal" | "github" })`.
- [x] GitHub command-terminal actions use actor resolution, not custom user/home logic.
- [x] Command result file handling remains owned by command workflow, not execution policy.
- [x] Add test that command terminal GitHub commands execute as owner user.
- [x] Add test that command terminal non-GitHub commands execute as daemon/app actor as intended.

## Phase 8: Migrate Launch Preview

- [x] Replace direct `startTerminalSession` calls in `launchTargetTerminal.js`.
- [x] Replace preview env assembly with execution env policy.
- [x] Preview uses `runVibe64Command({ mode: "pty", purpose: "preview" })` because terminal streaming is required.
- [x] Support preview launch env factories, including terminal-id-specific env, under gateway-owned policy env.
- [x] Preserve readiness marker handling.
- [x] Preserve preview proxy lifecycle handling.
- [x] Add test that preview receives the same runtime PATH as terminal.
- [x] Add test that preview receives DB env when needed.
- [x] Add test that preview ready state is emitted immediately after the command is actually reachable.

## Phase 9: Migrate Codex Terminal

- [x] Replace Codex terminal env assembly with execution env policy.
- [x] Replace direct `startTerminalSession` calls for Codex terminal.
- [x] Codex terminal uses `runVibe64Command({ mode: "pty", purpose: "codex" })`.
- [x] Ensure Codex credential home is routed through gateway credential policy, not ordinary caller env.
- [x] Ensure Codex terminal sees DB env.
- [x] Ensure Codex terminal sees GitHub shim env.
- [x] Ensure Codex terminal sees gateway-resolved Git author/committer env.
- [x] Ensure Codex terminal sees shared Playwright browser env.
- [x] Add test that Codex terminal `env` includes DB env.
- [x] Add test that Codex terminal `env` includes fallback Git identity for local/non-GitHub projects.
- [x] Add test that Codex terminal `env` includes `PLAYWRIGHT_BROWSERS_PATH=/var/cache/vibe64/playwright`.
- [x] Add test that Codex terminal `HOME` matches final uid.

## Phase 10: Migrate Codex App-Server

- [x] Replace direct `spawn` in `codexAppServerProvider.js`.
- [x] Codex app-server uses `runVibe64Command({ mode: "detached", purpose: "codex" })`.
- [x] Preserve socket path/liveness checks.
- [x] Preserve auth preflight behavior.
- [x] Preserve app-server log capture.
- [x] Ensure app-server receives GitHub shim env.
- [x] Ensure app-server receives DB env.
- [x] Ensure app-server receives gateway-resolved Git author/committer env.
- [x] Ensure app-server receives shared Playwright browser env.
- [x] Add test that Codex app-server `git ls-remote` uses the gateway.
- [x] Add test that Codex app-server `git commit` does not prompt for identity on non-GitHub projects.
- [x] Add test that Codex app-server Playwright launch uses shared browser cache.
- [x] Add test that app-server is restarted when env fingerprint changes.
- [x] Add test that app-server is restarted when execution context changes.
- [x] Add test that detached Codex app-server-style commands receive fallback Git identity and shared Playwright browser env.

## Phase 11: Migrate Codex Git/GH Shim

- [x] Keep `git`/`gh` shim only as transport.
- [x] Remove server-side Git HOME/XDG policy assembly from Codex Git/GH shim handling.
- [x] Shim sends command, args, cwd, stdin, session id, and token to Vibe64.
- [x] Server side calls `runVibe64Command({ mode: "capture", purpose: "github" })` for GitHub-backed sessions.
- [x] Server side calls `runVibe64Command({ mode: "capture", purpose: "codex" })` for local/non-GitHub sessions.
- [x] Server side resolves GitHub actor from session metadata.
- [x] Server side executes real command as the resolved actor.
- [x] Gateway owns GitHub SSH-to-HTTPS transport env for Codex Git/GH commands.
- [x] Gateway owns Git safe-directory env for Codex Git/GH commands.
- [x] Server side injects gateway-resolved Git author/committer env into real `git`.
- [x] Add test that Codex `git ls-remote` runs as `merc`.
- [x] Add test that Codex `git commit` gets deterministic fallback identity when no GitHub identity exists.
- [x] Add test that Codex `gh auth status` runs as `merc`.
- [x] Add test that non-GitHub sessions cannot call `gh`.

## Phase 12: Migrate GitHub Auth Terminal

- [x] Replace independent GitHub auth terminal execution policy.
- [x] GitHub/Codex account readiness probes use `runVibe64Command({ mode: "capture", purpose: "account", envPolicy: "auth" })`.
- [x] Gateway maps `purpose: "account"` to the `account-status` helper operation instead of GitHub project workflow execution.
- [x] Host helper allows `account-status` commands to run from the credential home.
- [x] GitHub auth terminal uses `runVibe64Command({ mode: "pty", purpose: "github", envPolicy: "auth" })`.
- [x] Ensure auth writes credentials to the correct actor home.
- [x] Ensure post-auth readiness checks use the same actor.
- [x] Add test that successful GitHub auth flips UI readiness without reload.
- [x] Add test that failed auth reports useful output.

## Phase 13: Migrate Adapter Commands

- [x] Adapter command specs describe intent, not execution policy.
- [x] JSKIT adapter commands use execution gateway.
- [x] Node web adapter commands use execution gateway.
- [x] Laravel adapter commands use execution gateway.
- [x] Next/Vinext adapter commands use execution gateway.
- [x] Adapter setup-doctor terminal actions use `runVibe64Command({ mode: "pty", purpose: "setup" })`.
- [x] Remove adapter-level DB env guessing where runtime config owns it.
- [x] Add test that JSKIT install command gets Node and DB env through gateway.
- [x] Add test that adapter commit/setup commands get gateway-resolved Git identity.
- [x] Add test that adapter-generated commands cannot override actor HOME/PATH policy.

## Phase 14: Migrate Deployment And Setup Commands

- [x] Confirm no standalone GitHub deployment token lookup remains in public source; GitHub transport is owned by the gateway.
- [x] Migrate deployment runner commands where appropriate; public source exposes deployment publish plans and the gateway owns deployment command policy.
- [x] Migrate setup doctor host commands where appropriate.
- [x] Migrate core Git probes for committed project config and project remote detection to `runVibe64Command`.
- [x] Migrate Studio setup doctor host checks to `runVibe64Command`.
- [x] Migrate setup doctor plugin terminal actions to `runVibe64Command({ mode: "pty", purpose: "setup" })`.
- [x] Migrate setup doctor Git repair terminals to `runVibe64Command({ mode: "pty", purpose: "setup" })`.
- [x] Migrate setup doctor Git identity checks to the gateway identity policy.
- [x] Migrate setup doctor Playwright/browser checks to shared tool cache policy.
- [x] Migrate account/user helper invocations where appropriate.
- [x] Move host-user helper execution implementation into `vibe64-execution`.
- [x] Move managed source permission helper repair into `vibe64-execution`.
- [x] Document any remaining host tooling exceptions.
- [x] Add tests for deployment GitHub actor execution.
- [x] Add tests that setup commands cannot receive session secrets unless requested.
- [x] Add tests that setup doctor distinguishes local Git identity readiness from GitHub auth readiness.
- [x] Add tests that setup doctor catches missing shared Playwright browsers.

## Phase 15: Delete Old Public Execution Paths

- [x] Stop exporting old public `runHostUserCommand`.
- [x] Stop exporting old public `runHostCommand`.
- [x] Stop exporting direct terminal start from `studio-terminal-core` as a feature-level API.
- [x] Source editor ripgrep search uses `runVibe64Command({ mode: "capture", purpose: "source-editor" })`.
- [x] Remove feature imports of `hostUserExecution.js`.
- [x] Remove feature imports of `shellCommands.js`.
- [x] Remove feature imports of old `terminalEnvironment.js`.
- [x] Remove duplicate GitHub execution paths.
- [x] Remove duplicate Git safe-directory and GitHub transport helper implementations.
- [x] Remove duplicate Git identity fallback snippets.
- [x] Remove duplicate shared tool cache env snippets.
- [x] Remove duplicate `PLAYWRIGHT_BROWSERS_PATH` construction.
- [x] Remove duplicate Codex Git/GH shim `PATH` export from Codex terminal startup.
- [x] Remove duplicate runtime PATH builders.
- [x] Remove duplicate credential-home resolver implementation.
- [x] Make static bypass tests pass with an empty or near-empty allowlist.

## Remaining Host Tooling Exceptions

- [x] `packages/vibe64-execution` may own low-level process creation, PTY sessions, helper calls, and runtime PATH construction.
- [x] Tests may use direct process APIs to exercise fixtures and real subprocess behavior.
- [x] `runtimeToolchain` may still expose Nix command builders for explicit runtime realization and lock metadata, but adapter, preview, setup-doctor, and terminal execution paths must prefer shared runtime packs through `runVibe64Command`.
- [x] Generated command preview strings may show the command users expect to run, but executable product paths must pass through the execution gateway.

## Phase 16: Acceptance Tests

Live tenant acceptance remains intentionally unchecked until the public and online repos are committed, deployed, services are restarted, and tenant smoke checks are run.

- [ ] `git ls-remote origin refs/heads/main` from Codex succeeds as `merc`.
- [ ] `gh auth status` from Codex succeeds as `merc`.
- [ ] `env | sort` from Codex includes DB env for a managed DB project.
- [ ] Configured MySQL command works from Codex.
- [ ] Configured MySQL command works from command terminal.
- [ ] Configured MySQL command works from preview launch.
- [ ] Non-GitHub project commit works without manual `git config`.
- [ ] GitHub project local commit works without manual `git config`.
- [ ] GitHub project push still requires GitHub auth.
- [ ] `env | sort` from Codex includes `PLAYWRIGHT_BROWSERS_PATH=/var/cache/vibe64/playwright`.
- [ ] Playwright Chromium launches from Codex.
- [ ] Playwright Chromium launches from command terminal.
- [ ] Playwright Chromium launches from setup doctor/verifier context.
- [ ] Preview opens without delayed reload mitigation.
- [ ] Command terminal works.
- [ ] Codex terminal works.
- [ ] Codex app-server works.
- [ ] Diff works in migrated GitHub projects.
- [ ] GitHub auth completes and UI turns green without page reload.
- [x] `HOME` uid mismatch test fails as expected.
- [x] Direct spawn bypass test fails if a new bypass is introduced.

## Phase 17: Deploy

- [x] Run focused unit tests for `vibe64-execution`.
- [x] Run terminal/Codex/preview focused unit tests.
- [x] Run adapter focused unit tests.
- [x] Run `npx jskit app verify`.
- [x] Commit public repo changes.
- [x] Update online submodule to the public commit.
- [x] Commit online repo changes.
- [x] Build online release artifact.
- [ ] Deploy from `/home/merc/vibe64/vibe64-online`.
- [ ] Restart tenant services.
- [ ] Smoke `sas/compas-next`.
- [ ] Smoke `sas/dogandgroom`.
- [ ] Smoke `mercmobily/test` or another simple JSKIT project.

## Done Means

- [x] `packages/vibe64-execution` owns all execution policy.
- [x] Terminals, Codex, preview, adapters, setup, and deployment are gateway clients.
- [x] No direct product-feature process spawning remains outside the execution package.
- [x] No direct `HOME`, `XDG_*`, or `PATH` policy assembly remains outside the execution package.
- [x] GitHub user-mode execution consistently runs as the real human user.
- [x] DB env is consistent across terminal, Codex, preview, adapter, and deployment command paths.
- [x] Git author/committer env is consistent across terminal, Codex, preview, adapter, and workflow command paths.
- [x] Local/non-GitHub commits do not prompt agents to invent a one-command Git identity.
- [x] GitHub auth readiness is separate from Git local commit identity readiness.
- [x] Runtime PATH is consistent across command paths.
- [x] Shared tool cache env is consistent across command paths.
- [x] Playwright browser cache is host-installed, shared, and not per-user.
- [x] Setup doctor detects missing or broken shared Chromium immediately.
- [x] The Codex Git/GH shim is transport only.
- [x] Static tests prevent reintroducing the old layered execution paths.
