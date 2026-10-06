# Prepare teaching content

Content authors can validate and bundle a local teaching topic with the installed
Vibe64 command. These authoring commands do not yet expose a learner course screen,
install a topic or start a lesson. Do not offer to start a course merely because
its files validate.

Use a topic repository whose name begins with `learn-`. Keep the teaching document,
assessment rubrics, SVG descriptors and runnable exercise in that repository.
Ask the coding agent to follow the release's `docs/training-content.md` authoring
contract. Colleague can help formulate that request and send it to an authorised
coding conversation when the person asks; Colleague has no source or shell access.

The author runs `vibe64 training validate <topic-directory>` in their terminal.
Success lists ordered lesson hashes and distinguishes published lessons from drafts.
A failure means the author must correct the reported schema, reference, rubric or
path problem; it does not change their project or learning history.

To produce local release material, the author runs
`vibe64 training bundle <topic-directory> <new-output-directory>`.
The output must be outside the topic and must not already exist. A successful
output contains `bundle.json` and its exact input files. If the source changes
during copying, validate again and retry with a new output. Validation and bundling
do not publish anything, execute exercise scripts or prove the lesson works.

To pin a course, the author prepares a `course.json` selecting whole topic releases
and runs `vibe64 training publish-manifest <course.json> <committed-topic-directory...>`.
Use the repository root for each topic, with its canonical GitHub repository URL
in its package metadata. Commit all topic content first and leave the tree clean.
Success writes `course.lock.json` beside the course file, including exact commits,
manifest hashes and every lesson in topic order. Dirty or changed inputs require
the author to commit the intended version and retry. A preview remains a preview;
required draft lessons prevent a released course. This command does not publish
a remote release, install a topic or make a learner course available.

These are terminal authoring steps on desktop, with no separate mobile controls.
Colleague can explain them and offer to ask a coding agent for help. It cannot run
them itself or claim a draft lesson is ready for a learner. Human teaching review,
real exercise checks and animation testing remain necessary before a course release.
