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
- `packages/vibe64-project/src/server/connectionsLock.js`
- `packages/vibe64-project/src/server/connectedAdapters/index.js`
- `packages/vibe64-project/src/server/connectedAdapters/npm.js`
- `packages/vibe64-project/src/server/connectedAdapters/npmPackages.js`
- `packages/vibe64-project/src/server/connectedAdapters/sync.js`
- `packages/vibe64-project/src/server/connectedAdapters/derivedFiles.js`
- `packages/vibe64-project/src/server/connectedAdapters/adapterResults.js`
- `packages/vibe64-project/src/server/connectedAdapters/commandOutput.js`
- `packages/vibe64-project/src/server/connectedAdapters/publishedSource.js`
- `packages/vibe64-project/src/server/connectedAdapters/composer.js`
- `packages/vibe64-project/src/server/connectedAdapters/pip.js`
- `packages/vibe64-project/src/server/connectedAdapters/bundler.js`
- `packages/vibe64-project/src/server/connectedAdapters/gomod.js`
- `packages/vibe64-project/src/server/connectedAdapters/cargo.js`
- `packages/vibe64-project/src/server/connectedAdapters/maven.js`
- `packages/vibe64-project/src/server/connectedAdapters/mavenPom.js`
- `packages/vibe64-project/src/server/connectedAdapters/gradle.js`
- `packages/vibe64-execution/src/server/env/connectedGradleEnv.js`
- `packages/vibe64-project/src/server/connectedAdapters/nuget.js`
- `packages/vibe64-terminals/src/server/agentSessionStatus.js`
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
dependency/composition relationship. For a dependency of a non-custom type,
Vibe64's adapter for that type performs the treatment (see Adapters below); the
consumer's declared commands remain for compositions and custom connections.
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
A section with only a Default package type writes no map; the adapters read the
same resolved repositories from the inspection.

## One lifecycle

Every connection goes through the same phases; the type decides only the
mechanism. Staging and Production never read session trees.

| Relationship | In the session | On Save | Staging and Production |
|---|---|---|---|
| dependency, npm | adapter swap of every installed copy; watcher sync | adapter `bump` to a published version | tracked package.json and lockfile |
| dependency, composer, pip, bundler, gomod, cargo, maven, gradle, nuget | adapter `apply` (derived, untracked files; maven: watcher re-install) | adapter `bump` to a published version | tracked manifests and lockfiles |
| dependency, custom | project Custom runner (prepare, verify) | project `Save` entries | tracked files |
| composition, any type | the project's composer (Verify required) plus npm swaps in the composed trees | Vibe64's pin in `vibe64.connections.lock.json` | the project's build reads the pin |

Until a connected version is published, preparation's check, Save and session
status show the gap: what the session runs and the published version Staging
and Production use (`releaseGapLine` from each adapter's `locked`). At the same
version, `locked` also says whether the copy has unreleased changes
(`unreleased`), where the registry makes that comparable:

| Type | How it tells a change at the published version |
|---|---|
| npm | the swapped files against the published copy kept aside, which Save replaces with the registry's tarball after a bump (files only, so status too) |
| gomod | Git: the copy against the version's tag (when it is the copy's newest version tag) or a pseudo-version's commit |
| composer | Git: the copy against the commit `composer.lock` names (`source` or `dist` reference) |
| pip, bundler, cargo, maven, gradle, nuget | cannot tell: their registries publish built archives a checkout does not reproduce byte for byte, and record no commit to compare with |
| custom | the project's own steps |

The Git comparisons (`publishedSource.js`) need a command runner: status passes
the managed runner for `locked` only, never for proofs, and the preparation
check and Save have one; preparation's `isPrepared` check reads files only, so
it leaves them out.

## Adapters

`connectedAdapters/index.js` registers one adapter per non-custom type with the
contract `{ type, runtimeRequirements, apply(context), proof(context),
locked(context), bump(context), watch?, restore?(input) }` documented at its
top, and turns each typed dependency into
two workspace preparation steps. `runConnectedAdapterStep` serializes applies
(and syncs) per session source and returns a command-shaped result;
`inspectConnectedAdapters` runs every proof without a command runner, from files
only, for `isPrepared` and session status.

A connection nothing in the session installs is unused, not a failure: apply
resolves to `{ lines, unused }` and the proof to `notUsed(reason)`
(`adapterResults.js`, `{ inEffect: false, unused: true, reason }`). Both steps
then succeed with `[Connected] <name> is connected, but nothing here installs
it: remove it or install it. <reason>`, `inspectConnectedAdapters` reports
`unused: true` with that sentence as the reason, `connectedInEffect` in
`workspaceSetupExecution.js` does not count it (so Preview does not prepare
again for it), session status passes `unused`, and `connectedProjectsState`
gives the page its `unused` list. The files-only proof says unused exactly
when preparation's would. Most adapters decide from the same files in apply and
in it: npm, no installed copy; composer and bundler, the manifest and tracked
lock (their plans leave unused connections out, and with none used apply runs
the type's restore); gomod, no session `go.mod` or no `require` of the module
(the proof lists `go list -deps -test ./...`, and a required module none of
whose packages it lists is in effect, with the proof's `note` saying no build
here shows it); maven and gradle, a session source that is no Maven project or
Gradle build. Two adapters decide in the toolchain and record the decision:
cargo, no workspace member declares the crate (`cargo metadata --no-deps`); and
nuget, no evaluated `PackageReference`. Each records the decision with
`inputsDigest` (`derivedFiles.js`), a digest of the files the decision read.
Cargo keeps it in a line of its `.cargo/config.toml` and digests the session's
`Cargo.toml` files. NuGet keeps it in `.development/nuget/unused.json` and
digests the session's and the checkouts' `.csproj`, `.props` and `.targets`
files, its own imports left out. The files-only proof trusts the record only
while that digest is unchanged, and otherwise says to prepare again. A
crate or package the session reaches only through another one counts as unused
until the session declares it. pip installs every connection editable into
`.venv` itself, so it has nothing that can be unused.

The npm adapter (`npm.js`,
`npmPackages.js`) finds the connected copy's publishable packages (npm
workspaces and in-repository `file:` packages, never `private` ones), every
installed copy of them in the session's trees, and replaces each with the
packlist of `npm pack --dry-run`, moving the published copy to
`node_modules/.vibe64-connected/originals/` and recording each file's digest in
`npm-swaps.json`. Missing or incompatible dependencies of the connected package
are installed with `npm install --no-save`, passing every earlier one again
because npm prunes unsaved packages. Apply judges them as they will resolve
after the swap: a dependency npm nested in a published copy, for that version's
own pin, at a version the connected package does not accept goes aside with the
copy (into its `originals/` folder's `node_modules`, where a restore puts the
rest of the nested `node_modules` back beside it), so the connected package
resolves past it; one that would still resolve wrongly refuses
(`vibe64_connected_npm_dependency_incompatible`). A tracked copy is refused
(`vibe64_connected_npm_tracked`) and `node_modules` is excluded when the tree
does not ignore it. The proof compares the copies with the record and the
record with the connected source. `sync.js` watches the copied package folders
with chokidar; a content save copies the changed files, and a packlist change,
or a save after npm put a published copy back, applies the connection again. The other adapters write their derived files
through `derivedFiles.js`, in their type's own Git exclude block, and run their
toolchain through the managed command function. The gradle adapter writes its
init script into the session's own Gradle user home (`.development/gradle-home`,
excluded whole, its `init.d`), which links the default home's `gradle.properties`
and init scripts; `connectedGradleEnv` gives every command whose tree holds that
script the home as `GRADLE_USER_HOME`, so the session's ordinary Gradle commands
take the connection with no flag, and the shared read-only cache
(`GRADLE_RO_DEP_CACHE`): generations copied from the default home's
`caches/modules-2` without its locks and `gc.properties`, published whole under
`current` at most once a day and removed after a week; a command gets the
generation `current` names when it starts. The published check and
`--write-locks` run in the default home, whose `init.d` has no connection.

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
Configuration success is not source preparation or publication
evidence. Removing a connection changes the list; it does not delete a copy that
holds work.
