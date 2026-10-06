# Teaching content

Vibe64 validates local topic repositories and produces reproducible lesson bundles.
This authoring facility does not execute exercises, install topics or teach a
learner. A read-only server facility now checks preinstalled pinned snapshots;
there is no installer, learner progress, teaching runtime or hosted provisioning.

## Sources

- `packages/vibe64-training/src/server/contentSchemas.js`
- `packages/vibe64-training/src/server/content.js`
- `packages/vibe64-training/src/server/catalogue.js`
- `packages/vibe64-training/src/server/cli.js`
- `packages/vibe64-training/src/server/installedContent.js`
- `bin/run.js`
- `docs/training-content.md`
- `docs/templates/learn-topic/README.md`
- `tooling/release/runtime-package.mjs`
- `docs/colleague-usage/teaching-content.md`
- `tests/server/vibe64TrainingContent.unit.test.js`
- `tests/server/vibe64TrainingInstalledContent.unit.test.js`

## Public contract

The release ships a copyable whole-topic template and its authoring guide. The
template validates as one draft lesson, without exercise or visual capabilities;
authors replace its placeholders and review learning outcomes before publication.

`vibe64 training validate <topic-directory>` validates versioned topic, lesson and
visual schemas, explicit rubric anchors, declared checks, relative file boundaries,
local prerequisites and continued exercise sequences. Drafts remain labelled as
drafts; a released topic cannot include required draft lessons. Topic-level external
prerequisites need catalogue resolution beyond this local command.

`vibe64 training bundle <topic-directory> <new-output-directory>` writes exact
validated files and a completion manifest, outside the source. It refuses existing
output and cleans only a newly owned failed output. Byte changes while copying fail
the command. Sorted path/hash/size manifests determine lesson identity; installed
dependencies, Git state and unrelated documents are excluded. The topic manifest
adds metadata, outline and ordered lesson identities. Nothing is fetched or executed.

`vibe64 training publish-manifest <course.json> <committed-topic-directory...>`
selects complete ordered topic releases. It validates clean repository roots and
compares every included input against the exact Git commit before atomically
replacing the sibling `course.lock.json`. Repository metadata comes from the
pinned commit rather than a later working-tree read. Output cannot replace its
input descriptor or live inside a pinned source topic, including physical aliases.
Locks contain repository, immutable commit, manifest hash and ordered lesson
identities. Released courses require
released topics without required drafts. This is local authoring, with no Git
push, remote release, installation or course enabling.

Practical descriptors name evidence producers/checks; this facility validates their
references but does not manufacture observations, run checks or evaluate progress.
Application execution, learner permissions and teaching remain Vibe64 concerns,
with no teaching semantics in JSKIT or Genesis.


## Installed pinned reads

`@local/vibe64-training/server/installed-content` exports
`createInstalledTrainingContent({systemRoot})`. The server chooses an absolute
system root; requests choose validated topic IDs, exact commits and lesson hashes,
never filesystem paths. A trusted topic hash from the course lock or saved attempt
is mandatory for both reads and fences even a self-consistent cache replacement.
Snapshots live under
`training/content/<topicId>/<commit>/` with `pin.json`, original CLI `bundle.json`
and its `files/` snapshot. The pin identifies schema, topic, release, canonical
repository, commit and topic hash.

`readTopic` reuses local validation and compares the complete ordered bundle,
identity and file inventory. It rejects symlinks, changed/missing/extra files and
invalid pins. `readLesson` selects only a published lesson at its exact hash and
returns the checked document, rubric sections and visual descriptors. Reads never
write, repair, fetch, run checks, enable a course or declare an assessment passed.
An absent or invalid snapshot reports reinstall guidance. Catalogue enablement is
not part of a pinned read, so a future existing attempt can continue after its
release is disabled; new-start permission remains the application action's job.
