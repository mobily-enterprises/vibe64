# Authoring teaching content

Teaching content belongs in a `learn-` topic repository. The current authoring
commands validate and bundle local content; they do not install a course, start
an exercise, execute a check, publish a repository or grant learner access.

From an installed Vibe64 checkout/package:

```sh
vibe64 training validate /absolute/path/to/learn-topic
vibe64 training bundle /absolute/path/to/learn-topic /absolute/path/to/new-bundle
vibe64 training publish-manifest /absolute/path/to/course.json /absolute/path/to/learn-topic
```

In the public development checkout, use `node bin/run.js training ...` with the
same arguments. These commands run in the current terminal and do not open the
editor. Validation prints the topic and ordered lesson hashes, including draft
status. A successful bundle has `bundle.json` plus `files/`; the completion
manifest is written last. Choose a new output directory outside the topic.
Both source and output-parent aliases are resolved before checking containment.
An existing output is refused without changing it. A failed newly owned output
is removed so the command can be retried. Nothing is downloaded or executed.

## Topic and lesson contracts

Copy the whole `docs/templates/learn-topic/` directory from the installed package
or source checkout into a new topic directory. Its README lists each permanent ID,
title, code and outline change. The template validates as one draft lesson; it is
not teachable content. Lesson 01 in the getting-started topic is the worked example.

The root `package.json` has a `learn-` name, exact three-part release version and
`vibe64Training` object. Its schema version is 1. Required fields are `topicId`,
`domainId`, `title`, `status` (`preview` or `released`), `outline`, `prerequisites`
and ordered `lessons`. Topic prerequisites are `{topicId}` objects. Each lesson
entry declares `code`, `descriptor`, `status` (`draft` or `published`) and
`required`. A released topic cannot contain required draft lessons. Draft content
is validated but remains unavailable for teaching until published and installed.

A lesson descriptor declares schema version 1, `code`, `title`, `document`,
`estimatedMinutes`, `prerequisites` (`{code}` objects), `visuals` (`{id,descriptor}`)
and `assessments`. Unknown fields and type coercion are rejected. IDs contain
letters, digits or hyphens, begin with a letter and have at most 64 characters.
References and prerequisite cycles are checked. Prerequisites must precede their dependants; published lessons cannot require
draft content, including a draft sequence creator. Topic-to-topic prerequisite
resolution belongs to the installed catalogue; local validation cannot prove
another repository is available.

An assessment declares `id`, `kind` (`answer` or `practical`), `required` and
`rubric`. Use an explicit `<a id="assessment-id"></a>` line in the teaching
document and refer to it as `lesson.md#assessment-id`. Answer assessments use
the admitted learner answer and that rubric. Practical assessments also declare
`evidence: {producer, operation, check?, explanationRequired?}`. Supported producers
are `workspace`, `colleague` and `exercise`. Exercise evidence requires an exercise
and a declared check; other producers cannot execute checks. Declare checks as
`checks: [{id,file,assets?}]`. Declare auxiliary check inputs in `assets`, relative to the lesson descriptor.
The validator includes these files but never executes them.
The managed application execution owner will run approved pinned checks; teaching
tools do not gain arbitrary shell access. Demonstrations cannot earn learner passes.

An optional exercise uses `{kind:"bundled", source, reuse:"attempt"}`. Continued
work uses `reuse:"sequence"`, `sequenceId` and `sequenceMode:"create"|"continue"`.
One creation precedes continuations in topic order, with the same source directory.
Each lesson keeps its own attempt/progress. Missing learner work requires an explicit
recovery choice, never an invented practical pass. External exercise repositories
are not supported by this local authoring increment.

## Visuals and reproducible identity

A visual descriptor has schema version 1, `id`, `title`, `svg`, `controller`,
`description`, `initialState`, `states` and `commands`, with optional `assets`
relative to the visual descriptor for local modules, styles or other inputs. Each command declares
`name`, `parameters`, `completionState` and `description`. Parameters are bounded
display strings described by `{name,required,maxLength}`. A completion state must
be declared, or `unchanged` for pause. The runtime sandbox and channel own playback
and acknowledgements; local validation does not prove animation behavior or safety.

All paths resolve relative to their descriptor and stay inside the topic root.
Use regular files without symlinks. Local content is limited to 1 MiB per file,
512 files and 32 MiB per lesson. Exercise `.git`, `node_modules` and derived
`.genesis` directories are excluded. Check scripts, source lockfiles, visual assets,
descriptors and rubrics are included. Authors must declare every non-builtin check/visual dependency; the validator
does not inspect JavaScript imports or infer dynamic dependencies. Remote assets
are not fetched.

Lesson identity is SHA-256 of a canonical JSON manifest containing sorted relative
file paths, exact byte hashes and sizes. An unrelated document or installed
dependency does not change a lesson hash; a shared visual or declared check does.
The topic manifest separately includes root metadata, outline and ordered lesson
hashes. A source file changing between validation and copying fails bundling.
Conflicting hashes for a shared path across lessons fail validation rather than
choosing one snapshot. An author must review content and actually test the exercise and visual before
publishing; a successful schema check does not establish a working lesson.

## Pin a course catalogue

A `course.json` declares schema version 1, `courseId`, `title`, an exact three-part
`release`, `status` (`preview` or `released`) and ordered `topics` containing
`{topicId,release}`. A course selects whole topics; lesson selection or reordering
is rejected. A released course requires released topics with no required drafts.

Run `vibe64 training publish-manifest <course.json> <committed-topic-directory...>`
with one canonical repository root for each selected topic. Each topic's package
must declare `repository.url` as `https://github.com/<owner>/learn-<topic>.git`.
Commit the topic and leave its working tree clean, including untracked files.
The command validates the content and compares every included byte against the
exact Git commit. Missing, duplicate, dirty or mismatched topics fail generation.
Repository identity is read from that commit's package metadata. Keep the course
descriptor and output outside every pinned topic, including directory aliases;
the descriptor cannot itself be named `course.lock.json`.

Success atomically replaces `course.lock.json` beside `course.json`. The lock
contains each repository, immutable commit, topic manifest hash and complete
ordered lesson identities. If a topic changes during generation, commit the
intended content and retry. This command generates local release material only;
it does not push Git, create a remote release, install content or enable a course.


## Server reads of installed snapshots

This release also provides a read-only server API at
`@local/vibe64-training/server/installed-content`. It does not add a learner UI or
an installation command. Create the reader with the server's absolute
`systemRoot`. `readTopic({topicId,commit,topicHash})` requires the trusted topic
hash from the course lock or saved attempt, then checks
`training/content/<topicId>/<40-character-commit>/`, whose `pin.json` contains only
`schemaVersion:1`, `topicId`, `release`, `repository` (`owner/learn-topic`), `commit`
and `topicHash`. `bundle.json` and `files/` must be the exact original CLI bundle.
The pin’s canonical repository must match the source package’s repository URL.
Local cache self-consistency is insufficient: its topic hash must also match the
trusted caller pin, which binds topic metadata, release, repository and lesson order.

The reader freshly validates the declared inputs and complete ordered manifests,
rejecting aliases, symlinks, missing, changed or unrecorded files.
`readLesson({topicId,commit,topicHash,lessonCode,lessonHash})` requires the exact published
lesson and returns its checked teaching text, anchored rubrics and visual metadata.
Drafts and different hashes fail; an invalid or missing snapshot reports that the
owner must reinstall the verified revision. These reads never repair data or run
exercise/check scripts. They do not consult catalogue enablement: disabling a
release must not silently substitute new content into an existing pinned attempt.
Authorization to start a lesson and durable assessment progress are not provided
by this API.
