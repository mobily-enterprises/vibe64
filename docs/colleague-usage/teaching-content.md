# Prepare teaching content

Content authors can validate and bundle a local teaching topic with the installed
Vibe64 command. These authoring commands do not yet expose a learner course screen,
install a topic or start a lesson. Do not offer to start a course merely because
its files validate.

Use a topic repository whose name begins with `learn-`. Keep the teaching document,
assessment rubrics, SVG descriptors and runnable exercise in that repository.
The installed `docs/templates/learn-topic/` directory supplies a copyable whole
topic. The author copies it to a new directory, follows its README to choose
permanent identifiers and replace placeholder content, then validates it. Its
single lesson is a draft; copying or validation does not make it ready to teach.
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
Keep the course file outside the source topics and name it `course.json`, not
`course.lock.json`; output paths that could change these inputs are refused.
Success writes `course.lock.json` beside the course file, including exact commits,
manifest hashes and every lesson in topic order. Dirty or changed inputs require
the author to commit the intended version and retry. A preview remains a preview;
required draft lessons prevent a released course. This command does not publish
a remote release, install a topic or make a learner course available.

These are terminal authoring steps on desktop, with no separate mobile controls.
Colleague can explain them and offer to ask a coding agent for help. It cannot run
them itself or claim a draft lesson is ready for a learner. Human teaching review,
real exercise checks and animation testing remain necessary before a course release.

A lesson version must remain pinned to the content the learner started. If its
content is reported missing or invalid, ask the workspace owner to restore that
exact verified revision. A newer bundle or a draft is not a substitute for the
missing lesson, and retrying must not reset learning history. Colleague can explain
this recovery and offer to formulate the request; it cannot reinstall content.
There is still no learner start/install control in this authoring release.

The application also has a server-only verified-snapshot installation facility.
It is not a visible control, a Colleague tool or a terminal authoring command.
An admitted owner operation must select the canonical local source and exact
course pin. Colleague can explain this boundary and offer to help contact the
workspace owner through the supported conversation actions; it cannot choose a
filesystem path, install content or grant course access. A busy installation can
be retried after its current operation finishes. Existing invalid content requires
owner inspection; it must not be replaced automatically during lesson reads.

The server can now retain a private pinned lesson reservation, but there is still
no learner start/resume control or Colleague lesson tool. Creating a reservation
does not mean that the exercise is prepared or that a quiz has passed. Colleague
should explain what is available and offer to help through its current supported
conversation actions, rather than claiming it can start teaching yet.

When a future lesson operation reports an interrupted save, retry its same request
identity. A saved reservation with a missing summary must resume that same attempt;
it must not create another project. Busy state means another update is active, not
that progress was erased. Corrupt or mismatched state requires owner inspection;
opening projects or switching devices must not manufacture a repair or a pass.
These internal facilities add no separate desktop/mobile controls in this release.
