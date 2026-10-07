# Author a lesson and publish its source

Ask Colleague to coordinate a coding agent, review the lesson in the same session,
and publish its source through the existing Save or pull-request workflow.
Colleague can operate those controls when requested; it does not edit files or
run a shell itself. Git publication, pinned course material and installation are
separate results. The current learner offering remains one introductory lesson.

## Choose the authoring target

Use an existing authorised authoring project and exact development session.
Colleague can inspect saved branches and open the requested branch through the
normal session controls; another session does not share unsaved changes. GitHub
connection, repository access and Git author identity remain the person's normal
account steps. Opening, creating or importing a new GitHub project uses the
existing hosted UI; Colleague must not invent an import or source-access tool.

For the current introduction, revise the existing V64-START-01 topic rather than
exposing a second lesson. Preserve its permanent IDs, six assessments, actual App
button/check correlation and declared SVG/controller protocol unless the person's
request explicitly changes that content. New lesson content may be authored as
a draft using the existing template below; a draft is not another learner release.

## Delegate and review

For example: “In this lesson-authoring project and session, improve the introduction's
wording, keep its six assessments and App/diagram contracts, validate and bundle it,
arrange a review, then publish the source as a draft PR. Do not install or enable it.”
This is an example instruction, never authority to execute it without the person's
actual request. A how-to question makes no edits, assignment or external write.

Colleague retains the actual request, target, acceptance criteria and bounded
turn allowance using its existing assignment controls. It sends implementation to
the configured coding agent, waits for the original receipt/watch, and asks for
actual changed-file, validation and relevant exercise/diagram evidence. It creates
the existing temporary reviewer in that SAME session after implementation settles.
The reviewer checks the existing source without editing; corrections return to
the implementer and require another review of the latest work. Routine follow-up
within the assignment is supported. New scope, extra turns or an unresolved
publication target remain a recorded user decision, not an invented choice.

“Ready for testing” needs evidence against every criterion and the latest review;
it does not mean published or installed. A preview can be published as preview
source when requested. Pedagogical trial, real exercise and animation acceptance
remain explicit requirements before claiming a reviewed course release.

## Publish through the native repository workflow

After coding settles, inspect **Changes** and the exact repository/branch
reported by the session. **Save** captures ALL current work, not selected files.
A managed Vibe64 Git Save updates its canonical project; a GitHub Save pushes to
the reviewed repository branch. Colleague can request native Save after an explicit
Save/publication instruction and passes its unchanged destination review. It
cannot bypass active-agent, stale-source, account or required-PR rules, or discard
unrelated work to make publication pass. An ambiguous target stays unresolved.
On mobile, reveal the project and use its Dashboard section chooser for Changes
or Pull requests. The same native Save/PR permissions and review apply.

For a required or requested PR workflow, Colleague can use the existing PR creation
operation with the reviewed destination and requested title/body; draft is the
default. PR creation saves and publishes the session's work. An already bound PR
is returned rather than silently edited. **Pull requests** shows actual remote
source/base commits, checks and review blockers. Marking a draft ready or merging
requires the person's corresponding instruction and the original fresh review;
creating a PR does not authorise merge. Use only a repository-enabled merge method
covered by that instruction. Save, PR creation or merge never deploys Vibe64.

After success, report the actual saved destination or returned PR and current
remote status. A coding agent's “pushed” message is not publication proof. After
an uncertain result, inspect the original operation/PR before a deliberate retry;
`published_needs_reconcile` means publication happened and local reconciliation
still needs recovery. Do not republish automatically. Existing **Update this
session (rebase)** and coding-agent conflict repair apply only when requested.

## Validate, bundle and pin

Content authors can validate and bundle a local teaching topic with the installed
Vibe64 command. These authoring commands do not by themselves expose a learner course screen,
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

A coding agent can perform those authoring commands through its normal authorised
coding/terminal owner. Colleague coordinates the assignment and reads its receipts;
this does not give Colleague a shell. After final topic publication, the coding
agent prepares the exact clean committed topic for the course lock. If the course
catalogue is a separate project, use a separate authorised assignment/session and
its native Save/PR workflow; only explicitly linked assignments exchange findings.
Changed topic contents require a deliberate new topic release, and a changed course
lock/definition requires a new course release. Existing release identities are
immutable. Check both the exact local lock and actual requested Git publication;
`publish-manifest` proves no remote push, installation or learner enablement.

## Operator installation is separate

A workspace operator can now provision approved local lesson content through the
terminal commands documented in [Local operator provisioning](../training-content.md#local-operator-provisioning).
`install-topic` installs a clean committed topic; `installed-courses` reads the
fresh catalogue revision; `enable-course` and `disable-course` change only the
exact selected release against that revision. Creating a course lock does not
install or enable it, and installation does not make it available to learners.
Disabling blocks new starts while retaining existing attempts' pins. This is an
OS-operator task on the selected installation, with no learner/mobile control or
Colleague source/shell access. Colleague can explain the steps and offer to help
formulate the operator request; it cannot run operator installation, enablement or deployment on
that person's behalf. Requested Git source publication uses the native workflow above. Invalid content or an unconfirmed save requires owner
inspection, not automatic replacement or blind retry.

The operator uses the approved final local source, course definition and exact lock,
then reads the fresh installed catalogue before changing enablement. Colleague can
list the resulting enabled course through its normal learning query after the
operator completes this step; absence is not permission to fabricate a substitute.
Existing attempts keep their saved pins. Source publication alone does not prove
installation, learner delivery, assessment completion or pilot acceptance.
