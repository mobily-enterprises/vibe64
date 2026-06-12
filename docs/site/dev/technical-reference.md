---
title: Technical reference
description: Vibe64 runtime directories, project state, Docker naming, and local-editor versus managed-daemon behavior.
layout: doc
---

# Technical reference

This page defines the operational contracts that should stay stable across
Vibe64 installs: where state lives, what is shared with a project, what stays
local, and how Docker runtime names are formed.

## Runtime modes

Vibe64 has two runtime modes.

### Managed daemon mode

Managed daemon mode is the normal multi-project server mode. A projects root
contains the daemon state and all managed projects:

```text
<projectsRoot>/
  .vibe64-demon/
    auth-sessions/
    provider-homes/
    users/
    logs/
    db-backups/
    setup.json

  beepollen/
    .vibe64/
    .vibe64-local/

  another-project/
    .vibe64/
    .vibe64-local/
```

`<projectsRoot>/.vibe64-demon` is Vibe64 daemon state. It belongs to the
running Vibe64 installation, not to any one project, and it should not be
committed to a project repository.

### Local editor mode

Local editor mode opens one arbitrary folder directly. The opened folder still
gets the normal project-local state layout, but system state goes to a visibly
local-editor-specific data directory:

```text
~/.local/share/vibe64-local-editor/
  auth-sessions/
  provider-homes/
  users/
  logs/
  setup.json

<opened-folder>/
  .vibe64/
  .vibe64-local/
```

The important distinction is that managed daemon state is beside managed
projects, while local-editor system state is in the user's local data directory.

## Project state

Every Vibe64 target has two project-state directories.

### Shared project state

Shared state lives in the project:

```text
<project>/.vibe64/
  project.json
  project_type
  config/
```

This state describes the project. It can be versioned with the project when the
settings should travel with the repository.

### Private local project state

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
missing. Managed project creation also ensures the rule is present.

## Config lookup

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

## Root resolution

Directory policy is centralized in the Vibe64 root resolver. Stores should not
invent their own state paths.

```text
managed daemon systemRoot = <projectsRoot>/.vibe64-demon
local editor systemRoot   = ~/.local/share/vibe64-local-editor
projectSharedRoot         = <targetRoot>/.vibe64
projectLocalRoot          = <targetRoot>/.vibe64-local
```

The supported environment overrides are:

```text
VIBE64_PROJECTS_ROOT  managed projects root
VIBE64_SYSTEM_ROOT    explicit system state root
VIBE64_TARGET_ROOT    explicit target project root
VIBE64_APP_ROOT       Vibe64 application checkout root
```

`VIBE64_SYSTEM_ROOT` is an escape hatch for explicit deployments. Normal managed
daemon runs should use `<projectsRoot>/.vibe64-demon`; normal local editor runs
should use `~/.local/share/vibe64-local-editor`.

## Docker runtime naming

Docker names are deterministic and project-scoped.

For a managed project named `beepollen`, with no runtime namespace:

```text
runtime network          vibe64-beepollen-network
runtime container        vibe64-beepollen-<adapter>-<container>
runtime volume           vibe64_beepollen_<adapter>_<container>_<volume>
JSKIT MariaDB container  vibe64-jskit-mariadb
JSKIT MariaDB volume     vibe64_jskit_mariadb_data
```

The default runtime namespace is empty. That is deliberate: existing Docker
names stay unchanged unless a runtime explicitly opts into namespacing.

When `VIBE64_RUNTIME_NAMESPACE=tonymobily` is set, the same project uses names
such as:

```text
runtime network          vibe64-tonymobily-beepollen-network
runtime container        vibe64-tonymobily-beepollen-<adapter>-<container>
runtime volume           vibe64_tonymobily_beepollen_<adapter>_<container>_<volume>
JSKIT MariaDB container  vibe64-tonymobily-jskit-mariadb
JSKIT MariaDB volume     vibe64_tonymobily_jskit_mariadb_data
```

The namespace is sanitized to lowercase Docker-safe name parts. It is an
explicit deployment/runtime partition; self-targeting Vibe64 does not create a
new project runtime namespace.

## Vibe64 self-targeting

Self-targeting is intentionally narrow. It exists only so the Vibe64 repository
can be opened by Vibe64 itself while still seeing the same managed projects,
provider homes, and project runtime services as the parent Studio.

The JSKIT adapter detects the target package name `vibe64`. When the target is
Vibe64, JSKIT launch targets preserve the current `VIBE64_RUNTIME_NAMESPACE`
and pass shared project roots into the nested Vibe64 process:

```text
outer Studio runtime namespace  ""
inner Studio runtime namespace  ""

outer Studio runtime namespace  tonymobily
inner Studio runtime namespace  tonymobily
```

The inner Studio still receives its own `VIBE64_SYSTEM_ROOT`; auth cookies,
session stores, and terminal runtime state remain isolated from the parent
Studio.

## Docker labels

Vibe64-managed Docker objects use `vibe64.*` labels for cleanup and inspection.
Runtime networks and containers include labels for their kind, target, adapter,
runtime id, and daemon process where applicable.

Cleanup should rely on those labels and deterministic names, not on ad hoc
searches for arbitrary containers.
