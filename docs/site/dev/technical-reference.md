---
title: Technical reference
description: Vibe64 local-editor runtime directories, project state, and Docker naming.
layout: doc
---

# Technical reference

This page defines the operational contracts that should stay stable for the
standalone Vibe64 local editor: where state lives, what is shared with a
project, what stays local, and how Docker runtime names are formed.

## Local Editor Mode

Vibe64 opens one arbitrary folder directly. The opened folder gets the normal
source-owned config layout, while editor-private system and runtime state goes
to the local editor data directory:

```text
~/.local/share/vibe64-local-editor/
  state/
    auth-sessions/
    projects/
      <slug>-<hash>/
        sessions/
        runtime/
        runtime-config/
    users/
    logs/
    setup.json
  provider-homes/
    codex/
    github/
      local/

<opened-folder>/
  .git/
  .vibe64/
  app source...
```

## Project State

Every Vibe64 target separates source-owned config from Vibe64-owned runtime
state.

### Source Project Config

Source config lives in the active source tree:

```text
<project>/.vibe64/
  project_type
  config/
  scripts/
  prompts/
  project-knowledge/
```

This state describes how Vibe64 should inspect and operate on the source. It is
ordinary repository content: config UI saves are file edits, they show in Git
diff, and they become durable only through commit, push, pull request, and
merge.

### Vibe64 Runtime State

Local runtime state lives outside the source tree:

```text
~/.local/share/vibe64-local-editor/state/projects/<slug>-<hash>/
  sessions/
  runtime/
  runtime-config/
```

Online runtime state lives under the online project record root:

```text
/srv/vibe64/tenants/<tenant>/projects/<project>/
  project.json
  sessions/
  deployments/
  git-cache/
  runtime/
  runtime-config/
  projectInfoCache.json
```

`project.json`, sessions, deployments, git cache, runtime files, runtime config,
secrets, domains, publish state, billing state, manual provider credentials,
starred scripts, and UI preferences are Vibe64-owned state. They must not be
stored in source `.vibe64`.

## Config Lookup

Vibe64 reads source config from the active source tree:

```text
<project>/.vibe64/config/
```

Runtime config values are separate Vibe64-owned state:

```text
<project-runtime-root>/runtime-config/
```

## Root Resolution

Directory policy is centralized in the Vibe64 root resolver. Stores should not
invent their own state paths.

```text
local editor base root    = ~/.local/share/vibe64-local-editor
local editor systemRoot   = ~/.local/share/vibe64-local-editor/state
provider homes root       = ~/.local/share/vibe64-local-editor/provider-homes
sourceRoot                = active source checkout
sourceConfigRoot          = <sourceRoot>/.vibe64
projectRuntimeRoot        = Vibe64-owned runtime root
onlineProjectRecordPath   = <online-project-root>/project.json
```

The supported environment overrides are:

```text
VIBE64_SYSTEM_ROOT    explicit editor system state root
VIBE64_TARGET_ROOT    explicit target project root
VIBE64_APP_ROOT       Vibe64 application checkout root
```

`VIBE64_SYSTEM_ROOT` is an escape hatch for explicit local editor state
placement. Normal runs should use
`~/.local/share/vibe64-local-editor/state`.

## Docker Runtime Naming

Docker names are deterministic, tenant-scoped, and project-scoped.

Tenant daemons must set `VIBE64_RUNTIME_NAMESPACE` to the tenant slug. For
tenant `tonymobily` and project `beepollen`, Vibe64 uses names such as:

```text
tenant network           vibe64-tonymobily-tenant-network
runtime network          vibe64-tonymobily-beepollen-network
runtime container        vibe64-tonymobily-beepollen-<adapter>-<container>
runtime volume           vibe64_tonymobily_beepollen_<adapter>_<container>_<volume>
MariaDB container        vibe64-tonymobily-mariadb
MariaDB volume           vibe64_tonymobily_mariadb_data
```

The namespace is required and sanitized to lowercase Docker-safe name parts.

## Docker Labels

Vibe64-managed Docker objects use `vibe64.*` labels for cleanup and inspection.
Runtime networks and containers include labels for their kind, target, adapter,
runtime id, and process where applicable.

Cleanup should rely on those labels and deterministic names, not on ad hoc
searches for arbitrary containers.
