# Project archives

A project can be archived into a validated recovery bundle and then removed, or,
when it is a practice project, removed without an archive. Both hosts use the one
lifecycle; a host adds only the project resources it owns.

## Sources

- Main: `packages/vibe64-project/src/server/projectArchive.js`
- `packages/vibe64-project/package.json`
- `packages/vibe64-core/src/server/studioProjectContext.js`
- `packages/vibe64-core/src/server/learningSpace.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `tests/server/projectArchive.unit.test.js`

## Public contract

`@local/vibe64-project/server/project-archive` exports
`createProjectArchiveService({projectContext, closeProjectRuntime, runCommand?,
clock?, removePath?, hostResources?, assertArchiveHeadroom?})`. It returns
`archiveProject({slug, archiveRoot?, checkHeadroom?})`, `removeProject({slug})`,
`canRemoveProject({slug})` and `projectExists({slug})`.

**Archive.** Under a per-slug lock, the project is refused when a session source
is pinned ("Unpin session … before deleting this project.",
`vibe64_project_pinned`), before any deletion state changes. Otherwise a deletion
marker is written on the project record and these steps run once each, recorded
both on the marker and in the bundle's `lifecycle.json`, so an interrupted
archive resumes from the failed step: `runtime-closed`, `source-archived`,
`state-archived`, `resources-archived`, `bundle-validated`, `resources-removed`,
`source-removed`, `state-removal-started` and `state-removed`.

The bundle is `<archiveRoot>/<slug>/<UTC>-<slug>/` (default archive root
`<systemRoot>/project-archives`), private to the daemon (0700, files 0600):

- `source.tgz`: the project namespace, tarred with `--acls --xattrs
  --numeric-owner` from the namespace's parent. Rebuildable dependencies are
  left out: `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`,
  `.next`, `.turbo`, `.jskit/cache` and `cmake-build-*`, in the namespace and in
  every `sessions/*/*/source`.
- `runtime-state.tgz`: the runtime root (`<systemRoot>/projects/<slug>`), without
  session Drop Zones.
- `resource-evidence.json` and `manifest.json` (`vibe64.project-archive-bundle`,
  schema 1): each artifact's bundle-relative path, size, SHA-256 and, for the
  tarballs, entry count and listing digest.

The manifest is validated again before anything live is removed, and any change
to an artifact refuses the archive (`vibe64_project_archive_artifact_changed`).
The record is removed last. Archiving a project whose record is gone returns its
completed bundle again from the newest matching `lifecycle.json`, so a replay
after the final step changes nothing.

`checkHeadroom: true` calls the host's `assertArchiveHeadroom({slug,
projectContextRoot, projectRuntimeRoot, archiveRoot})` before a fresh archive
writes its marker; a resumed archive continues, because finishing it frees the
space. Without `checkHeadroom` (the normal Delete project), nothing is asked.

**Host resources.** `hostResources` is the one host contract:
`archive(ctx)` returns artifacts written inside `ctx.bundlePath`;
`remove(ctx)` runs at `resources-removed` (with the validated `ctx.manifest`, or
`null` for `removeProject`); `forget(ctx)` runs after the runtime state is gone;
`artifactKinds[kind]` supplies `evidence(artifact, file)` and
`validate(artifact, file)` for the host's own artifact kinds. The archiver checks
that each artifact is inside the bundle, unique and non-empty, and records its
digest. The standalone default archives nothing and accepts no other kind; an
unknown kind in a manifest refuses validation.

**Practice projects.** Inside the matching practice scope
(`projectContext.currentPracticeProjectScope()`), a `training-<hex>` slug resolves
to its learning-space namespace under `projectContext.learningSpaceRoot`
(core `learningSpace.js`: `<managedSourceRoot>/.learning` locally,
`<projectsRoot>/.learning` on Online), and the archive's source parent is that
namespace's parent. The practice session source root is the namespace itself, so
the learner's code is in `source.tgz` and goes with the namespace; a scope whose
session sources lie outside its namespace is refused
(`vibe64_practice_session_source_outside_namespace`) before any marker. After the
namespace goes, its empty practice directory goes too. Outside its scope a
practice slug is refused with `vibe64_practice_scope_required` (409) before any
marker is written.

A catalogue project named `training-<hex>` without a practice marker (created
before the name was reserved) is archived, resumed and replayed as a normal
project. The record decides: a record without `training` is a catalogue project;
a record with it is refused. Once the record is gone (a completed archive), the
slug's own `lifecycle.json` under the archive root admits the replay; with
neither, the slug is refused. Whether the namespace still exists does not
matter, so an archive interrupted after `source-removed` resumes. Learning
decides who may archive or remove a practice project and ends its lesson attempt
first; the archiver only checks the structure.

**Light deletion.** `removeProject` is the archive lifecycle without its archive
steps, for practice projects only: a catalogue project is refused with
`vibe64_project_not_practice` (409, "Only practice projects can be deleted
without an archive. Use Delete project instead."), so a normal project keeps
archive-only deletion. A pinned session refuses it ("Unpin session … before
deleting this practice project."). `canRemoveProject` returns the same refusals
as `{ok: false, reason}` and writes nothing. `projectExists` is true while a
record or any storage remains, so an interrupted removal stays listed for the
retry; a completed removal replays as `{ok: true, removed: false}`.

There is no restore operation. The bundle is private recovery evidence, not a
portable export.

## Moved from Vibe64 Online

The lifecycle, its light deletion and these tests moved here from Online's
`projectArchiveService.js` and its unit tests. Online keeps its managed
databases, resource profiles and resource policy as `hostResources`, with their
tests. The test that counted namespace inspections through a test-only
`readNamespaceDisposablePaths` hook now counts the namespace tar runs. The
practice tests run inside the practice scope and pass no actor: ownership and
the end of the lesson attempt belong to Learning.
