# Lesson history and resume

After an interruption, choose **Resume saved lesson** (or **Continue** on its
course) in Learning → **Courses**, or ask Colleague to resume the exact saved
lesson; see [Choosing lessons and courses](learning-mode-ui.md).
Ending or restarting learning requires your request to Colleague; it retains earlier progress and does
not delete the practice project. These rules apply to desktop and phone.

Explicit lesson retirement preserves the original pinned step, quiz and
practical results; ending a lesson stops no agent work. Separate lesson
conversations saved before Learning v2 were retired by the installation upgrade,
so they no longer appear in Learning; they are kept, not deleted, and only the
installation owner can inspect or restore them. The practice project and its session
are ordinary and stay yours: ending a lesson neither stops nor archives nor
deletes them. When the person requests disposal, use the existing
authorised project/session close, archive and deletion workflow; do not claim
disposal from an ended learning record. Leaving or hiding Colleague does not end
the lesson.

An admitted fresh start after retirement keeps the earlier evidence with its
original identity. A lesson that declares an exercise uses a new exercise
project/session; a no-exercise lesson creates neither. Passes for the same
lesson code and unchanged content hash contribute to that lesson's completion,
even when an enabled newer topic or course release adds another lesson or changes
its ordering. The old attempt keeps its original pin and evidence; starting a
new release does not rewrite it or switch an active lesson automatically.
Explain which assessments already passed and which practical tasks remain; an
old observation is not proof that the new Preview runs. Changed content retains
history but requires its own assessment. There is no separate restart/discard button; ask Colleague in chat.

If an end/new-start save is unconfirmed, read progress and retry its original
request identity rather than inventing another exercise. Replaying an ended
reservation does not resume or reactivate it; use an explicitly requested continuation or enabled new start after
an explicit retirement. Replaying an old end cannot close a later attempt. Each
learner keeps up to 32 attempts and 64 KiB of progress without pruning; capacity
refusal requires owner review and keeps all evidence. Historical missing/corrupt pinned
content requires exact owner restoration, even when no lesson is active.


When the installation supplies its lesson host, the shared `lesson.end` operation
can retire the person's exact learning attempt after a direct request or accepted
offer. State clearly that it retains the exercise and all history; the reason
`discard` records a learning decision, not project disposal. Use existing
separate close, archive or delete operations only when requested and
authorised. An unavailable retirement host is not a successful end. The same tool is used on
desktop and mobile; this addition creates no new layout control.

Read learning state before continuing. Ended history preserves original answers,
step results and earlier practical observations. Explain already-passed steps
and assessments and remaining work without claiming an old observation happened in the new project. A replay of
an old start/end returns its original ended target and the actual current active
attempt, and cannot prepare or end a successor. A fresh exercise uses a separately requested continuation or enabled new start.



## Continue an ended lesson in a fresh exercise

Ask Colleague: “Continue my saved lesson in a fresh exercise, keeping the assessments
I already passed.” If that lesson is still active, explicitly ask to end that attempt
for the restart first. Colleague reads your current progress, explains the exact
lesson and remaining tasks, and uses **lesson.end** followed by **lesson.continue**.
These are chat operations on desktop and phone, not additional screen buttons.

Continuation uses your ended attempt's original installed content, including when
that release has been disabled. It creates a new attempt and, only for a declared
exercise, a fresh project/session. It retains genuine passes for unchanged lesson
content and their original evidence. It does not stop, delete, restore or overwrite
the earlier project, and does not prove that the new Preview runs. Ordinary new
starts still require an enabled release. A no-exercise lesson creates no project.

If an owner separately archived and deleted an ended exercise, its lesson history,
passed assessments and evidence remain. Learning can still open the healthy continued lesson. Reading history does not recreate
the old project. Incomplete deletion, inaccessible storage, changed ownership or
missing pinned content remains an error requiring owner inspection. A missing
active exercise is not treated as harmless old history.

A different active attempt must be resumed or explicitly ended; continuation cannot
take it over. On an uncertain save Colleague reads progress and retries the same
continuation request, rather than inventing another exercise. A retired request's
replay returns its retained result and the actual current active lesson without
preparing that successor. Unavailable continuation, missing/corrupt installed
content or history capacity refusal needs owner inspection; keep the original
progress. Ask Colleague to offer the supported recovery, then accept it when ready.

For a lesson without an exercise, retain its exact learner, attempt and installed
content when diagnosing an unavailable lesson. An ended attempt supplies history
but cannot be continued in place. Missing or unconfirmed
reservation summaries require the existing supported recovery; simply reading
state does not repair them or create a substitute workspace. Ask the installation
owner to inspect corrupt, foreign or missing content rather than changing the pin.

## Step results in step-based lessons

Newer lessons are made of steps. Each step result is saved separately from the
lesson's progress and is never removed: a choice answer, **Done** on a self-check
step, or an automatic check result. A lesson is complete when every required step
has passed in any attempt of the same lesson content, so passes from an ended
attempt still count. Only these record a pass: the automatic check run by the
person's own action (pressing the App's control in the lesson's Preview, or
**Check now** on a code step after editing the files themselves), the server's answer
comparison, or **Done** on a self-check step. When Colleague runs a step check,
it only reports what the check found; nothing is saved, so it can neither record
a pass nor use up the attempt's results. Colleague never sees or reveals choice
answers. After a step passes, later answers or checks for it change nothing. An
attempt keeps at most 64 step results and always keeps room for one pass of each
step not yet passed: a "not yet" result that would use that room is shown but not
saved, so retries never block a later pass. The lesson remembers the last step and
scroll position across reloads. Earlier assessment-based lessons keep their
original history and completion.
