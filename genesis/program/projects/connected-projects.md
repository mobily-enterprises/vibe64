# Configure connected projects

People maintain a portable list of repositories they intend to contribute to
alongside a project. Project Settings edits the same source file as ordinary
source editing.

## Sources

- Main: `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/connectedProjects.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-project/src/server/settingsAssistantContracts.js`
- `packages/vibe64-genesis/src/server/connectedProjects.js`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-core/src/server/actionContext.js`
- `src/components/studio/ConnectedProjectsSettings.vue`
- `src/components/studio/ProjectSettingsPanel.vue`

## Public contract

`vibe64.connections.json` contains exactly a `projects` array, with up to 64
entries containing `name`, `repository` and `relationship`. Repository URLs are
GitHub HTTPS addresses without credentials, fragments or query parameters.
Case and optional `.git` suffixes normalize to one repository identity;
duplicates fail. Relationships are `dependency` and `composition`. Local paths,
session IDs and remote contribution status do not belong in this file.

Settings reads never initialize source. Explicit initialization imports the
opaque Stack section named `Connected projects` only when the file is absent.
The Genesis boundary parses lines of the form:

```markdown
- Connect `Example library` from `https://github.com/example/library` as `dependency`.
```

`- Nothing.` declares no initial connections. Genesis transports the text;
Vibe64 owns the grammar and the project service validates the resulting entries.
Existing files, including empty lists, are authoritative. Malformed files fail
without being replaced. Initialization and Settings writes check receiving
repository write access through the actor's existing GitHub credential owner.

Settings writes require the project owner and retain session agent-write and
project source-mutation locks. The caller passes the revision from the read; changed
bytes reject the write. Ordinary atomic source publication preserves unrelated
files. Symbolic links and oversized connection files are rejected. No new
runtime queue or historical metadata repair is introduced by configuration.

The internal `initializeSessionConnections` operation imports only the declared
Stack list during fresh working-session preparation or explicit Prepare/Retry.
It requires the exact admitted session, uses the existing source lock, and
relies on preparation's already-held session write admission. It accepts no
replacement list. An absent declaration writes nothing; an explicit empty one
creates an authoritative empty file. Existing files are never reimported.
Passive checks and Learning preparation do not invoke this operation. Import
failure uses the existing failed preparation state and prevents setup commands.

The shared action boundary admits owner actions for the explicitly opened local
project only through its existing local-request checks. Hosted actions retain
fresh owner authority; a foreign request or unadmitted automation cannot claim
the standalone owner merely by omitting a user.

Colleague uses the same owner-authorized actions and bounded settings result.
Configuration success is not source preparation, contribution publication,
integration or deployment evidence. Removing a connection changes the list;
it does not delete existing work or satisfy a pending integration requirement.
