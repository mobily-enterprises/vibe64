# Vibe64 Project Config And Storage Contract

## Philosophy

Vibe64 project configuration must be ordinary source configuration when it
belongs to the project. It should not be hidden in a Vibe64 service database or
in an online-only project folder that pretends to be source.

The core rule is:

```text
Repo/project config lives in the source tree.
Vibe64 runtime and hosting state lives outside the source tree.
```

The project config UI should therefore be a friendly editor for files in the
active source/session, not a separate settings database. If a user changes
Vibe64 project config, the change should appear in the Git diff. To make it
permanent, the user commits, pushes, opens a PR, or merges it like any other
source change.

This removes the old ambiguity where online mode had a local checkout and
configuration meant "write some files into that checkout." That looked simple,
but it was structurally false because the checkout could be stale, unmerged,
not pushed, or different from the session source. Online's permanent source is
the remote Git repository or a materialized session source derived from it.

## Source-Owned Configuration

Portable Vibe64 project facts live under:

```text
<source>/.vibe64/
```

This applies to both local and online:

```text
Local:
  /tmp/ppp/.vibe64/

Online active session:
  /srv/vibe64/tenants/<tenant>/projects/<project>/sessions/active/<session>/source/.vibe64/

Online closed project:
  remote Git repository .vibe64 at the selected revision
```

The source-owned `.vibe64` directory is for project facts that are useful to
anyone opening the repo.

Expected source-owned paths include:

```text
.vibe64/project_type
.vibe64/config/<adapter-bootstrap-field>
.vibe64/scripts/
.vibe64/prompts/
.vibe64/project-knowledge/
```

Examples of source-owned adapter bootstrap fields:

```text
jskit_database_runtime
laravel_database_runtime
nextjs_package_manager
nextjs_seed_language
nextjs_seed_styling
nextjs_seed_linter
nextjs_seed_source_layout
nextjs_seed_bundler
nextjs_seed_import_alias
nextjs_database_runtime
nextjs_data_layer
node_web_client_library
cpp_build_system
cpp_cxx_standard
cpp_build_type
cpp_project_kind
cpp_testing
```

These fields should be edited by changing files in the active source tree.
They should not be silently overwritten in online project state.

## Not Source-Owned

The following must not be stored as repo `.vibe64` project config:

```text
online project record
billing state
custom domains
publish public name
deployment releases/logs/artifacts
runtime environment values
secrets
manual Supabase URL/key
session state
terminal state
UI preferences
starred target scripts
```

`github_pr_merge_method` is currently stored as shared config, but it behaves
more like a Vibe64 workflow preference than a project bootstrap fact. It should
be reviewed before being treated as canonical repo config.

`project.json` is also not source-owned config in the new model. Online needs a
project record, but that is online-owned metadata, not `.vibe64` truth.

## Local CLI Layout

Local mode has the source tree directly available:

```text
/tmp/ppp/
  .git/
  .vibe64/
  app source...
```

Local private Vibe64 state lives outside the source tree:

```text
~/.local/share/vibe64-local-editor/state/projects/<slug>-<hash>/
  sessions/
  runtime/
  runtime-config/
```

Local mode does not need durable project data or `projectInfoCache`. It can
read the current source tree and Git metadata directly.

Provider homes stay outside individual projects:

```text
~/.local/share/vibe64-local-editor/provider-homes/
```

## Online Layout

Online project folders are Vibe64-owned hosting/runtime records, not source
checkouts:

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

Ownership:

```text
project.json
  Online project record: project id/slug, display name, repo URL, selected
  branch, default branch, GitHub permission metadata.

sessions/
  Session state and active materialized source trees.

deployments/
  Publish/release state, release logs, release artifacts.

git-cache/
  Bare remote repository cache used to inspect or materialize source.

runtime/
  Generated runtime/helper files owned by Vibe64 Online.

runtime-config/
  Online-owned runtime config values. This is not repo config.

projectInfoCache.json
  Optional disposable summary for closed projects only.
```

There is no separate `data/`, `local/`, `online-data/`, or
`extra-online-data/` directory in the target model.

## Active Config Editing

The project config UI should be attached to the specific active source/session.
Saving config writes files under that source's `.vibe64`.

Example:

```text
/srv/vibe64/tenants/<tenant>/projects/<project>/sessions/active/<session>/source/.vibe64/project_type
/srv/vibe64/tenants/<tenant>/projects/<project>/sessions/active/<session>/source/.vibe64/config/jskit_database_runtime
```

Those changes are real source changes. They are audited by Git and become
permanent only through the normal Git workflow.

## Initial Setup

If `.vibe64/project_type` does not exist and an online project has no active
source session yet, Vibe64 may store the user's setup answers as a temporary
pending bootstrap payload in the online-owned project record. That payload is
not canonical project config and must not be treated as `.vibe64` truth.

When the seed/source-editing session materializes its source tree, Vibe64 writes
the pending answers into that session source as real `.vibe64` files, then
deletes the temporary bootstrap payload from online-owned metadata.

The user can then review, commit, push, PR, and merge that source change.

## Closed Online Projects

When an online project is closed, there may be no active source tree. Vibe64 may
need lightweight facts for lists, badges, routing, or "can open this?" checks.

For that case only, online may keep:

```text
/srv/vibe64/tenants/<tenant>/projects/<project>/projectInfoCache.json
```

This cache is:

```text
derived from remote Git/source
keyed by inspected branch/commit
disposable
never authoritative
never written as user-selected config truth
```

If the cache is missing or stale, online can refresh it from the bare Git cache
or remote repository. If the project is open, Vibe64 should read the active
source tree directly instead of relying on the cache.

## Implementation Direction

The implementation should stop treating one "project state root" as both source
config and Vibe64 runtime state.

The useful conceptual roots are:

```text
sourceRoot
  App source tree.

sourceConfigRoot
  <sourceRoot>/.vibe64

projectRuntimeRoot
  Local or online Vibe64-owned runtime/session/deployment state.

onlineProjectRecordPath
  Online-only project.json.
```

Current names such as `projectStateRoot` and `projectLocalRoot` should be
reviewed because they hide ownership. If they remain, they should map cleanly to
one concept each and not mix source config with runtime state.

## Code Audit Implementation Status

These were the structural problems found while comparing the old implementation
with this contract. The implementation now uses explicit source/runtime roots
for these areas.

### Resolved: Config Saves Are Source Scoped

Project type/config routes accept an active source target. Catalog project
config writes require an active session source or explicit source path, so
online config saves are real source edits.

Relevant current areas:

```text
packages/vibe64-project/src/server/inputSchemas.js
packages/vibe64-project/src/server/registerRoutes.js
packages/vibe64-project/src/server/service.js
```

### Resolved: Online Layout Uses First-Class Runtime Paths

The catalog layout resolves:

```text
<project>/project.json
<project>/sessions
<project>/deployments
<project>/git-cache
<project>/runtime
<project>/runtime-config
<project>/projectInfoCache.json
```

The resolver and tests are updated together.

Relevant current areas:

```text
packages/vibe64-core/src/server/studioProjectContext.js
packages/vibe64-core/src/server/projectRequestContext.js
tests/server/studioProjectContext.unit.test.js
```

### Resolved: project.json Is Online-Owned Metadata

GitHub project metadata is read from `onlineProjectRecordPath`. Source
`.vibe64/project.json` is not treated as the project record.

Relevant current areas:

```text
packages/vibe64-core/src/server/studioProjectContext.js
packages/vibe64-adapters/src/server/workflowCommandTerminal/worktreeDependencies.js
packages/vibe64-adapters/src/server/workflowCommandTerminal/mergeSync.js
```

### Resolved: targetRoot Is Split Into Source And Runtime Concepts

Runtime context now carries `sourceRoot`, `sourceConfigRoot`,
`projectRuntimeRoot`, and `onlineProjectRecordPath`. App inspection and setup
paths receive a real source root.

Relevant current areas:

```text
packages/project-setup-doctor/src/server/service.js
packages/current-app/src/server/service.js
packages/vibe64-project/src/server/service.js
```

### Resolved: Git Cache Uses Runtime Paths

Clone/merge code uses `projectRuntimeRoot/git-cache/repository.git` and reads
project metadata through `onlineProjectRecordPath`.

Relevant current areas:

```text
packages/vibe64-adapters/src/server/workflowCommandTerminal/worktreeDependencies.js
packages/vibe64-adapters/src/server/workflowCommandTerminal/mergeSync.js
```

### Resolved: Prompt Overrides Are Source-Owned

Prompt overrides load from source `.vibe64/prompts/`.

Relevant current areas:

```text
packages/vibe64-adapters/src/server/promptRenderer.js
tests/server/vibe64PromptRenderer.unit.test.js
```

### Resolved: Starred Scripts Are Runtime-Owned

`starred_scripts` is stored under runtime config, not source `.vibe64/config`.

Relevant current area:

```text
packages/current-app/src/server/service.js
```

### Resolved: Session Source Writes Have Containment Checks

Config writes into session sources verify that the selected source belongs to
the active session and is contained under the expected runtime root.

Relevant current area:

```text
packages/vibe64-core/src/server/sessionSourcePath.js
```

### Resolved: Tests Lock The New Model

Unit and fixture tests now assert source-owned `.vibe64` config, runtime-owned
session/config state, and first-class online project record paths.

## Non-Goals

This plan does not require online to keep a permanent source checkout.

This plan does not require local mode to create a durable project data record.

This plan does not make `projectInfoCache.json` a config store.

This plan does not put secrets, runtime env, publish state, billing, or domains
under `.vibe64`.
