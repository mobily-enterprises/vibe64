# Lesson history and continuing

A lesson is either in progress or not. To pick up a lesson that is not in
progress, choose **Continue lesson** for it in Learning → **Courses** (on the
lesson card, the course's **Up next** card or the lesson's own row), or ask
Colleague to continue that exact lesson; see [Choosing lessons and courses](learning-mode-ui.md).
These rules apply on desktop and phone.

## Ending a lesson

A lesson ends in one of three ways:

- **Leave lesson** (the yellow bar on a computer, Learning's header or the
  Learning page) ends it as *left*. Use it to stop for
  now and go back to your normal projects.
- Its **Lesson finished** screen ends it as *finished*. The screen opens when
  your own result completes the last required step, or from **Lesson finished**
  in its reader.
- Colleague can end it as *discard* after your direct request or accepted offer,
  through the shared `lesson.end` operation. There is no separate discard
  button.

Every ending keeps the lesson's step results and stops no agent work. *Discard*
records a learning decision, not project disposal. The practice project and its
sessions stay yours: ending neither stops, archives nor deletes them. Dispose of
them from Learning → **Practice** or the **Lesson finished** screen, or ask
Colleague (it acts only on your request and confirmation). An installation without its lesson host cannot
end lessons, and that refusal is not a successful end. Leaving or hiding
Colleague does not end a lesson.

Lessons written in the retired first format (quiz questions instead of steps)
keep their saved results and completion, but nobody can start new work in that
format.

## Continuing a lesson

**Continue lesson** starts a new attempt of the same lesson with the content you
started it with. That content stays available even when its release has since
been disabled; an ordinary new start still needs an enabled release.

- If the lesson's practice project still exists, the new attempt uses that same
  project, with your edits. It reuses the practice session when that session
  still exists and is not archived; otherwise it creates a new ordinary session
  at the project's current state.
- If the practice project was deleted or archived, the lesson gets a fresh one,
  created as for a first start. A no-exercise lesson has no project.
- Learning opens at the first required step that has not passed for this lesson
  content.

Only one lesson is in progress at a time; continuing a different lesson needs
the current one to end first. Colleague explains this and ends it only on your
request. If a start or continuation is unconfirmed, Colleague reads your
progress and retries the same request rather than inventing another exercise.
Replaying an old start or end returns what it saved originally; it cannot
resume, prepare or end a later attempt.

## Step results

Step results belong to the lesson content (its code and exact content), not to
one attempt: a choice answer, **Done** on a self-check step, or an automatic
check result. A lesson is complete when every required step has passed for that
lesson content in any attempt, so passes survive leaving, continuing and
starting a newer release whose lesson content is unchanged. Changed lesson
content keeps its history but must be passed again.

Only these record a pass: the automatic check run by your own action (pressing
the App's control in the lesson's Preview, or **Check now** on a code step after
editing the files yourself), the server's answer comparison, or **Done**. When
Colleague runs a step check it only reports what the check found; nothing is
saved, so it can neither record a pass nor use up the lesson's results.
Colleague never sees or reveals choice answers. After a step passes, later
answers or checks for it change nothing. Each lesson keeps at most 64 step
results, shared by every attempt of the same lesson content (Leave lesson and
Continue lesson keep adding to the same 64), and always keeps room for one pass
of each step not yet passed: a "not yet" result that would use that room is
shown but not saved, so retries never block a later pass. Code you write in a practice project counts for its code
steps while a lesson is in progress there, including code written before you
left and continued. The lesson remembers the last step and scroll position
across reloads.

## History limits

Each learner keeps at most 32 lesson attempts. Starting another removes the
oldest ended attempt that no practice project still needs: one whose lesson has
no practice project, one that never began preparing, one a later attempt in the
same practice project replaced, or one whose practice project was deleted or
archived. The latest attempt of a practice project still in your Practice tab is
never removed, so every kept practice project can still be opened, archived or
deleted. When all 32 belong to kept practice projects, starting another lesson
says so: archive or delete a practice project in **Practice**, then start again.
Step results stay with their lesson content. Results of up to 128 lesson
contents are kept; past that, results of lesson content no kept attempt uses
make room first. Missing or corrupt pinned content needs exact
owner restoration, even when no lesson is in progress. Reading state never
repairs a missing record or creates a substitute workspace; ask the installation
owner to inspect corrupt, foreign or missing content rather than changing the
lesson.
