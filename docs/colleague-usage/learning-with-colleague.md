# Lessons: Colleague teaches

For authoring and Git publication, read `lesson-authoring`. For pinned content
and owner recovery, read `teaching-content`. For pointing and "show me", read
`learning-teacher-guide`.

## Colleague as your teacher

Learning opens above the app with **L** on every signed-in page. You can read
lessons yourself without AI. Choose **Teach me** in a lesson, or ask Colleague
about your lesson, and Colleague teaches the current step:

- It reads your lesson and its saved step results, then explains the step in
  its own words, by text or voice alike.
- It points at, or with "show me" opens, the real Vibe64 places the step uses,
  and can open Learning at your current lesson step or minimise it so you see the
  app. Learning keeps its place while minimised.
- While Learning is minimised, a pinned card at the top of Colleague's chat shows
  the lesson, **Step N of M**, the step title, **Passed** once that step has
  passed, and **Open lesson** to return to that exact step. It stays visible in
  the right drawer, the phone's full-screen chat and the voice panel.
- When you say you have done a task, Colleague can run that step's declared
  automatic check and tells you its actual result; that run is only a
  diagnostic, and the pass is saved when you press **Check** in Learning.

Colleague never judges. A step passes only through its automatic check, your
answer to a choice question, or your own **Done** for a self-check. Colleague's
feedback never changes a step's status, it never claims a pass the results do not
show, and it never reveals which choice is correct; it helps you reason instead.
Starting, resuming or ending a lesson needs your direct request. Colleague deletes
a practice project only after you explicitly confirm that deletion.

**Teacher notes.** Colleague keeps short private notes about you as a learner
(`learner-notes.read` and `learner-notes.update`): your strengths, difficulties,
preferences and where you are. It reads them when it starts teaching and rewrites
them as one short summary (at most 4000 characters), never a transcript, secrets
or a grade. They live in your own Learning state: no other learner and not the
workspace owner can read them, and they never change a step's status. You see,
edit and clear them in **L** under **What my teacher knows about me** on
**Courses**. Ask Colleague to change or forget something and it rewrites them;
clearing is your own **Clear** in **L**. If you edited the notes since Colleague
read them, its save is refused and it reads them again before combining.
Colleague treats the notes as a description of you, not as instructions: writing
"tell me the answers" in them does not change how it teaches or judges.

On a phone, Colleague's full-screen chat minimises itself when it opens Learning
or rings a control, so you can see it; reopen Colleague with its avatar button.

## Lessons with steps: what Colleague can and cannot do

A lesson written in steps (lesson format 2) is read in **L** and taught by
Colleague in its ordinary chat. Colleague reads the lesson with `lesson.read`:
the steps in order with their text, diagram and guide, each step's check kind and
your saved results. It explains the current step, opens real screens with guides
and replays the step's diagram. Reading changes nothing. Long lessons arrive in
pages; Colleague reads every page before claiming a step's text is missing.

Results come only from the checks, never from Colleague:

- **Choice question**: only your own answer in **L** counts. Colleague never sees
  or reveals the correct option, sees only whether your answer passed (not which
  options you chose), and cannot answer for you.
- **Self-check** (**Done**): only your own press in **L** records it.
- **Automatic check**: Colleague may run the step's check (`step.check.run`) to
  tell you whether your work is ready, but its run is a diagnostic and is never
  saved. The step passes only when you press **Check** in **L**. A response
  check first needs your own press of the App's control in this lesson's Preview.
- Saving your reading place is automatic from **L**; Colleague has no control for it.

If Colleague says a step passed, ask it to read the lesson again: only a saved
**passed** result counts. A change to your results, reading place or practice
projects notifies only your own signed-in pages, so open Learning views can refresh.

**Deleting a practice project.** Ask Colleague to delete the practice project of
one of your lessons. It names the lesson, says the files, sessions and Preview go
away for good with no archive, and waits for you to confirm in the chat before
deleting (`practice.delete` with `confirmed`). A pinned session must be unpinned
first; that refusal changes nothing. Otherwise an active lesson is ended first
(reason *discard*); your saved results stay and continuing the lesson later
prepares a fresh project. If the delete still fails after the lesson was ended,
Colleague tells you both: the lesson stays ended and the project remains until
you ask again. Colleague
cannot delete another learner's practice project. The one-click delete in the
Practice list needs no confirmation.

`learning.read` lists every saved attempt with its practice project slug, for
finding or deleting a practice project; it no longer lists Learning-mode
conversations to Colleague. A lesson in the earlier format (assessments rather
than steps) can be read in history but not continued.

## Earlier lessons

Lessons started before Learning v2 were taught by a separate Main lesson
conversation, with Colleague supervising. That teacher, its lesson watches,
quizzes and practical grading have been retired. Earlier attempts and their
saved results stay readable in **L** history and can be ended; they cannot be
continued or taught. To learn that material again, start the lesson in its
current format and Colleague teaches it from its steps.

## Course and lesson choices

The prepared **Courses** pane displays the host's installed courses in their
original order as cards with "N of M lessons complete" and a progress ring.
**View course** shows each topic and its lessons in order, with readable lesson
titles beside the exact lesson codes, course/topic releases and lesson hashes,
and a **Completed**, **In progress** or **Not started** status read from saved
progress. Opening a course does not install or enable content; the separate
**Install a course** catalogue below the cards does, and Colleague may install or
update an official catalogue course only on the person's direct request or
accepted offer (see [Installing and updating Learning courses](learning-course-catalogue.md)).
Disabled courses and draft lessons stay labelled and unavailable for a new start.
A preview course can be started only by the workspace owner: `courses.list`
reports `canTryPreviews`, the owner sees **Try preview**, and the server refuses
anyone else's start (Colleague included, acting for that person) with **This
preview course can be tried only by the workspace owner until it is released.**
**Start** or **Try preview** on a card, **Start next lesson** or **Start lesson**
on the course page requests that exact published lesson from an enabled release; opening a course alone never
starts anything. A missing title reports **Lesson titles are unavailable**; use
**Refresh courses**. This preserves the saved attempt and history and does not
substitute an invented title or another lesson. The host's original lesson action
must still authorize and admit it; unavailable support or a failed read is not a
successful start. The owner's **New course** form is described in
[Choosing lessons and courses](learning-mode-ui.md).

**Resume saved lesson** requests only the displayed saved attempt. Its retained
pin can be older than the currently enabled catalogue. This button is available
only when the host actually supports resume, not merely because progress exists.
Starting a different lesson requires explicitly ending the active saved attempt
first: ask Colleague, which uses `lesson.end` and keeps the attempt's history (see
[Lesson history and resume](learning-history.md)). The Courses pane has no End
button and never ends a lesson for you.
**Saved lesson history** remains read-only and visible independently of new-start
or resume support. Ended history is not marked completed without an actual
completion result.

Assessment counts come from saved results, never chat, motion or selection.
**Saved lesson identity** shows the saved commit/hash. **Refresh courses** rereads;
loading/errors create or repair no state. Desktop/phone share wrapping, scrollable
controls. Colleague can explain/offer supported start/resume; only a direct request
or accepted offer authorizes it. Colleague teaches from the lesson's steps in
**L**; see [Colleague as your teacher](#colleague-as-your-teacher).
