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
project-local state layout, while editor-private system state goes to a local
data directory:

```text
~/.local/share/vibe64-local-editor/
  state/
    auth-sessions/
    users/
    logs/
    setup.json
  provider-homes/
    codex/
    github/
      local/

<opened-folder>/
  .vibe64/
  .vibe64-local/
```

## Project State

Every Vibe64 target has two project-state directories.

### Shared Project State

Shared state lives in the project:

```text
<project>/.vibe64/
  project.json
  project_type
  config/
```

This state describes the project. It can be versioned with the project when the
settings should travel with the repository.

### Private Local Project State

Private state lives beside the shared state:

```text
<project>/.vibe64-local/
  sessions/
  runtime/
  logs/
  preview/
  cache/
  config/
```

`.vibe64-local/` contains session history, worktrees, runtime files, preview
state, local paths, and other machine-specific values. It must be ignored by
Git.

Project setup checks for that ignore rule and offers a repair when it is
missing.

## Config Lookup

Vibe64 reads shared config first and then overlays local config:

```text
<project>/.vibe64/config/
<project>/.vibe64-local/config/
```

Adapters decide the scope of each config field.

Examples:

- Pull request merge method is shared project config.
- Local launch command overrides are local config.
- Absolute local paths are local config.

## Root Resolution

Directory policy is centralized in the Vibe64 root resolver. Stores should not
invent their own state paths.

```text
local editor base root    = ~/.local/share/vibe64-local-editor
local editor systemRoot   = ~/.local/share/vibe64-local-editor/state
provider homes root       = ~/.local/share/vibe64-local-editor/provider-homes
projectSharedRoot         = <targetRoot>/.vibe64
projectLocalRoot          = <targetRoot>/.vibe64-local
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
