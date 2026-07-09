# Avoid Local Runner Drift

## Context

Vibe64-managed commands must not accidentally succeed because the developer
laptop, tenant VM, or CI host happens to have a usable `node`, `npm`,
`mariadb`, `playwright`, `gh`, or similar tool in its normal system path.

This happened during the `matt/beepollen` incident: local testing did not expose
a missing `node22` runtime declaration because the local machine had `npm`
available. The deployed tenant VM then ran:

```bash
bash -lc 'npm install --foreground-scripts --no-audit --no-fund'
```

and failed with:

```text
bash: line 1: npm: command not found
```

The actual bug was not that `npm` was missing globally. The bug was that the
workflow command reached execution without declaring the Vibe64 runtime pack
that provides `npm`.

## Rejected Approach: Full Whitelist PATH

The first idea was a strict whitelist:

```text
/opt/vibe64/runtime-packs/<declared-runtime>/bin
/opt/vibe64/runtime-packs/base-tools/bin
```

This would catch drift, but it is too hostile for Codex and project tooling.
Agents and scripts expect ordinary Unix tools such as `sed`, `awk`, `find`,
`tar`, `ps`, and other system utilities. Maintaining a complete `base-tools`
pack would become a distraction and a recurring source of false failures.

## Chosen Approach: Managed-Tool Guard Shims

Use a central managed-tool guard directory in every Vibe64-managed execution
environment:

```text
runtime pack bins first
managed-tool guard shims second
normal system PATH after
```

Example:

```text
/opt/vibe64/runtime-packs/node22/bin
/opt/vibe64/runtime-packs/mariadb/bin
/opt/vibe64/runtime-packs/guard-bin
/usr/local/bin
/usr/bin
/bin
```

The guard directory contains wrappers for tools owned by Vibe64 runtime packs:

```text
node
npm
npx
corepack
pnpm
yarn
bun
mariadb
mysql
gh
git
php
composer
playwright
codex
opencode
```

If a command declares `node22`, the real Vibe64 runtime pack wins:

```text
/opt/vibe64/runtime-packs/node22/bin/npm
```

If it forgets to declare `node22`, the guard shim wins before host `npm` and
fails loudly:

```text
Vibe64 runtime error: npm requires runtime node22.
The command did not declare node22, so host npm was blocked.
```

This catches local, CI, and production drift while still allowing ordinary Unix
programs from the host.

## Design Rules

- The execution gateway/runtime path builder owns this behavior centrally.
- Adapters must declare required runtime packs; they must not hand-roll PATH.
- Vibe64-owned tools must come from runtime packs or fail through guard shims.
- Host tools may remain available for ordinary Unix utilities.
- Do not use shell aliases; they are not reliable for subprocesses.
- Do not rely on local machine installs to validate production behavior.
- Local development should be able to enable the same guard behavior so missing
  runtime declarations fail before deployment.

## Practical Test

A Vibe64-managed command that runs:

```bash
bash -lc 'command -v npm && npm --version'
```

must produce one of two outcomes:

1. It declared `node22`, so `command -v npm` resolves under
   `/opt/vibe64/runtime-packs/node22/bin`.
2. It did not declare `node22`, so the guard shim fails with a Vibe64 runtime
   error before any host `npm` can run.

Any third outcome, especially `/usr/bin/npm`, `/usr/local/bin/npm`, `~/.nvm`,
or Homebrew, is a runtime contract bug.
