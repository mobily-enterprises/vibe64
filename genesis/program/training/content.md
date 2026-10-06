# Teaching content

Vibe64 validates local topic repositories and produces reproducible lesson bundles.
This authoring facility does not execute exercises, install topics or teach a
learner. The teaching runtime and hosted provisioning are not yet implemented.

## Sources

- `packages/vibe64-training/src/server/contentSchemas.js`
- `packages/vibe64-training/src/server/content.js`
- `packages/vibe64-training/src/server/catalogue.js`
- `packages/vibe64-training/src/server/cli.js`
- `bin/run.js`
- `docs/training-content.md`
- `docs/colleague-usage/teaching-content.md`
- `tests/server/vibe64TrainingContent.unit.test.js`

## Public contract

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
replacing the sibling `course.lock.json`. Locks contain repository, immutable
commit, manifest hash and ordered lesson identities. Released courses require
released topics without required drafts. This is local authoring, with no Git
push, remote release, installation or course enabling.

Practical descriptors name evidence producers/checks; this facility validates their
references but does not manufacture observations, run checks or evaluate progress.
Application execution, learner permissions and teaching remain Vibe64 concerns,
with no teaching semantics in JSKIT or Genesis.
