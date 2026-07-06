# Vibe64 Inside Vibe64

## Goal

Vibe64 should be able to open and develop the Vibe64 source tree as a normal Vibe64 project. This is the dogfooding path: use Vibe64 to work on Vibe64 without containers, without Docker-in-Docker, and without a second hidden deployment model.

Nix makes this practical because the inner Vibe64 can use the same pinned runtime binaries as any other project. Vibe64 remains responsible for roots, sessions, service lifecycle, previews, permissions, and project selection.

## User Experience

The user opens the Vibe64 repository in the outer Vibe64 instance.

Vibe64 detects that the selected project is Vibe64 itself and allows a self-development launch when the adapter confirms the target is safe. The launch behaves like an ordinary JSKIT/Vibe64 app launch from the user's point of view:

- dependencies are installed through the selected Vibe64/Nix runtime
- the inner Vibe64 starts on its own HTTP port
- the inner Vibe64 shows the same project catalog as the outer Vibe64
- the inner Vibe64 can open ordinary projects and run normal workflows
- the inner Vibe64 cannot start a third nested Vibe64 self-development instance

The intended limitation for V0 is one nesting level:

```text
outer Vibe64 -> inner Vibe64
```

This is allowed:

```text
outer Vibe64 -> inner Vibe64 -> ordinary project
```

This is not allowed:

```text
outer Vibe64 -> inner Vibe64 -> third Vibe64
```

## Root Model

The inner Vibe64 must share project catalog/source visibility with the outer Vibe64, but it must not share operational runtime state.

Shared:

```text
VIBE64_PROJECTS_ROOT
```

Isolated for the inner Vibe64:

```text
VIBE64_SYSTEM_ROOT
VIBE64_SERVICE_DATA_ROOT
VIBE64_RUNTIME_NAMESPACE
HTTP port
preview/proxy port range
session runtime state
attachments state
managed service state
```

This is the key split:

```text
project catalog/source truth is shared
runtime/session/service truth is isolated
```

## Example Local Shape

Outer Vibe64:

```text
VIBE64_PROJECTS_ROOT=/home/merc/vibe64-local-vps/projects
VIBE64_SYSTEM_ROOT=/home/merc/.local/state/vibe64
VIBE64_SERVICE_DATA_ROOT=/home/merc/.local/state/vibe64/services
PORT=3001
```

Inner Vibe64:

```text
VIBE64_PROJECTS_ROOT=/home/merc/vibe64-local-vps/projects
VIBE64_SYSTEM_ROOT=/home/merc/.local/state/vibe64-self/inner
VIBE64_SERVICE_DATA_ROOT=/home/merc/.local/state/vibe64-self/inner/services
PORT=3011
VIBE64_SELF_TARGET_SYSTEM_ROOT=1
```

The exact local paths can vary, but the relationship must not:

- `VIBE64_PROJECTS_ROOT` is the same
- `VIBE64_SYSTEM_ROOT` is different
- `VIBE64_SERVICE_DATA_ROOT` is different
- ports are different

## Example Online Shape

For a normal one-host-per-customer online instance:

Outer Vibe64:

```text
VIBE64_PROJECTS_ROOT=/var/lib/vibe64/<tenant>/projects
VIBE64_SYSTEM_ROOT=/home/v64d_<tenant>/.local/state/vibe64
VIBE64_SERVICE_DATA_ROOT=/var/lib/vibe64/<tenant>/services
```

Inner Vibe64:

```text
VIBE64_PROJECTS_ROOT=/var/lib/vibe64/<tenant>/projects
VIBE64_SYSTEM_ROOT=/home/v64d_<tenant>/.local/state/vibe64-self/inner
VIBE64_SERVICE_DATA_ROOT=/home/v64d_<tenant>/.local/state/vibe64-self/inner/services
VIBE64_SELF_TARGET_SYSTEM_ROOT=1
```

The inner service root may also be under a tenant-owned service namespace if the host model wants all service data under `/var/lib/vibe64/<tenant>/services`. The invariant is that the inner service root is not the same directory as the outer service root.

## Why Projects Root Is Shared

Sharing `VIBE64_PROJECTS_ROOT` is intentional. It lets the inner Vibe64 see the same managed project catalog and source paths as the outer Vibe64.

This is what makes self-development useful. When debugging Vibe64 inside Vibe64, the inner instance can reproduce the same project selection and catalog behavior instead of creating a separate test universe with different paths.

The shared projects root must not imply shared sessions or service state. Project catalog/source visibility is shared; runtime ownership is not.

## Why System Root Is Isolated

`VIBE64_SYSTEM_ROOT` contains operational Vibe64 state:

- sessions
- terminal/runtime bookkeeping
- preview auth state
- attachments
- internal daemon/app state

If the inner Vibe64 shared the outer system root, it could read or mutate the parent's sessions and runtime state. That would make debugging ambiguous and could corrupt the parent instance.

The inner Vibe64 must therefore get its own system root.

## Why Service Data Root Is Isolated

`VIBE64_SERVICE_DATA_ROOT` contains durable managed service data:

- MySQL/MariaDB data directories
- Postgres data directories
- Redis or other future service data
- service metadata/secrets
- service pid/socket/log directories, unless those are moved to a runtime directory

The inner Vibe64 must not use the outer service root. Otherwise, a dev launch of the inner Vibe64 could start, stop, migrate, or reconfigure services owned by the parent instance.

For the no-container/Nix model, this matters even more because service processes are normal host processes. Directory ownership and pid/socket metadata are the isolation boundary.

## One-Level Nesting Rule

When `VIBE64_SELF_TARGET_SYSTEM_ROOT=1` is present, the running Vibe64 instance is already an inner self-development instance.

That instance should not offer or run another Vibe64 self-target launch.

The intended rule is:

```text
if VIBE64_SELF_TARGET_SYSTEM_ROOT is truthy:
  disable Vibe64 self-target launch
```

The inner Vibe64 may still open and work on ordinary projects.

This avoids:

- recursive root naming
- recursive port allocation
- ambiguous session ownership
- parent/child/grandchild service collisions
- confusing project selection behavior

## Adapter Policy

Self-development is adapter-owned policy.

The adapter decides whether a target can be run as a Vibe64 self-target. For JSKIT/Vibe64, this is allowed when the selected target is the Vibe64 repository root and the project shape is recognized as Vibe64.

The adapter setup doctor should block unsafe self-targeting:

- arbitrary subdirectories of the Vibe64 repo
- targets that share the Studio repo but are not the repo root
- adapters that do not explicitly allow self-targeting
- nested self-target attempts from an already self-targeted inner Vibe64

## Runtime Contract

The self-target launch should set:

```text
VIBE64_PROJECTS_ROOT=<outer projects root>
VIBE64_SYSTEM_ROOT=<inner isolated system root>
VIBE64_SERVICE_DATA_ROOT=<inner isolated service root>
VIBE64_SELF_TARGET_SYSTEM_ROOT=1
VIBE64_RUNTIME_NAMESPACE=<current namespace>
```

It should also allocate a distinct app port and preview/proxy port range.

The launch metadata should make the mode visible, for example:

```text
Vibe64 self-target: shared projects with isolated Studio state
```

## Nix Contract

Nix supplies the binaries for the inner Vibe64 runtime. It does not define ownership or state layout.

Vibe64 owns:

- which packages/versions are selected
- where runtime state lives
- where managed services store data
- how sessions are created
- which ports are allocated
- which self-target launches are allowed

Nix owns:

- deterministic Node/npm binaries
- deterministic database binaries
- deterministic PHP/Composer or other future toolchains

The inner Vibe64 should not rely on globally installed project runtimes except for hard host requirements such as `codex`, `opencode`, `git`, `rg`, and `bwrap`.

## Implementation Checklist

- Keep `VIBE64_PROJECTS_ROOT` shared for self-target launches.
- Set an isolated `VIBE64_SYSTEM_ROOT` for the inner launch.
- Set an isolated `VIBE64_SERVICE_DATA_ROOT` for the inner launch.
- Preserve the current runtime namespace.
- Allocate distinct app and preview/proxy ports.
- Mark the inner launch with `VIBE64_SELF_TARGET_SYSTEM_ROOT=1`.
- Disable further Vibe64 self-target launch when `VIBE64_SELF_TARGET_SYSTEM_ROOT` is truthy.
- Keep ordinary project workflows available inside the inner Vibe64.
- Make setup doctor explain the self-target state clearly.
- Test the self-target launch env, metadata, and one-level nesting guard.

## Acceptance Criteria

A working Vibe64-inside-Vibe64 setup must satisfy:

- the outer and inner Vibe64 show the same project catalog
- the outer and inner Vibe64 have different system roots
- the outer and inner Vibe64 have different service data roots
- the inner Vibe64 can open and work on ordinary projects
- the inner Vibe64 cannot start a third self-targeted Vibe64
- managed services started by the inner Vibe64 do not touch outer service data
- sessions created by the inner Vibe64 do not appear as outer-owned sessions
- the app can be run without containers
- required runtime binaries come from the selected Nix runtime
