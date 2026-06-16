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

## Published app deployments

Project publishing is project-scoped and owned by Vibe64, not by a work session.
The project adapter provides a publish plan; the deployment service executes it
and records the release.

```text
<project>/.vibe64-local/deployments/
  public-name.json
  current.json
  domain-bindings/
  releases/
    <release-id>/
      manifest.json
      logs/
        build.log
        migrate.log
        start.log
        health.log
```

`public-name.json` stores the first-come, first-served
`<name>.users.vibe64.dev` name for the project. Names that look official, such
as `billing`, `login`, `support-vibe64`, or `admin-*`, are reserved by the
platform and cannot be used for customer apps.

Each release manifest stores the adapter id, build command, optional migration
command, serve command, health check, runtime service requirements, Docker
container name, restart policy, and routing fields. Phase logs are written into
the release directory before the release is marked published.

Published app containers use the same managed runtime network and runtime
services as preview/launch targets. The deployment service starts the long-lived
release container with Docker restart supervision:

```text
--restart on-failure:5
--log-driver json-file
--log-opt max-size=10m
--log-opt max-file=5
```

That means Docker restarts a crashed published app a bounded number of times and
rotates container logs. Vibe64 also keeps phase logs in the release directory so
build, migration, start, and health-check failures are tied to the release that
caused them.

Vibe64 does not create per-app systemd services. Systemd, if used by a host, is
only responsible for long-lived host infrastructure such as the Vibe64 daemon,
the Caddy edge process, and the deployment router. Individual published apps are
Vibe64/Docker releases.

### Edge routing

DNS sends published-app traffic to the Vibe64 edge. Caddy terminates TLS and
forwards requests to the Vibe64 deployment router. Caddy should not know project
release manifests or app container names.

For the platform namespace:

```text
users.vibe64.dev
*.users.vibe64.dev
```

the DNS zone should point both the base and wildcard host to the Vibe64 edge
server. Customer-selected names are still validated by Vibe64; the wildcard DNS
record only ensures traffic arrives at the edge.

Caddy should use an on-demand TLS `ask` endpoint controlled by Vibe64. The ask
endpoint must return success only for:

- reserved/published `*.users.vibe64.dev` names
- verified custom domain bindings

The current deployment integration endpoints are loopback-only:

```text
GET /api/vibe64/deployments/tls/ask?domain=<hostname>
GET /api/vibe64/deployments/route?host=<hostname>
```

The `tls/ask` endpoint is for Caddy on-demand TLS. It answers from the
deployment registry and returns success only when certificate issuance is
allowed. The `route` endpoint is for the deployment router. It resolves the
request host to the current published release target on the project runtime
network.

Custom domains are aliases to the current release after DNS ownership
verification. Vibe64 records the required TXT record, verifies it from the
Dashboard, then lets Caddy issue the certificate on demand for that verified
host.

For normal custom hosts, users should point traffic at their Vibe64 public
name:

```text
www.customer.com CNAME public-name.users.vibe64.dev
```

Apex domains need provider-specific A/AAAA, ALIAS, ANAME, or flattened CNAME
support pointing at the Vibe64 edge. Vibe64 still requires the TXT ownership
record before the hostname is accepted by the TLS ask endpoint.

### Adapter publish contract

Adapters expose publish behavior with `createPublishPlan(context)`. The plan
contains only stack-specific knowledge:

- `build`: the command required to produce a deployable artifact
- `migrate`: an optional database migration command
- `serve`: the command that runs the built app
- `health`: the HTTP health path and timeout
- `artifacts`: the build output description
- `runtimeServices`: managed services the release needs, such as MariaDB

The adapter does not reserve hostnames, create certificates, route traffic, or
supervise long-running release containers. Those are deployment-service
responsibilities.
