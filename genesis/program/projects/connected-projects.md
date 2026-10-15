# Configure connected projects

People maintain a portable list of repositories they intend to contribute to
alongside a project. Project Settings edits the same source file as ordinary
source editing.

## Sources

- Main: `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/connectedProjects.js`
- `packages/vibe64-project/src/server/connectedDevelopment.js`
- `packages/vibe64-project/src/server/projectEnvironmentFiles.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-project/src/server/settingsAssistantContracts.js`
- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-core/src/server/actionContext.js`
- `src/components/studio/ConnectedProjectsSettings.vue`
- `src/components/studio/ProjectSettingsPanel.vue`

## Public contract

`vibe64.connections.json` contains exactly a `projects` array, with up to 64
entries containing `name`, `repository` and `relationship`, plus optional `type`
and `script`.
The only explicit types are `npm` and `custom`; omission remains omitted in
source and inherits the consuming Stack default (`npm` for Node). Type is
independent of the dependency/composition relationship. Settings offers Stack
default, npm and custom; selecting Stack default removes the override rather
than writing an empty value or a resolved default. The bounded Colleague
read/write projection preserves explicit types and their absence.
Explicit custom requires a script; explicit npm rejects one. A script without
an explicit type is preserved for a future consuming Stack custom default;
the resolved map validates that combination before execution. Script is a bounded
project-relative path in the consumer, outside `.git`, with no traversal,
absolute path, drive prefix, backslash or control character. Settings never
stores an empty script and clears it when npm is explicitly selected. Stack
declares the custom runtime and runner, such as
``- Custom runner with `nodejs` `cpp`: `node` ``. The existing preparer appends
the absolute script path and `--phase`, `--source-root`, `--project-root`,
`--sources-file` and `--repository` arguments. Runtime inspection verifies the
script exists within the consumer using the existing symlink guard. Configuration does not introduce
another executor or make a script executable merely by saving it. Repository URLs are
GitHub HTTPS addresses without credentials, fragments or query parameters.
Case and optional `.git` suffixes normalize to one repository identity;
duplicates fail. Relationships are `dependency` and `composition`. Local paths,
session IDs and remote contribution status do not belong in this file.

The repository file is the sole connection authority from the first entry.
Settings creates it on an explicit save; reads and workspace preparation never
import a list from Stack. Stack contains technology and generic placement or
treatment instructions, not repository identities. Existing files, including
empty lists, are authoritative. Malformed files fail without being replaced.
Settings writes check receiving repository write access through the actor's
existing GitHub credential owner.

Settings writes require the project owner and retain session agent-write and
project source-mutation locks. The caller passes the revision from the read; changed
bytes reject the write. Ordinary atomic source publication preserves unrelated
files. Symbolic links and oversized connection files are rejected. No new
runtime queue or historical metadata repair is introduced by configuration.

During workspace preparation or explicit connected-source allocation, Sessions supplies freshly authorized
receiving sessions to Project's `prepareConnectedDevelopmentInputs`. Under the
existing origin admission and project source lock, Project checks the current
connection list against retained contribution bindings and ready receiving
sources, then projects their exact paths to the Stack's declared Sources file.
This `vibe64.connected-sources.v1` JSON belongs to that originating session.
The existing projection-path checks, managed Git excludes and atomic JSON writer
preserve tracked files, symlinks, unrelated content and other sessions' maps.
The connected-source exclude block coexists with the Environment file block.
Repeated preparation preserves an unchanged map; removing a connection removes
its projected entry without deleting the receiving work or retained binding.
The map grants no authority and is not a publication ledger. `inputs-prepared`
does not certify command execution or development consumption.

The internal connected-input inspection action reauthorizes each receiving
project through the original request and checks its exact retained contribution
before asking Project to compare the map with those authoritative sessions.
The shared projection reader rejects missing, changed or foreign inputs without
creating a checkout, editing the map or rewriting Git exclusions. This query is
the workspace runner's preflight facility. It revalidates access before each
command and when accepting cached preparation. It has no HTTP route or
Colleague tool projection. Project combines the ordinary and connected recipes
with the exact projected source selection to form one preparation identity;
Sessions supplies the existing authorized allocation operation under the
runner's originating agent-write lease.

The shared action boundary admits owner actions for the explicitly opened local
project only through its existing local-request checks. Hosted actions retain
fresh owner authority; a foreign request or unadmitted automation cannot claim
the standalone owner merely by omitting a user.

Colleague uses the same owner-authorized actions and bounded settings result.
Configuration success is not source preparation, contribution publication,
integration or deployment evidence. Removing a connection changes the list;
it does not delete existing work or satisfy a pending integration requirement.
