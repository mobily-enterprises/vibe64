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

Lessons use lesson format v2 (see **Lesson format v2: steps** below). Format 1
is retired: `vibe64-training validate` and `publish-manifest` refuse a v1 lesson
("Lesson X uses retired lesson format 1. Author it in format 2 with steps."), so
no new course release can contain one. Installed v1 lessons, and `bundle`, which
the installer uses, still read and verify them so earlier results stay valid.
The topic manifest itself stays schema version 1.

For reading existing content, a v1 lesson descriptor declares schema version 1, `code`, `title`, `document`,
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
`evidence: {producer, operation, check?, explanationRequired?, files?}`. Supported producers
are `workspace`, `colleague`, `exercise` and `code`. Exercise and code evidence
require an exercise and a declared check; other producers cannot execute checks. Declare checks as
`checks: [{id,file,assets?,kind?,timeoutSeconds?}]`. Declare auxiliary check inputs in `assets`, relative to the lesson descriptor.
The validator includes these files but never executes them.
The managed application execution owner will run approved pinned checks; teaching
tools do not gain arbitrary shell access. Demonstrations cannot earn learner passes.

An exercise lesson may optionally declare the practice app's data-changing routes
as `appRoutes: [{method, path}]`, at most 16 unique entries. `method` is `POST`,
`PUT`, `PATCH` or `DELETE`; `path` starts with `/`, has no query, fragment or
trailing slash, and each segment is a literal or `:id` (the Preview replaces
numeric and UUID segments with `:id`). For the notes exercise:
`"appRoutes": [{ "method": "POST", "path": "/api/notes" }]`. A failed request on
any other path is still reported, as `other`, so route segments that might carry
typed text never leave the learner's browser. Routes are validated with the
lesson but no current reader consumes them (they labelled the retired Learning
watch's hints); they never grade, and a lesson without an exercise cannot
declare them.

### Lesson format v2: steps

A v2 `lesson.json` declares `schemaVersion: 2` and keeps `code`, `title`,
`prerequisites`, `estimatedMinutes`, `visuals`, `exercise`, `checks` and
`appRoutes` exactly as above. It has no `document` and no `assessments`:
an optional `notes` file (background reading) and 1–32 ordered `steps` replace
them. The fixture `tests/fixtures/training/steps-v2/` is a complete, validating
topic with every step kind; the copyable template is `docs/templates/learn-topic/`.

```json
{ "id": "open-preview", "title": "Open the Preview",
  "body": "steps/open-preview.md",
  "visual": { "id": "flow",
              "play": [{ "name": "send", "parameters": { "label": "GET /" } }] },
  "guide": { "target": "preview", "navigate": true, "caption": "Your app runs here" },
  "check": { "kind": "auto", "check": "app-response", "files": [] },
  "required": true }
```

- `id` is a unique lesson ID; `title` is shown in the step list; `body` is a
  Markdown file relative to the lesson descriptor. Bodies and `notes` are
  included in lesson identity; two steps may share one body file.
- `required` steps decide completion: the lesson is complete when every
  required step has passed. A lesson needs at least one required step.
- `visual` (optional) shows one of the lesson's declared `visuals`. `play`
  lists at most 16 commands to run in order; each `name` is a command the
  visual declares, and `parameters` is a `{name: string}` map that supplies
  every required parameter within its `maxLength` and nothing undeclared.
- `guide` (optional) points at a real Vibe64 place: `target` is one of the
  declared guide places (`preview`, `dashboard`, `database-erd`,
  `database-data`, `files`, `changes`, `git-log`, `session-info`,
  `architecture`, or `learning` for the **L** button). `navigate:true` opens
  it as well as highlighting it (`dashboard` can only be pointed at).
  `filePath` is allowed only with `files` and is a relative project path
  without `..`. `caption` is at most 256 characters.
- `check.kind` is one of:
  - `auto` — runs the declared check named by `check` (one of `checks[].id`)
    and needs the lesson's `exercise`. A response check names no `files`
    (omit them or use `[]`). A code check (`kind:"code"` in `checks`) names
    1–8 distinct exercise-relative `files`, the same file rules as a v1 code
    question above.
  - `choice` — `question` (at most 2000 characters), 2–8 `options` and
    `answer`, a non-empty list of unique option indexes (0-based, in range).
    The learner passes by selecting exactly the answer indexes.
  - `review` — the learner's own AI reviews their practice work against the
    author's `rubric` (at most 600 characters, shown to the learner as the
    step's check line) when the learner presses **Check my work**. It needs
    the lesson's `exercise`. `evidence` (optional, default `["changes"]`) is
    `["changes"]` or `["changes", "conversation"]`; see
    [Review checks](#review-checks).
  - `self` — the learner ticks **Done** after doing the step.
  - `none` — reading only; cannot be `required`. The learner may press
    **Mark as done**, which records a learner-origin `read` pass (a bonus that
    never counts toward completion).
  A kind declares only its own fields; anything else is rejected.

### Beats: the step bar walks the learner through a step

A step may end its body Markdown with a fenced `beats` block. The lesson step
bar (yellow, above the page in Learn mode) plays the beats one line at a time
while the learner stays where they are; the reader never shows the block.

````md
```beats
show preview: This is your app, running.
show chat: This is the coding chat. You ask for changes here.
do send-message: Ask it: "Make the heading green"
do agent-finished: Wait while the agent works.
do reload-preview: Press Reload preview to see the change.
check done: Press Done when the heading is green.
```
````

One beat per line: `<show|do|check> <target>[ <path>]: <text>`.

- `show <place>` points at a place and moves on by itself after 5–12 seconds
  (longer text stays longer; never with reduced motion, where the learner
  presses Next). Text is at most 160 characters.
- `do <place|action>` waits for the learner: to be at a place, or to do an
  action (`send-message`, `agent-finished`, `file-opened <path>`,
  `app-pressed`, `colleague-minimised`). `do send-message` text holds exactly one quoted prompt (at
  most 500 characters). Only `file-opened` takes an argument, a relative
  practice project path without `..`. A do beat completes when the page shows
  its place, or when its activity happens in the lesson's practice project
  during its step, after the step's previous do beat was done; activity from
  earlier in the step counts when the beat begins (`send-message`: a message accepted in the chat;
  `agent-finished`: the agent's turn ends; `file-opened`: that file opens in
  Files; `app-pressed`: the practice App's button; `colleague`, `save`,
  `reload-preview`: Colleague opens, a Save succeeds, the Preview reloads;
  `learning`: the learner presses **L**, which counts when they are back in
  Learn; `colleague-minimised`: Colleague closes or minimises).
  **Do it for me** does it for the learner (sending a `send-message` prompt as
  the learner's Main chat message, stored as sent by the lesson), except Save,
  `agent-finished`, `app-pressed`, `colleague-minimised` and `learning` (which
  it only points at). A `check done` step whose do beats were
  all detected is recorded done without a press.
- `check <auto|done>: <text>` is the step's own check (`auto` for
  `check.kind:"auto"`, `done` for `self`): at most one, and the last line.
  `check review` (for `check.kind:"review"`) takes no text: the bar shows the
  step's `check.rubric` from `lesson.json`, its single source.
- Places: `preview`, `dashboard`, `database-erd`, `database-data`, `files`,
  `changes`, `git-log`, `session-info`, `architecture`, `learning` (the **L**
  button), `lesson` (the step bar's **Lesson** button), `chat` (the coding chat), `colleague`,
  `courses`, `lesson-bar` (the bar itself), `save` and `reload-preview`.
  `dashboard` and `lesson-bar` can only be shown.
- 1–8 beats. Only `lesson`, `lesson-bar`, `courses`, `learning`,
  `colleague`, `colleague-minimised` and `check done` work in a lesson without an `exercise`; every
  other beat needs the practice project.
- A step with beats has no `guide`; **Show me** plays its beats from the first.

`vibe64 training validate` rejects an unknown kind, place or action, an
argument other than a `file-opened` path, a check that does not match the
step's check kind, a second or non-final check, a block that is not closed or
does not end the body, and beats together with a `guide`. Back and Next in the
bar move by beat into the neighbouring steps; after the last beat the bar shows
the step's own verdict control (Done, Mark as done, Check my work, or Answer in
Lesson for a choice) and Next step. **Lesson** on the bar shows the whole step
text in the Lesson pane in one click, so a beat never needs to repeat the body. Steps never advance by themselves.

**Check verdicts are final.** Verdicts come from the step's declared check: an
automatic check, the choice comparator, a review check (the learner's own AI
judging their work against the author's rubric), or the learner's tick on a
`self` step (or mark on a `none` step). A pass is never replaced. Colleague
teaches and explains but never passes a step and never runs a review. Prefer
an automatic check where a deterministic check can decide; write step bodies
so a learner can follow them without AI.

### Review checks

A review step judges work that a deterministic check cannot, for example "the
heading is green and nothing else broke":

```json
{ "id": "green-heading", "title": "Make the heading green",
  "body": "steps/green-heading.md",
  "check": { "kind": "review", "rubric": "The heading is green and nothing else broke.",
             "evidence": ["changes", "conversation"] },
  "required": true }
```

- The rubric is the only requirement. Write it as what the finished work
  shows, in words the learner understands; it is shown to the learner and to
  Colleague.
- Evidence `changes` is the practice session's work against the commit the
  lesson started from, uncommitted work included: the changed files with
  added/removed line counts and their diff, at most 60,000 characters (20,000
  per file). Binary files, larger files and files beyond that budget are
  listed without their text; agent guidance folders (`.agents`, `.claude`,
  `.codex`, `.opencode`) are left out. `conversation` adds the last 20 turns
  of the session's Main chat (the learner's and the agent's text, at most
  40,000 characters). Work the coding agent did at the learner's request
  counts unless the rubric says the learner must do it themselves.
- **Check my work** runs only from the learner's own browser, on the
  learner's own AI account: the Helper route of their workflow in **AI
  Accounts → Model routing** (workload `lesson_review`, input at most 160,000
  characters, 180 seconds). Vibe64 never pays for or resells it.
- The reviewer returns Passed or Not yet, a comment (at most 600
  characters), a hint for Not yet (at most 300) and up to six rubric points.
  The result is saved as a `review` step result; Passed is final.
- Nothing is recorded, and nothing runs, while the coding agent is working
  ("Wait until the agent finishes") or when there are no changes yet ("No
  changes yet"). Pressing again with unchanged evidence returns the saved
  review without another AI call. A missing Helper route, a provider error or
  timeout, a reply outside the fixed output schema or unreadable evidence
  records nothing; the learner tries again.
- The evidence is data, never instructions: the reviewer is told to follow
  only the rubric, so a prompt injected into the learner's project can at most
  pass the learner's own practice step.
- Only lessons started after a review-capable release record the commit their
  practice session started from; an older attempt is asked to restart before
  its work can be reviewed.

Choice answers stay on the server. The lesson descriptor is never served to a
browser: a step body, `notes`, visual SVG/controller/asset or exercise file
cannot be any v2 lesson descriptor of the topic (for example, an exercise
`source` of `.` beside `lesson.json` is refused). The installed reader strips
`answer` from every projection; only the server comparator reads it.

### Authoring a code question

A code question is an `auto` step whose `check` names a code check and whose
`files` name the exercise files the learner edits (the fixture
`tests/fixtures/training/steps-v2/` contains one):

```json
"exercise": { "kind": "bundled", "source": "app", "reuse": "attempt" },
"checks": [{ "id": "notes-title-required", "file": "checks/notes/title.mjs",
             "kind": "code", "timeoutSeconds": 15 }],
"steps": [{ "id": "require-title", "title": "Refuse empty titles",
  "body": "steps/require-title.md",
  "guide": { "target": "files", "navigate": true, "filePath": "notes.mjs" },
  "check": { "kind": "auto", "check": "notes-title-required", "files": ["notes.mjs"] },
  "required": true }]
```

- `files` lists 1–8 exercise-relative paths the learner edits. Each must be an
  ordinary bundled exercise file (no `..`, absolute path, `.git`,
  `node_modules` or `.genesis` segment) and may appear once.
- The check must declare `kind: "code"`. Omitted `kind` means the existing
  `response` kind. `timeoutSeconds` (1–60, default 15) is allowed only on a code
  check.
- `reuse:"attempt"` is the supported exercise mode for code checks.
- The check result alone is the verdict; there is no explanation rubric.

A retired v1 lesson declared the same check as `code` evidence of a practical
assessment (`tests/fixtures/training/code-practical/`); only `code` evidence may
name files or a code check, and an `exercise` check must not be a code check.

The check runs with Node in the managed execution owner on a private copy laid
out like the topic: the pinned exercise at its topic path, with only the
declared files replaced by the learner's saved bytes, plus the pinned check and
its assets. Its working directory is the exercise copy, its environment is
empty, output is limited to 4 KiB and it has no dependency installation, so an
exercise and its check must need no packages. Import learner code relative to
the check (for example `new URL("../../app/notes.mjs", import.meta.url)`); the
same command works in the topic checkout. The check reads one JSON object on
stdin, `{check, filesHash, files:[{path,sha256}]}`, and prints exactly one JSON
line echoing `check` and `filesHash`:

- exit 0 and `{check, filesHash, outcome:"verified"}` — the code is correct;
- exit 1 and `{check, filesHash, outcome:"incomplete", reason}` (reason at most
  256 characters) — shown to the learner as "Not yet: …".

A different `filesHash` or any other success-shaped output is rejected as an
invalid check result. A check stopped by its timeout, or learner code that
crashes the check before it prints a result, is "not yet passed" with a fixed
explanation. stderr is ignored. Use plain `node:assert`-style logic rather than
`node --test`, whose reporter writes to stdout.

Authorship: when the learner first opens a code step in an attempt, Vibe64
records the SHA-256 of each declared file in the live practice project as that
step's starting point. Each save from the practice project's **Dashboard →
Files** editor while a lesson is in progress in that project is recorded
server-side with its base hash, intended hash and saved hash. The ledger belongs
to the attempt (`training/users/<user-key>/code-ledgers/<attemptId>.json`), so
code from an earlier attempt never counts, and ending the attempt removes it. At **Check now** the chain from the starting point through those
saves must reach the current bytes exactly; otherwise the check is not run and
reports "needs an independent attempt: other edits detected in `<file>`". There
is no technical write-deny for agents: an agent edit in a declared file voids
the attempt through this ledger. The check is learner-run code on the learner's
own machine and has no network isolation: for hosted use, sandboxing and network
denial of the check job are an open gap.

An optional exercise uses `{kind:"bundled", source, reuse:"attempt"}`. Continued
work uses `reuse:"sequence"`, `sequenceId` and `sequenceMode:"create"|"continue"`.
One creation precedes continuations in topic order, with the same source directory.
Each lesson keeps its own attempt/progress. Missing learner work requires an explicit
recovery choice, never an invented practical pass. External exercise repositories
are not supported by this local authoring increment.

## Visuals and reproducible identity

A visual allows at most 32 states, commands and auxiliary assets, and each command
allows at most eight parameters. Exact bounds are accepted; excess items fail
validation even when their IDs, states and files are otherwise valid. Optional
asset lists may be omitted.

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
A preview course is for the workspace owner to review: `lesson.start` admits its
published lessons only when the actor is the workspace owner (on local Vibe64,
the OS user), and refuses everyone else with `VIBE64_TRAINING_COURSE_PREVIEW`.
`courses.list` reports `canTryPreviews`, and Courses shows the owner the usual
start buttons beside the **Preview course** chip. The started attempt is an
ordinary saved lesson. Releasing the course offers **Start lesson** to everyone; draft lessons and disabled courses stay refused.

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

### Lesson 0 is the shared introduction

The getting-started course starts with V64-START-00 **Introduction to Vibe64**,
a tour of the editor on its own small practice project (the coding chat,
Preview, Dashboard, Save and Git log, Colleague, the Lesson pane, Courses and
**L**). It works the same way locally and on hosted Vibe64, and its coding-chat
steps are optional so it can be finished before an AI is connected. Connecting
an AI is not a lesson: it belongs to the AI setup screen (**Account settings →
AI Accounts**), which the introduction only points to.

Every lesson stays in the shared topic and must work the same way on both
hosts. Lessons without a practice project remain supported (the Lesson pane
fills the page), but the shared course does not use one.

## Server reads of installed snapshots

This release provides a read-only server API at
`@local/vibe64-training/server/installed-content`. It does not add a learner UI or
a terminal installation command. Create the reader with the server's absolute
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
lesson. For a v1 lesson it returns its checked teaching text, anchored rubrics
and visual metadata. For a v2 lesson it returns the verified bundle (`pin`,
`lesson`, `manifest`, `hash`, `descriptorPath`), `steps` (each declared step plus
its `bodyText`), `notesText` when the lesson declares notes, and `visuals`; there
is no `document` or `rubrics`. Every lesson projection — `readTopic`,
`readLesson`, `readAdmissionIdentity` and exercise metadata — omits each choice
step's `answer`.

`readChoiceAnswer({topicId,commit,topicHash,lessonCode,lessonHash,stepId})` is the
server-only comparator accessor. It applies the same verification and draft rules
and returns `{pin,lessonCode,lessonHash,stepId,answer}` for one v2 choice step; it
refuses a v1 lesson, an unknown step or a step of another kind. Never return its
result to a browser or assistant. `compareChoiceAnswer(answer, selected)`, exported
by the same module, passes only when `selected` lists exactly the answer indexes
(any order, no duplicates).

`readVisual({topicId,commit,topicHash,lessonCode,lessonHash,visualId})` reuses that
same lesson verification and selects only its declared visual ID. It returns
`pin`, `lessonCode`, `lessonHash`, `id`, `descriptorPath`, parsed `visual` metadata,
and `svg`, `controller`, `assets`. Each file record is `{path,bytes}` with a Buffer
of the exact manifest-verified bytes; paths are snapshot-relative, derived from
that visual descriptor rather than supplied by the caller. Assets keep their
declared order and are an empty array when omitted. Teaching text, checks and
exercise files are not part of this result. Existing descriptor bounds and the
1 MiB per-file limit apply. This internal read does not serve browser resources,
execute the controller, render or sanitize SVG, authenticate a learner, or save
visual state. Those operations still require an application-owned host.

`readCheck({topicId,commit,topicHash,lessonCode,lessonHash,checkId})` selects only an
exact declared check from that verified published lesson. It returns `pin`,
`lessonCode`, `lessonHash`, the original `check` descriptor, `file` and ordered
`assets`. File records contain snapshot-relative `path` and exact verified Buffer
`bytes`; check and asset references resolve relative to the lesson descriptor.
Assets are empty when omitted. The original manifest/hash, alias and 1 MiB per-file
bounds apply. Caller paths cannot replace the declaration. A check may be outside
the bundled exercise directory, so its verified bytes must not be replaced with a
mutable project copy. This server-only read performs no execution, route/tool
exposure, evidence admission or grading; the admitted native host owns those steps.

`readExercise({topicId,commit,topicHash,lessonCode,lessonHash})` selects only that
verified lesson's declared bundled exercise; a lesson without one fails. Its
result contains `pin`, `lessonCode`, `lessonHash`, original `exercise` metadata,
snapshot-relative `sourcePath`, and `files` in manifest order. Each file record is
`{path,bytes}` with an exercise-relative path and exact verified Buffer bytes.
The caller cannot override the declared source or request another file. The
existing bundle determines the files below that source; the read does not scan
for additional inputs. Manifest records do not include file modes, and this API
does not return or preserve them. It performs no copying, provisioning, Git,
fetching or execution and grants no project/Preview access. An admitted
application operation still owns preparation and ordinary access checks.

The existing `@local/vibe64-project/server/managedProject` owner exports
`verifyManagedProjectSource({projectRuntimeRoot,branch,files,runCommand})`, returning
`{branch,commit}` without writes. The admitted caller holds the original project
source lock, rereads the managed project and exact attempt association, and proves
the reserved initial session is truly absent. `files` are the fresh installed
reader's `{path,bytes}` records; the repository path is derived, never supplied.
The proof accepts at most 512 files, 32 MiB total and 1 MiB per file. It compares
every committed path and implied parent directory, size, ordinary `100644` mode
and Git blob hash against those exact bytes, excluding no canonical entries.
Extra empty trees, unsafe modes, lossy filename encoding, storage aliases and
missing or changed content fail without repair. The byte-only exercise contract
requires the first initializer to copy regular nonexecutable files.

After releasing source exclusion, the caller passes
`repositoryBranch:{name:branch,expectedCommit:commit}` to ordinary session creation
with the saved initial session ID. It must not nest session creation inside that
source lock. Existing branch guards retain the exact proved object or refuse;
the proof does not freeze later branch changes or assert app readiness. An
existing session, including a blocked or partial one, uses its original recovery
and preserves learner edits rather than repeating first-seed checks. This internal
proof adds no learner action, copier or provisioning path.

Drafts and different hashes fail; an invalid or missing snapshot reports that the
owner must reinstall the verified revision. These reads never repair data or run
exercise/check scripts. They do not consult catalogue enablement: disabling a
release must not silently substitute new content into an existing pinned attempt.
Authorization to start a lesson and durable assessment progress are not provided
by this API.

## Server composition for an isolated author preview

The original reader accepts the trusted construction option
`createInstalledTrainingContent({systemRoot,allowDraftLessons:true})` for an
author-preview composition. Its default remains `false`; read inputs cannot
enable drafts. Draft reads retain the same exact pin, manifest, file/hash,
resource and alias checks. This option is not author authorization or learner
admission, and normal learner readers must not use it.

`createTrainingLearnerState({systemRoot,contentSystemRoot,content})` may receive
that exact configured reader. The existing `systemRoot` owns progress and locks;
the composing server must choose a separate preview state root and retain the
actual authenticated actor. The unchanged writer, schema, CAS and receipt owners
then keep trial evidence outside normal learner progress. Without `content`,
the original published-only reader still uses `contentSystemRoot`, defaulting to
`systemRoot` as before.

`createTrainingTeachingBrief({systemRoot,learners,content})` may consume those
same owners. Absent dependencies retain the normal construction; default learners
use the selected content reader. Its exact-pin checks, rubric/text projection,
retained provenance and size limit remain. These are internal prerequisites only:
author admission, snapshot selection, scoped teaching/assessment/presentation
routing and a usable preview command are not supplied by this composition.

## Owner-controlled snapshot installation

`@local/vibe64-training/server/content-installer` exports
`createTrainingContentInstaller({systemRoot}).installTopic({sourceRoot,pin})`.
The caller is an admitted server/operator operation, not a learner or Colleague
request. It chooses the canonical absolute system root and local topic repository.
The exact schema-version-1 pin contains `topicId`, `release`, canonical `repository`,
40-character `commit` and trusted `topicHash`, as well as `schemaVersion`. Map the
course lock's topic `manifestHash` to `topicHash` at that owning operation.
This low-level service does not authenticate callers, fetch Git repositories,
enable courses or grant access. Its callers are the operator `install-topic`
command, the owner author trial and the official catalogue installer below.

Installation reuses the clean committed-source proof, original bundle command
and installed reader. It checks the approved identity before and after bundling,
validates a new private staging snapshot and publishes the complete directory
under `training/content/<topicId>/<commit>/`. A persistent per-revision file lock
excludes cooperating installers. A busy revision returns
`VIBE64_TRAINING_INSTALL_BUSY` (409); retry after that operation finishes.
Atomic directory rename provides complete visibility under that lock; outside
processes must not modify this installer-owned namespace during publication.

A matching verified snapshot returns `installed:false`, without rewriting it;
the prepared source need not still exist for this retry. A newly installed one
returns `installed:true`. A different approved pin, malformed or changed snapshot,
empty destination, dirty source, symlink or directory alias is refused. Existing
content is preserved. Check the exact source and pin before retrying; do not delete
a learner's pinned revision or substitute a newer one as an automatic repair.

Only the new invocation's UUID staging directory is removed on failure. A process
killed during staging can leave `training/.install-<UUID>` behind; an operator may
inspect and remove that particular abandoned stage after confirming its writer
has stopped. It is not a published snapshot. Persistent files under
`training/.install-locks/` are lock identities, not stale work indicators: do not
unlink them to clear contention. New private parent directories use mode 0700
and the pin uses 0600; existing paths are not recursively repaired. Installation
runs no authored exercise, check or visual controller.

## Installed course enablement

`@local/vibe64-training/server/installed-catalogue` exports
`createInstalledTrainingCatalogue({systemRoot})` with `readCatalogue()`,
`enableCourse({course,lock,expectedRevision})` and
`disableCourse({courseId,release,expectedRevision})`. These are internal server
facilities, with explicit local operator commands documented below and no browser control or Colleague tool.
The one exception is `createCourse({title,topics,expectedRevision})`, described
under [Custom courses](#custom-courses).
An admitted owner caller supplies the approved course and its exact lock together;
the store does not authenticate objects or discover/fetch repositories.

`training/catalogue.json` stores `{schemaVersion:1,revision,courses}`. Each entry
contains the original course definition, its complete generated `lock`, and an
`enabled` boolean. Both definition and lock are immutable for a course ID/release;
changing even its title requires another approved release. A new release is a
separate retained entry. Enablement is the only mutable field. The pilot retains
at most 16 course releases in a file bounded to 1 MiB; it never silently removes
disabled releases. New directories use 0700 and catalogue records use 0600.

Every read freshly verifies all entries, including disabled ones, against installed
topic pins and the original `createCourseLock` owner. The approved lock must exactly
match complete ordered topic/lesson inventories and hashes. Missing or corrupt
disabled content fails catalogue admission closed with owner recovery guidance;
read does not install or repair it. An absent catalogue returns revision 0 and an
empty list without creating files. Corrupt, newer or aliased state is refused.

Explicit changes use the persistent `training/catalogue.lock` OS lock and a current
expected revision. A stale revision always returns
`VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT` (409), even if the desired boolean
currently matches. Read again before deliberately retrying; an old enable must
not override a later disable. At the current revision, an already matching state
returns `changed:false` without rewriting the catalogue. A change returns
`{revision,entry,changed:true}`. Busy locks return
`VIBE64_TRAINING_CATALOGUE_BUSY` (409); never unlink that persistent lock.

The original Core atomic writer publishes catalogue changes. A
`VIBE64_TRAINING_CATALOGUE_SAVE_UNCONFIRMED` error means rename may already have
succeeded: read the current catalogue before retrying, without assuming either
durability or failure. No startup seed, historical backfill, custom manifest or
exercise execution is introduced. This projection can be reconstructed only by
an explicit owner operation from the same approved definitions/pins; it is not a
backup of learner state.

The authenticated `lesson.start` action chooses an enabled exact entry from a fresh
read. That read admits the start; a later disable blocks future admissions but
does not revoke work already admitted or a saved attempt. This store does not
serialize its lock with reservation writes or add an action/authentication layer.
Resume continues through the saved learner pin independently of the catalogue.

### Custom courses

The workspace owner can create a custom course from Learning → **Courses** →
**New course**, or through the owner-only `vibe64.training.courses.create` action
(`POST /api/vibe64/training/courses` with `{title,topics,expectedRevision}`).
`courses.list` reports `canCreateCourses` for the signed-in person and each
course's ordered `topics` with their installed titles. On local Vibe64 the OS user
is the owner; on hosted Vibe64 only the workspace owner may create one, through
the existing `ownerRequired` action check.

`createCourse` adds no storage and no new record format. It accepts 1–32
different whole topics, each an exact `topicId`/`release` already pinned by an
**enabled released** catalogue course, and resolves them through those existing
lock pins and the installed snapshots. It builds an ordinary course definition
`{courseId:"custom-<name-slug>",title,release:"1.0.0",status:"released",topics}`,
generates its lock with the original `createCourseLock` and saves it with the
original `enableCourse` (same lock, revision check, 16-release limit and atomic
writer). The entry is therefore immutable like any other release and is verified
on every catalogue read. Lessons keep their exact code and hash, so saved passes
count in every course containing them; lesson content never changes. An identical
retry returns `changed:false`; the same name with a different definition returns
`VIBE64_TRAINING_COURSE_EXISTS`. Other refusals are
`VIBE64_TRAINING_COURSE_INVALID`, `VIBE64_TRAINING_COURSE_TOPIC_UNAVAILABLE`,
`VIBE64_TRAINING_COURSE_LIMIT` and the original catalogue revision/busy/save
errors. To retire a custom course, disable its exact release with
`vibe64 training disable-course custom-<name-slug> 1.0.0 <system-root> <revision>`.

Course progress in the **Courses** pane is read-only: `learning.read` adds
`lessonProgress`, one `{lessonCode,lessonHash,required,passed,completed,open}`
summary per saved lesson pin, computed from the same verified passes as
`completion`. The browser joins it with `courses.list` to show lesson statuses and
"N of M lessons complete" (required lessons, or all lessons when none is required).

## Private learner reservations

`@local/vibe64-training/server/learner-state` exports
`createTrainingLearnerState({systemRoot})` with `readState({actor})`,
`reserveAttempt({actor,requestId,expectedRevision,pin})` and
`resumeAttempt({actor,attemptId})`. These are internal server facilities, not
learner HTTP routes or Colleague tools. The composing action must supply its
freshly authenticated actor and admit a new start against an enabled installed
course. Passing an object to this store is not authentication.

The pin contains `{course:{courseId,release},topic:{schemaVersion:1,topicId,release,
repository,commit,topicHash},lesson:{code,hash}}`, selected together from the same
approved course lock. The topic hash is that lock entry's `manifestHash`. Installed
published lesson reads verify the exact topic and lesson identity before reserve,
replay and resume. The store does not infer course membership or enablement from
topic metadata. Resume uses the stored pin, without selecting a newer release.

The actor's nonempty `uid ?? username` uses the existing base64url key convention,
without a local fallback. State lives outside projects under
`training/users/<user-key>/`: `progress.json` (schema version 2) is the authority
for revision, the one attempt in progress (`activeAttemptId`), the completed
lessons and the retained attempts; `active-lesson.json` is its derived summary.
The reservation contains a server UUID, exact pin, creation time, retry IDs,
server-derived project slug `training-<attemptId hex>` (only for a lesson that
declares an exercise) and `reserved` phase. No project/session readiness,
assessment outcome or grading evidence is fabricated. New directories use 0700,
records 0600. Files are bounded to 128 KiB and an attempt retains at most 64
distinct reservation request IDs; it never silently drops retry history.

One lesson is in progress at a time. Reserving the same pin again returns the
attempt in progress (adding the request ID); a different pin is refused with
409 `VIBE64_TRAINING_LESSON_IN_PROGRESS` and `details:{attemptId,lessonCode,lessonTitle}`
before any revision check, so the caller can archive it first. A lesson in the
retired format 1 is refused (`VIBE64_TRAINING_LESSON_VERSION`). A learner keeps
at most 32 attempts: a new reservation drops the oldest ended attempts (with
their reader position) until the count and byte bounds fit, and is never
refused for space. `completedLessons` (at most 256 `{code,hash,completedAt}`)
records every finished lesson content and is never pruned, so the course list
keeps a lesson completed after its attempts are gone.

`endAttempt` takes reason `finished` (refused with
`VIBE64_TRAINING_LESSON_INCOMPLETE` unless every required step has passed; adds
the lesson to `completedLessons`), `archived` or `deleted`. After the end is
saved it removes that attempt's step results and code ledger. The archive or
deletion of its project and conversation is the lifecycle owner's job.
`activeAttemptForProject({actor,attemptId})` returns the attempt in progress
when it owns that practice project, or null.

Learn mode is a separate per-learner flag, `learning-mode.json`
`{schemaVersion:2,learnerId,on}` (absent means off). `setLearningMode({actor,on})`
saves it and never ends or changes the lesson in progress.
`readLearningMode({actor,includeTitle?})` returns
`{on,currentAttemptId,lessonCode,lessonTitle,practiceSlug}`: the current attempt
is the one in progress, `lessonTitle` is filled only with `includeTitle`, and
`practiceSlug` is empty until preparation begins.

Step results (`step-progress.json`, schema version 3) belong to the attempt in
progress: `{learnerId,revision,attemptId,lesson,results,receipts}`, at most 64
results. A result's `kind` is `auto`, `choice`, `review`, `self` or `read` (a
`none` step the learner marked done), matching the pinned step's check. A
`review` result has origin `check`, evidence `{reviewId,evidenceHash}` and
`review:{comment,hint?,points?}` (single-line text; only a review result has
it). A new attempt starts with none. `readStepProgress({actor,attemptId?})`
and `readAttemptRecord({actor,attemptId})` read them.

`runReviewExclusive({actor},operation)` serializes one learner's reviews with
`review.lock` (a second review while one runs is refused with
`VIBE64_TRAINING_REVIEW_BUSY`). It gives the review owner its private Helper
root `review-helpers/` and the retained Helper receipt `review-helper.json`
`{schemaVersion:1,learnerId,helper}` (`helper` is `null` once cleaned up), so a
review that stopped part-way is cleaned before the next one starts.

The published `20261008-learning-practice-history` upgrade reads vibe64 0.1.35
version 1 progress through the frozen `practiceHistoryReader.js`
(`readState`, `readExerciseProjectScope`), moved unchanged from the earlier
learner state; the live store no longer reads that format.

The same internal store adds `beginPreparation({actor,attemptId,expectedRevision})`,
`recordPreparationReady({actor,attemptId,initialSessionId,expectedRevision})` and
`recordPreparationFailure({actor,attemptId,initialSessionId,expectedRevision,stage,code,message})`
and `recordPreparationStart({actor,attemptId,initialSessionId,expectedRevision,startCommit})`.
These are observation writers, not a provisioner, learner action or authority to
create an arbitrary project. Only an admitted server caller may compose them.

When the session owner refuses the practice session because the learner has no
usable AI yet (`vibe64_assistant_workflow_unavailable` or
`vibe64_assistant_role_unconfigured`), preparation records and throws
`VIBE64_TRAINING_PRACTICE_AI_REQUIRED` (409) with learner wording that asks them
to set up their AI and continue the same lesson. `lesson.read` and
`learning.read` return the saved failure's `code` and `message`, so the step bar
and Courses offer the AI setup instead of beats or a generic error.

An untouched `{phase:"reserved"}` remains valid and contains no session identity.
Explicit begin atomically saves `{phase:"preparing",initialSessionId}` before any
external effects. The immutable ID is `training-<attempt-UUID>`, validated by the
original Runtime session-ID owner. Retries recover it rather than selecting a
current/newest session. Project/session association is correctness provenance;
ordinary project and Preview access rules continue to apply.

A trusted caller must inspect the exact associated project/session and actual
setup/readiness through their existing owners before recording
`{phase:"ready",initialSessionId,observedAt}`. This is a server-timestamped past
observation, never a guarantee of current Preview liveness or an assessment pass.
Observation timestamps may move backward; revisions, immutable identities and
allowed phases determine whether an older summary is recoverable.
A failure records `preparing` with `failure:{stage,code,message}`; stages are
`project`, `session` or `setup`, code is at most 64 characters and the single-line
recovery message at most 512. It retains the ID and removes any old ready time.
Begin replays do not clear failures. A fresh successful observation can clear one.
Preparation records the verified exercise commit as `startCommit` (a 40- or
64-character Git object ID) just before it creates the practice session from
it; a retry before the session exists records it again, a ready attempt keeps
it, and every later phase carries it. A review check reads the learner's
changes against it. Attempts prepared before this field existed have none.
Matching observation replays precede revision checking and return `replayed:true`
without writing; a different stale observation conflicts rather than overriding
newer state. No project/session effect executes inside the user-state lock.

`runPreparationExclusive({actor,attemptId},operation)` coordinates an admitted
server operation across project/session/setup effects using a distinct persistent
per-user `preparation.lock`. It requires the saved actor-owned attempt and fresh
installed pin before locking, rechecks both after acquiring the original Kernel
lock, awaits `operation()` and releases in `finally`. It returns that operation's
result without changing preparation state or declaring readiness. A competing
preparation, including a nested call for the same user, receives
`VIBE64_TRAINING_PREPARATION_BUSY` with status 409; retry the same attempt after
the holder finishes. Different learners use independent locks.

The wrapper does not hold `state.lock` around the callback, so the admitted owner may explicitly
resume/begin/report through the existing typed operations and their short locks.
It must still save the initial session identity before effects and handle an
unconfirmed write honestly. Bare state writes do not acquire the preparation
lock: all cooperating provisioners must enter this operation. Existing optional
preparation locks are checked for empty, canonical regular files; absent reads
create nothing. The stopped-writer recovery procedure holds both lock inodes,
while its independent-writer stopping precondition remains required. No schema,
journal, authentication, automatic repair or learner action is added.

Phase-changing progress still publishes before the derived summary. A read may
project a valid lower-revision predecessor, with the same immutable identities,
without writing. An explicit locked operation reconciles it. A reserved summary
needs two later revisions to reach ready or pending failure; begin alone needs
one. Changed ready observations need two revisions through failure, while an
unchanged ready alias needs one. These distances follow typed writes, not clock
ordering. Same-revision conflicts, future or incompatible phases, and changed
session IDs fail closed.
Unconfirmed progress writes require reading/retrying the same typed operation
before effects; a saved-reservation summary error means progress was published,
not that the exercise is ready. Resume keeps its exact pin independently of
course enablement.

These internal operations are not activated by an action or startup path. Before
a release enables new preparation/provenance writes, apply the registered
`20261006-training-preparation` no-op compatibility ledger boundary through the
candidate upgrade command with writers stopped. Older registries refuse its newer
ledger; registration alone does not activate these operations. The script converts
no application files and requires no data backup. Old reserved bytes stay unchanged,
and only explicit begin assigns their session ID. See [state upgrades](state-upgrades.md)
for the operator check/apply workflow.

Core's existing project record can now retain optional trusted creation metadata:

```json
{
  "training": {
    "schemaVersion": 2,
    "learnerKey": "NDI",
    "practiceId": "12345678-1234-4234-8234-123456789abc",
    "pin": {
      "course": { "courseId": "intro-course", "release": "0.1.0" },
      "topic": {
        "schemaVersion": 1,
        "topicId": "intro-topic",
        "release": "0.1.0",
        "repository": "example/learn-intro",
        "commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "topicHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      "lesson": { "code": "INTRO-01", "hash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
    },
    "exercise": { "kind": "bundled", "sourcePath": "training/exercises/app" }
  }
}
```

These are illustrative identities, not an installed course. An admitted server
owner must supply the canonical base64url learner key from authenticated identity,
the practice project's ID, the saved attempt's exact pin, and the fresh installed reader's bundled source
path. Core validates shape and bounded values; it does not authenticate this
object or inspect installed content. The marker has no session field: learner
state owns the initial session identity. It is copied at creation and cannot be
added, removed or changed by later project metadata updates. Ordinary projects
have no marker; normal project and Preview access continues unchanged.
Invalid stored markers fail reads without repair. This metadata-only increment
adds no browser input, provisioner, action or startup writer. The coordinated
`20261006-training-preparation` no-op ledger boundary must be applied before
future activation; its registered script performs no historical rewrite.

A stable request ID is checked before a stale revision: identical retries recover
the same attempt, while different pins under that ID conflict. A fresh request for
the same active pin reuses the reservation at the current revision. A different
active pin requires resuming the existing attempt; no implicit restart is offered.
Progress is atomically written first through the original Core writer, then the
active summary. An unconfirmed progress save requires retrying the same ID before
any provisioning, because rename may already have succeeded. A summary error
explicitly reports that the reservation was saved; retry or resume recovers that
identity rather than creating another exercise.

Reads create no files and report whether the stored summary is current. Explicit
reserve/resume may rebuild a missing or semantically identical stale valid summary
under the existing persistent per-user OS lock. Corrupt, conflicting, unsupported
or cross-learner records are refused, not repaired. A busy lock returns
`VIBE64_TRAINING_STATE_BUSY` (409); retry the same operation later, without unlinking
`state.lock`. There is no startup conversion, learner start screen, project
provisioning, assessment submission, grading or automatic backup in this increment.
Project archives exclude `training/users`. Operators use the explicit
[stopped-writer checkpoint and restore procedure](training-state-recovery.md),
which preserves private bytes and validates candidates through the existing
reservation and installed-content readers. Its fixture proof does not establish
live multi-machine stopping, off-host retention or power-loss durability.

## Official catalogue installation

`@local/vibe64-training/server/course-installer` exports
`createTrainingCourseInstaller({systemRoot, catalogue, repository})`. It is the
only in-app installation path and reads one GitHub repository, the official
catalogue: `mobily-enterprises/vibe64-learning-catalog` by default, or the
server's `VIBE64_LEARNING_CATALOG_REPOSITORY` (`owner/name`). The browser never
supplies a repository, commit or path.

Catalogue format (default branch):

- `domains.json`: `{schemaVersion:1, domains:[{domainId,title}]}`. The UI calls
  these **topics**.
- `topics.json`: `{schemaVersion:1, topics:[{topicId, repository, domainId?,
  releases:[{release,status,commit,manifestHash}]}]}`. The optional `domainId`
  (one of `domains.json`) groups that topic's courses; a course is listed under
  its first topic's domain, or under **Other courses** when none is declared.
- `courses/<courseId>/course.json` and `course.lock.json`: the exact descriptor
  and the `publish-manifest` lock. The directory name must equal `courseId`.

`listAvailable()` shallow-fetches the default branch into a private scratch
directory, reads the files with `git cat-file` (no checkout), validates them with
the content schemas (strict fields, canonical `owner/learn-*` repositories,
40-character commits, 64-character hashes, lock/course identity and order) and
caches the result for 60 seconds. A fetch failure is
`VIBE64_TRAINING_AVAILABLE_UNREACHABLE`; invalid content is
`VIBE64_TRAINING_AVAILABLE_INVALID`. Reading never installs anything.

`installCourse({courseId, release, actor})` rereads the catalogue, selects that
exact course/lock, and for each locked topic not already installed and verified
fetches its canonical repository at exactly the locked commit (`git init`,
`fetch --depth=1 <commit>`, detached checkout, `HEAD` check) and calls the
original `installTopic` with `topicHash = manifestHash`. That owner re-verifies
the clean commit, canonical source and every byte. It then calls
`enableCourse` with a fresh revision, retrying once on a revision conflict.
Older enabled releases of the same course are then disabled with
`disableCourse` (fresh revision; new starts only). Saved attempts keep their pin
and resume. Installs run one at a time; repeated requests for the same release
share one operation. Git runs through `runVibe64Command` as the daemon with
hooks disabled; no fetched file is executed.

Scratch sources live in `<systemRoot>/training-sources/(catalogue|topic)-<uuid>`
(mode 0700), beside the `training/` namespace that `installTopic` keeps separate
from sources, and are removed in `finally`. The managed exec helper admits the
daemon's generic commands in exactly that one-level directory under
`~/.local/state/vibe64/training-sources/`.

An already enabled exact release is a no-op. A disabled release is re-enabled
only for the workspace owner (`VIBE64_TRAINING_COURSE_DISABLED` otherwise). A new
entry beyond the installed catalogue's 16 retained releases fails before any
download with `VIBE64_TRAINING_COURSE_LIMIT`; nothing is deleted.

The actions are `vibe64.training.available.list` (`GET
/api/vibe64/training/available`) and `vibe64.training.course.install` (`POST
/api/vibe64/training/courses/install`, input `{courseId, release}`). Any signed-in
user may call them, as for `lesson.start`: they can only install hash-pinned
releases from the official catalogue, and arbitrary sources remain operator
commands. Hosts that compose `createTrainingActions` without a `courseInstaller`
return `available:false`.

## Local operator provisioning

These commands run locally under the OS identity that owns the selected Vibe64
system root. Use the candidate installation's `vibe64` command, or
`node bin/run.js training ...` in the public source checkout. Prepare an existing,
canonical, non-root system directory first. Paths may be supplied relative to the
operator's current directory; installed state still rejects filesystem aliases.
No browser or model accepts these paths.

```sh
vibe64 training install-topic /absolute/path/to/learn-topic /absolute/vibe64/state
vibe64 training installed-courses /absolute/vibe64/state
vibe64 training enable-course /absolute/path/to/course.json /absolute/path/to/course.lock.json /absolute/vibe64/state 0
vibe64 training disable-course first-course 0.1.0 /absolute/vibe64/state 1
```

`install-topic` derives the exact pin from the clean committed topic repository;
the original installer verifies it again and atomically installs its immutable
snapshot. A matching retry returns `installed:false`. It does not execute a
check, launch an exercise or enable a course. Commit changes and deliberately
install a new pin rather than replacing retained content.

`installed-courses` returns the freshly verified catalogue, including its
revision, enablement and exact course locks. A missing catalogue reads as revision
zero without creating files. Supply that exact current nonnegative decimal
revision to `enable-course` or `disable-course`. The original catalogue owner
verifies the course/lock against every installed topic, preserves immutable
release definitions, and serializes writes. A stale revision requires a new read
and deliberate retry. An unconfirmed save requires inspecting the current
catalogue before assuming whether it changed. Invalid state is reported without
repair. Do not unlink owner lock files.

Generating `course.lock.json`, installing topic content and enabling a course are
separate deliberate steps. Review and approve exact source commits, hashes and
course release before enablement; none of these commands publishes GitHub content
or deploys Vibe64. Disabling a release blocks new starts through the original
course admission owner, while existing attempts retain their installed pin.
These commands use unchanged installer/catalogue formats and introduce no
startup seed, historical conversion or automatic repair. Normal candidate
state-upgrade and stopped-writer recovery requirements still apply.
