# Configure connected repositories

People maintain a portable list of repositories they work on alongside a
project. Every session keeps its own copy of each listed repository (see
`genesis/program/source/save-work.md`). Project Settings edits the same source
file as ordinary source editing.

## Sources

- Main: `packages/vibe64-project/src/server/projectSettings.js`
- `packages/vibe64-project/src/server/projectRepositories.js`
- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/connectedProjects.js`
- `packages/vibe64-genesis/src/shared/connectedPackageTypes.js`
- `packages/vibe64-project/src/server/connectedDevelopment.js`
- `packages/vibe64-project/src/server/projectEnvironmentFiles.js`
- `packages/vibe64-project/src/server/projectActions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-project/src/server/settingsAssistantContracts.js`
- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-terminals/src/server/workspaceSetupStart.js`
- `packages/vibe64-terminals/src/server/workspaceSetupExecution.js`
- `packages/vibe64-core/src/server/actionContext.js`
- `src/components/studio/ConnectedProjectsSettings.vue`
- `src/components/studio/ProjectSettingsPanel.vue`

## Public contract

`vibe64.connections.json` contains exactly a `repositories` array, with up to 64
entries containing `name`, `repository` and `relationship`, plus optional `type`
and `script`.
The explicit types are one Vibe64-owned vocabulary shared by Stack parsing,
validation, schemas, Colleague contracts and Settings: `npm`, `composer`,
`pip`, `bundler`, `gomod`, `cargo`, `maven`, `gradle`, `nuget` and `custom`.
Omission remains omitted in source and inherits the consuming Stack default
(for example `npm` for Node or `composer` for PHP). Type is independent of the
dependency/composition relationship. A non-custom type is a declared ecosystem
label recorded in the prepared map; Vibe64 never derives or runs a package
manager from it, and the consumer's declared commands perform the treatment.
Settings offers Stack default and each type with its ecosystem label; selecting
Stack default removes the override rather than writing an empty value or a
resolved default. The bounded Colleague
read/write projection preserves explicit types and their absence.
Explicit custom requires a script; every other explicit type rejects one. A script without
an explicit type is preserved for a future consuming Stack custom default;
the resolved map validates that combination before execution. Script is a bounded
project-relative path in the consumer, outside `.git`, with no traversal,
absolute path, drive prefix, backslash or control character. Settings never
stores an empty script and clears it when a non-custom type is explicitly selected. Stack
declares the custom runtime and runner, such as
``- Custom runner with `nodejs` `cpp`: `node` ``. The existing preparer appends
the absolute script path and `--phase`, `--source-root`, `--project-root`,
`--sources-file` and `--repository` arguments. Runtime inspection verifies the
script exists within the consumer using the existing symlink guard. Configuration does not introduce
another executor or make a script executable merely by saving it. Repository URLs are
GitHub HTTPS addresses without credentials, fragments or query parameters.
Case and optional `.git` suffixes normalize to one repository identity;
duplicates fail. Relationships are `dependency` and `composition`. Local paths
and session IDs do not belong in this file.

The repository file is the sole connection authority from the first entry.
Settings creates it on an explicit save; reads and workspace preparation never
import a list from Stack. Stack contains technology and generic placement or
treatment instructions, not repository identities. Existing files, including
empty lists, are authoritative. Malformed files fail without being replaced.
Settings writes check each listed repository's write access through the actor's
existing GitHub credential owner.

Settings writes require the project owner and retain session agent-write and
project source-mutation locks. The caller passes the revision from the read; changed
bytes reject the write. Ordinary atomic source publication preserves unrelated
files. Symbolic links and oversized connection files are rejected. No new
runtime queue or historical metadata repair is introduced by configuration.

During workspace preparation, Terminals first makes the session's missing
copies, then asks Project's `prepareConnectedDevelopmentInputs` to project them.
Under the existing project source lock, Project resolves every listed repository
to this session's recorded copy (`connected_copies`, validated by Core), failing
with `vibe64_connected_copy_missing` when one is absent, and writes the Stack's
declared Sources file: `{ "schema": "vibe64.connected-sources.v2", "sessionId",
"repositories": [{ name, repository, relationship, type, script?, sourceRoot }] }`,
where `type` is the effective package type and `sourceRoot` the copy's absolute
path. The file belongs to that session. The existing projection-path checks,
managed Git excludes and atomic JSON writer preserve tracked files, symlinks,
unrelated content and other sessions' maps. The connected-source exclude block
coexists with the Environment file block. Repeated preparation preserves an
unchanged map; removing a connection removes its projected entry, and the copy
goes only when Prepare finds it holds no work. The map grants no authority.
`inputs-prepared` does not certify command execution or development consumption.

The internal connected-input inspection compares the map with the session's
recorded copies through the shared projection reader, which rejects missing,
changed or foreign inputs without creating a copy, editing the map or rewriting
Git exclusions. This query is the workspace runner's preflight facility before
each command and when accepting cached preparation. It has no HTTP route or
Colleague tool projection. Project combines the ordinary and connected recipes
with the projected copies to form one preparation identity.

The shared action boundary admits owner actions for the explicitly opened local
project only through its existing local-request checks. Signed-in actions retain
fresh owner authority; a foreign request or unadmitted automation cannot claim
the standalone owner merely by omitting a user.

Colleague uses the same owner-authorized actions and bounded settings result.
Configuration success is not source preparation, publication or deployment
evidence. Removing a connection changes the list; it does not delete a copy that
holds work.
