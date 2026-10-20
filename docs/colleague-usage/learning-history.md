# Lesson history and resume

After an interruption, choose **Resume saved lesson** (or **Continue** on its
course) in Learning → **Courses**, or ask Colleague to resume the exact saved
lesson; see [Choosing lessons and courses](learning-mode-ui.md). These rules
apply on desktop and phone.

## Ending a lesson

A lesson whose required steps have all passed is ended by its **Lesson
finished** screen, which opens when your own result completes the last required
step (or from **Lesson finished** in its reader). Otherwise ending or restarting needs your request to
Colleague, which uses the shared `lesson.end` operation after a direct request
or accepted offer; there is no separate restart or discard button. An
installation without its lesson host cannot end lessons, and that refusal is not
a successful end. Leaving or hiding Colleague does not end a lesson.

Ending keeps the attempt's pinned step results (and, for an earlier-format
lesson, its quiz and practical results) and stops no agent work. The reason
`discard` records a learning decision, not project disposal. The practice
project and its session are ordinary and stay yours: ending neither stops,
archives nor deletes them. Dispose of them only on request, with the existing
authorised close, archive or delete operations; an ended learning record is not
disposal. Separate lesson conversations saved before Learning v2 were retired
by the installation upgrade: they no longer appear in Learning, are kept rather
than deleted, and only the installation owner can inspect or restore them.

## Starting again

A fresh start after an end keeps the earlier evidence with its original identity.
A lesson that declares an exercise gets a new practice project and session; a
no-exercise lesson creates neither. Passes for the same lesson code and unchanged
content contribute to that lesson's completion, even when a newer topic or course
release adds lessons or changes their order. The old attempt keeps its original
pin; starting a new release does not rewrite it or switch an active lesson
automatically. Changed lesson content keeps its history but must be passed
again. Colleague reads learning state first and explains which steps already
passed and which remain; an old observation is not proof that the new Preview
runs.

If an end or new start is unconfirmed, read progress and retry the original
request rather than inventing another exercise. Replaying an old start or end
returns its original ended target and the actual current active attempt: it
cannot resume, prepare or end a successor. Each learner keeps up to 32 attempts
and 64 KiB of progress without pruning; a capacity refusal keeps all evidence and
needs owner review. Missing or corrupt pinned content needs exact owner
restoration, even when no lesson is active.

## Continue an ended lesson in a fresh exercise

Ask Colleague: "Continue my saved lesson in a fresh exercise, keeping the steps I
already passed." If that lesson is still active, explicitly ask to end it first.
Colleague reads your current progress, explains the exact lesson and remaining
steps, and uses **lesson.end** followed by **lesson.continue**. These are chat
operations, not screen buttons.

Continuation uses your ended attempt's original installed content, even when
that release has been disabled (ordinary new starts still need an enabled
release). It creates a new attempt and, only for a declared exercise, a fresh
project and session. It keeps genuine passes for unchanged lesson content with
their original evidence, and does not stop, delete, restore or overwrite the
earlier project.

If an owner separately deleted an ended exercise, its lesson history and passes
remain, and Learning can still open the continued lesson; reading history does
not recreate the old project. Incomplete deletion, inaccessible storage, changed
ownership or missing pinned content remains an error for owner inspection, and a
missing active exercise is not treated as harmless old history.

A different active attempt must be resumed or explicitly ended; continuation
cannot take it over. On an uncertain save Colleague reads progress and retries
the same continuation request. Unavailable continuation, missing or corrupt
installed content or a history capacity refusal needs owner inspection; the
original progress is kept. Reading state never repairs a missing reservation or
creates a substitute workspace; ask the installation owner to inspect corrupt,
foreign or missing content rather than changing the pin.

## Step results

Each step result is saved separately from the lesson's progress and is never
removed: a choice answer, **Done** on a self-check step, or an automatic check
result. A lesson is complete when every required step has passed in any attempt
of the same lesson content, so passes from an ended attempt still count. Only
these record a pass: the automatic check run by your own action (pressing the
App's control in the lesson's Preview, or **Check now** on a code step after
editing the files yourself), the server's answer comparison, or **Done**. When
Colleague runs a step check it only reports what the check found; nothing is
saved, so it can neither record a pass nor use up the attempt's results.
Colleague never sees or reveals choice answers. After a step passes, later
answers or checks for it change nothing. An attempt keeps at most 64 step results
and always keeps room for one pass of each step not yet passed: a "not yet"
result that would use that room is shown but not saved, so retries never block a
later pass. The lesson remembers the last step and scroll position across
reloads. Earlier assessment-based lessons keep their original history and
completion.
