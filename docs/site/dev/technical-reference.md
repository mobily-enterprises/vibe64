---
title: Technical reference
description: Vibe64 local-editor runtime directories, project state, and host runtime naming.
layout: doc
---

# Technical reference

This page defines the operational contracts that should stay stable for Vibe64:
where private daemon state lives, what is shared with a project, what stays
local, and how host runtime paths are formed.

## Local Editor Mode

Vibe64 opens one arbitrary folder directly. The opened folder is the canonical
source root. Source-owned config lives in that folder, while Vibe64-private
system and runtime state goes to the real OS user's state directory:

```text
~/.local/state/vibe64/
  auth/
  projects/
    <slug>-<hash>/
      sessions/
      runtime/
      runtime-config/
  services/
  users/
  logs/
  setup.json

<opened-folder>/
  .git/
  vibe64.project.json
  vibe64.runtime-lock.json
  .vibe64/
    scripts/
    prompts/
    project-knowledge/
  app source...
```

GitHub and Codex credentials are not stored under Vibe64 private state. They
live in the real OS home directory of the acting user or daemon owner.

## Project State

Every Vibe64 target separates source-owned config from Vibe64-owned runtime
state.

### Source Project Config

Source config lives in the active source tree:

```text
<project>/
  vibe64.project.json
  vibe64.runtime-lock.json
  .vibe64/
    scripts/
    prompts/
    project-knowledge/
```

This state describes how Vibe64 should inspect and operate on the source. It is
ordinary repository content: config UI saves are file edits, they show in Git
diff, and they become durable only through commit, push, pull request, and
merge.

`vibe64.project.json` contains the project type and adapter config values.
`vibe64.runtime-lock.json` pins the selected runtime packages. The `.vibe64`
directory is limited to project-authored Vibe64 customizations: scripts,
prompts, and project knowledge.

### Vibe64 Runtime State

Local runtime state lives outside the source tree:

```text
~/.local/state/vibe64/projects/<slug>-<hash>/
  sessions/
  runtime/
  runtime-config/
```

Online supplies explicit roots from its launcher. Managed source repositories
and service data are host-visible paths, not hidden runtime volumes. A typical
single-owner online layout is:

```text
/var/lib/vibe64/<owner>/
  projects/
    <project>/
      .git/
      app source...
  services/
    _daemon/
      jskit/
        mariadb/
          data/
    <project>/
      <adapter>/
        <service>/
          data/
```

Sessions, runtime files, runtime config, secrets, domains, publish state,
billing state, auth status markers, starred scripts, and UI preferences are
Vibe64-owned state. They must not be stored in source `.vibe64`.

## Config Lookup

Vibe64 reads source config from root source manifests:

```text
<project>/vibe64.project.json
<project>/vibe64.runtime-lock.json
```

Runtime config values are separate Vibe64-owned state:

```text
<project-runtime-root>/runtime-config/
```

## Root Resolution

Directory policy is centralized in the Vibe64 root resolver. Stores should not
invent their own state paths.

```text
local editor systemRoot   = ~/.local/state/vibe64
serviceDataRoot           = <systemRoot>/services unless explicitly configured
sourceRoot                = active source checkout
sourceContractRoot        = <sourceRoot>
projectRuntimeRoot        = Vibe64-owned runtime root
managedSourceRoot         = /var/lib/vibe64/<owner>/projects by default
projectSessionSourceRoot  = managed source project bucket for Vibe64-created session copies
```

The supported environment overrides are:

```text
VIBE64_SYSTEM_ROOT    explicit editor system state root
VIBE64_SERVICE_DATA_ROOT explicit host service-data root
VIBE64_TARGET_ROOT    explicit target project root
VIBE64_APP_ROOT       Vibe64 application checkout root
```

Normal local editor runs use `~/.local/state/vibe64`. Composed launchers can
pass an explicit system root through their runtime profile; direct CLI runs do
not treat `VIBE64_SYSTEM_ROOT` as a casual state-placement override.

## Application Preview Identity

Launch adapters can opt an application into generic preview identity switching
with `previewAuth: "application-dev"`. The launch metadata may restrict the
identifiers accepted by that application with `previewIdentityTypes`; supported
values are `email`, `login`, and `user-id`.

Vibe64 supplies the launched process with:

```text
VIBE64_PREVIEW_IDENTITY_ENABLED=true
VIBE64_PREVIEW_IDENTITY_SECRET=<random per-launch secret>
```

The application implements `POST /api/dev-auth/preview-identity` and validates
the secret from `x-vibe64-preview-identity-secret`. Login requests use a typed
selector:

```json
{
  "operation": "login-as",
  "selector": {
    "type": "login",
    "value": "merc"
  }
}
```

Logout requests use `{ "operation": "logout" }`. A successful login creates
the application's normal browser session and returns canonical, non-secret
identity fields such as `displayName`, `email`, `login`, `userId`, and
`username`. The application remains responsible for finding an existing user,
rejecting missing or disabled users, and setting or clearing its own cookies.
Vibe64 never creates users or changes their roles or application data.

The endpoint must be disabled unless the enable flag and per-launch secret are
present. It is a development-preview control, not a production sign-in API.

## Host Runtime Naming

Runtime names and directories are deterministic, daemon-scoped, and
project-scoped.

Daemons set `VIBE64_RUNTIME_NAMESPACE` to an instance namespace when multiple
instances share a machine. For namespace `tonymobily` and project `beepollen`,
Vibe64 uses names such as:

```text
daemon runtime bucket    <systemRoot>/runtime/<namespace>
project runtime bucket   <projectRuntimeRoot>/runtime/
service data             <serviceDataRoot>/<project>/<adapter>/<service>/data
daemon service data      <serviceDataRoot>/_daemon/<adapter>/<service>/data
terminal lock/log data   <projectRuntimeRoot>/runtime/terminals/
```

The namespace is sanitized to lowercase host-safe name parts before it appears
in paths, socket names, lock names, or process metadata.

## Cleanup Ownership

Vibe64 cleanup targets Vibe64-owned state roots, lock files, logs, terminal
metadata, and child processes started by the Studio daemon. It does not scan
arbitrary host services or delete unrelated files.

Cleanup should rely on deterministic roots and daemon process identity, not on
ad hoc searches for arbitrary host resources.
