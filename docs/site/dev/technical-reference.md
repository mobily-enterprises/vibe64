---
title: Technical reference
description: Vibe64 project, runtime, Git, launch, preview, and cleanup ownership.
layout: doc
---

# Technical reference

This page records the operational boundary between the project, Genesis, and
Vibe64. Project knowledge should remain portable. Machine policy, credentials,
and live session state should not leak into the repository.

## Source-owned project files

A Genesis-enabled project has this portable shape:

```text
<project>/
  .git/
  genesis/
    version
    blueprint.md
    engineering.md
    stack.md
    stack/
    program/
      <subsystem>/
        <public-operation>.md
  .agents/
    skills/
  .codex/
    hooks.json
  .opencode/
    plugins/
      genesis-project-guidance.js
  .genesis/
    machine-city.json
    program-city.json
    verification.json
  application source...
```

The files have deliberately different jobs:

- `genesis/version` records the deterministic Genesis project-file format.
- `genesis/blueprint.md` contains non-technical, human product intent.
- `genesis/engineering.md` selects the engineering profile and records any
  project-specific engineering requirements.
- `genesis/stack.md` selects technology components and owns the project's
  composed resources, defaults, environment files, verification commands, and
  consumer-specific operation sections.
- `genesis/stack/` contains optional per-component additions or overrides for
  Description, Guidance, Adoption, Post-change, and Deslop prose.
- `genesis/program/` explains public operations in conceptual subsystem
  directories. It does not mirror source files.
- `.agents/skills/` contains Genesis workflow skills and any authoritative
  technology skill selected by Stack.
- `.codex/hooks.json` contains the project-local Codex lifecycle
  integration installed by Genesis.
- `.opencode/plugins/genesis-project-guidance.js` provides the equivalent
  project operating guide to OpenCode sessions and refreshes it after
  compaction.
- `.genesis/machine-city.json` and `.genesis/program-city.json` are derived
  navigation documents.
- `.genesis/verification.json` is present only after declared checks pass. It
  records exact code and Stack hashes; it is evidence, not a correctness claim.

`genesis init` creates a technology-neutral Genesis project in the current
format. `genesis adopt` preserves an existing implementation and produces the
prompt used to describe it. `genesis migrate` advances a recognized older
format, snapshots its effective operations as project-owned Stack sections,
and refreshes managed skills, lifecycle integration, and indexes. These
operations do not need a Vibe64 project type.

A newly initialized blank project starts chat with the Genesis `start` prompt.
The agent asks what the application is for, records the resulting product intent
in the Blueprint, and then offers compatible Stack choices from the installed
Genesis catalog. Vibe64 does not carry a separate onboarding prompt or choose a
technology on the user's behalf.

## Vibe64-owned runtime state

Local Editor opens one arbitrary folder as canonical source. Private state is
stored outside that source under the real OS user's state directory:

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
```

Online supplies explicit roots from its launcher. A typical single-owner layout
is:

```text
/var/lib/vibe64/<owner>/
  projects/
    <project>/
      .git/
      application source...
  services/
    _daemon/
      <service-owner>/
        <service>/
          data/
    <project>/
      <service-owner>/
        <service>/
          data/
```

Sessions, runtime files, resolved Env values, secrets, domains, publish state,
billing state, auth markers, terminal state, and UI preferences are Vibe64-owned
state. They must not be stored in the source-owned Genesis files.

GitHub and Codex credentials live in the real OS home of the acting user or
daemon owner. Vibe64 owns how those credentials are exposed to its Git and agent
processes. Genesis never reads or stores credential values.

## Updating session work

**Update this session (rebase)** starts a fresh attempt from the current session
files and the latest saved project version. Once the repository write lock is
acquired, the new attempt replaces the previous attempt's status and diagnostics.
Previous conflicts or an abandoned attempt do not determine the new result.
An active repository write must finish before another can start.

If the new merge still conflicts, Vibe64 reports the current conflicting files
and leaves the session's files, branch and index unchanged. **Fix it with AI**
reviews those conflicts; a completed repair automatically checks Update, and
**Check Update** in the repair tab can repeat that check. An explicitly reviewed
resolution can retain unchanged file contents. Review cannot resolve a newer
upstream version or a newly conflicting file without another review.

An ordinary Rebase click starts over instead of submitting the repair tab's
review. Neither action publishes the session's work.

## Root resolution

Directory policy is centralized in the Vibe64 root resolver. Feature packages
must not invent state paths.

```text
local editor systemRoot   = ~/.local/state/vibe64
serviceDataRoot           = <systemRoot>/services unless explicitly configured
sourceRoot                = active source checkout
projectRuntimeRoot        = Vibe64-owned runtime root
managedSourceRoot         = /var/lib/vibe64/<owner>/projects by default
projectSessionSourceRoot  = source bucket for Vibe64-created session copies
```

Supported host overrides are:

```text
VIBE64_SYSTEM_ROOT        explicit editor system-state root
VIBE64_SERVICE_DATA_ROOT explicit host service-data root
VIBE64_TARGET_ROOT        explicit target project root
VIBE64_APP_ROOT           Vibe64 application checkout root
```

Normal Local Editor runs use `~/.local/state/vibe64`. A composed launcher can
provide an explicit system root through its runtime profile; a direct CLI run
does not treat `VIBE64_SYSTEM_ROOT` as a casual state-placement preference.

## Execution ownership

Genesis supplies its own declarations and opaque section transport. Vibe64
owns the operational contracts it consumes and the execution policy.

Genesis owns:

- prompt and focused context generation;
- selected Stack guidance and Agent Skills;
- generic resource declarations;
- argument-safe verification commands;
- exact opaque Stack-section composition without private interpretation;
- Machine and Program City generation.

Vibe64 owns:

- Git repositories, branches, worktrees, credentials, commits, and pushes;
- user Env storage and secret handling;
- strict mechanical parsing of `vibe64.workspace-setup.v1`,
  `vibe64.outputs.v1`, `vibe64.preview-identity.command.v1`, and
  `vibe64.application-deployment.v1`;
- mapping supported runtime requirements to pinned runtime packs;
- terminal, web, and finite process creation, interruption, logs, recovery,
  and cleanup;
- immutable output-result snapshots and authenticated downloads;
- port allocation, readiness, proxying, and preview URLs;
- the exact Playwright and Chromium release available to generated projects.

Vibe64 does not infer a framework output command. If the Stack has no Vibe64
Outputs section, output execution is unavailable with a clear diagnostic. An
unknown runtime requirement is rejected rather than mapped to a similar host
tool.

Workspace setup and Outputs are separate Vibe64 contracts carried in opaque
Stack sections. Vibe64 accepts only their strict Markdown v1 grammars: headings
and list roles provide structure, descriptive labels remain readable, and each
command and argument is a separate backticked value. Outputs declares exact
Prepare, Build, and Run argv for either an interactive terminal/web target or a
finite target with literal downloadable files. Vibe64 runs setup and output
argv through the managed execution gateway and records setup success against
that exact recipe. Merely reading output status never starts setup or a
process. Outputs remain pending until the current setup recipe has succeeded;
a Stack with no setup recipe is simply unconfigured rather than failed.
Component conflicts are reported instead of interleaving competing commands.

## Project environment projection

Genesis Stack components declare resource kinds, environment variable names,
and optional generated environment-file paths. They never supply or inspect
secret values. Local Vibe64 uses the user's project Env; Vibe64 Online may
provision declared MySQL or PostgreSQL resources and supply their values. Other
Genesis hosts can satisfy the same declarations using their own environment
mechanism.

When Stack requests a dotenv projection, Vibe64 writes it deterministically
with mode `0600`. It first protects the generated path and its preserved backup
names in the repository's local `.git/info/exclude`, so secrets are never added
to source history by an ordinary Git operation. An existing user-owned file is
preserved before Vibe64 takes ownership. Symbolic-link paths are rejected.

The browser toolchain is a Vibe64 release contract. Vibe64 exposes its exact
managed Playwright version and browser path; project commands run with browser
downloads disabled. A project must never repair a mismatch by downloading
Chrome or Chromium itself.

## Application preview identity

An optional `previewIdentity` declaration beneath a web-presented Vibe64
Outputs target advertises application identity switching. It names a safe
committed, application-owned project-relative executable such as
`tools/preview-identity`, declares the
`vibe64.preview-identity.command.v1` protocol, and lists the application
identifier types it accepts: email, login, or user ID. It may also declare
app-specific enable and secret environment variable names, command runtime
requirements, and a timeout.

Genesis transports the Outputs section without parsing it. Vibe64 validates the
declaration, maps its runtime requirements to pinned runtime packs, verifies the
executable, and owns command execution, identity selections, secrets, and the
preview browser lifecycle.

Vibe64 stores managed app identities in project-local runtime state, outside
Git and the Genesis files. Each entry contains a Vibe64-facing name plus one
application selector such as email, login, or user ID; the first entry is the
default. Managed Preview and Playwright select a configured entry by name or
request guest mode. Callers cannot submit arbitrary application identities.

For an enabled web output run, Vibe64 supplies `true` and a fresh per-run
secret only through the application-specific environment names declared by
the Vibe64 Outputs contract. These are system output-run values, not
user-managed project Env values. The executable reads one protocol request
from standard input and writes one response to standard output. It remains responsible for
locating an existing user, rejecting missing or disabled users, and creating or
clearing the application's normal browser session. Vibe64 never creates
application users or changes their roles or data.

Any internal endpoint used by that executable must remain disabled unless both
the enable flag and per-run secret are present. This is a development-preview
control, not a production sign-in API.

## Host runtime naming

Runtime names and paths are deterministic, daemon-scoped, and project-scoped.
For namespace `tonymobily` and project `beepollen`, the layout is:

```text
daemon runtime bucket    <systemRoot>/runtime/<namespace>
project runtime bucket   <projectRuntimeRoot>/runtime/
service data             <serviceDataRoot>/<project>/<service-owner>/<service>/data
daemon service data      <serviceDataRoot>/_daemon/<service-owner>/<service>/data
terminal lock/log data   <projectRuntimeRoot>/runtime/terminals/
```

The namespace is sanitized to lowercase host-safe name parts before it appears
in paths, socket names, lock names, or process metadata. `service-owner` is a
stable host-selected storage namespace; it grants no prompt or Stack authority.

## Cleanup ownership

Vibe64 cleanup targets Vibe64-owned state roots, lock files, logs, terminal
metadata, and child processes started by the Studio daemon. It does not scan
arbitrary host services or delete unrelated project files.

Cleanup relies on deterministic roots and daemon process identity, not ad hoc
searches for arbitrary host resources. Source-owned Genesis files change only
through ordinary project work and Git review.
