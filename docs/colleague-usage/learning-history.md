# Lesson history and resume

To pick a lesson up again, choose **Continue lesson** in Learning → **Courses**
(on the lesson card, the course's **Up next** card or the lesson's own row), or
ask Colleague to continue it; see [Choosing lessons and
courses](learning-mode-ui.md). These rules apply on desktop and phone.

## Ending a lesson

A lesson ends in one of three ways, each recorded as its end reason:

- **finished**: the **Lesson finished** screen ends it when your own result
  completes the last required step (or from **Lesson finished** in its reader).
- **left**: **Leave lesson** (the yellow bar on a computer, Learning's header or
  the Learning page) ends it; there is no paused lesson.
- **discard**: Colleague ends it with the shared `lesson.end` operation only
  after your direct request or accepted offer, and deleting a practice project
  ends its lesson the same way. There is no discard button.

An installation without its lesson host cannot end lessons, and that refusal is
not a successful end. Hiding Colleague or closing Learning does not end a
lesson.

Ending keeps the attempt's pinned step results (and, for an earlier-format
lesson, its quiz and practical results) and stops no agent work. The practice
project and its session stay yours: ending neither stops, archives nor deletes
them. Archive or delete a practice project from Learning → **Practice** or the
**Lesson finished** screen, or ask Colleague (it acts only on your request and
confirmation); an ended learning record is not disposal. Separate lesson conversations saved before Learning v2 were retired
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

## Continue an ended lesson

Press **Continue lesson** on a lesson you left, or ask Colleague: "Continue my
lesson." Colleague reads your progress, explains the exact lesson and remaining
steps, and uses **lesson.continue** after your request or accepted offer. A
lesson still in progress is opened, not continued; another lesson in progress
must be left first.

Continuation uses your ended attempt's original installed content, even when
that release has been disabled (ordinary new starts still need an enabled
release). It creates a new attempt in the same practice project when that
project still exists (reusing its session, or starting a new one at the
project's current code, so your edits stay); otherwise, for a declared
exercise, it prepares a fresh practice project. Steps already passed for the
same lesson content still count, so you continue at the first step not passed.

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
