# Lessons: Colleague teaches

For authoring and Git publication, read `lesson-authoring`. For pinned content
and owner recovery, read `teaching-content`. For pointing and "show me", read
`learning-teacher-guide`.

## Colleague as your teacher

Learning opens above the app with **L** on every signed-in page. You can read
lessons yourself without AI. Choose **Teach me** in a lesson, or ask Colleague
about your lesson, and Colleague teaches the current step:

- It reads your lesson with `lesson.read` (the steps in order with their text,
  diagram, guide and check kind, plus your saved results) and explains the step
  in its own words, by text or voice. Reading changes nothing. Long lessons
  arrive in pages; Colleague reads every page before claiming a step's text is
  missing.
- It points at, or with "show me" opens, the real Vibe64 places the step uses,
  replays the step's diagram, and can open Learning at your current step or
  minimise it so you see the app. Learning keeps its place while minimised.
- While a lesson is going, Colleague's header shows a small yellow **Step N/M**
  button (a check once the step passed). It opens only the current step in a
  dialog with its check, **Show me**, **Teach me**, **Previous step**/**Next
  step** and **Open in Learning** (see `learning-environment`). It appears on
  the desktop panel, the phone's full-screen chat and during voice chat.
- Before asking you to press **Done**, answer a question or press **Check now**,
  it looks at that step's saved result. A step that already passed is not asked
  for again: Colleague says it passed and moves on to the next unpassed step.
- It tells you in plain words what it opened or highlighted, without receipt
  fields or IDs. If it could not open or point at a step's place (for example the
  control is hidden), it says so plainly and describes the path in words.

On a phone, Colleague's full-screen chat minimises itself when it opens Learning
or rings a control, so you can see it; reopen Colleague with its avatar button.

## Colleague never judges

A step passes only through your own action in **L** or Colleague's step dialog:

- **Choice question**: only your own answer counts. Colleague never sees or
  reveals the correct option, sees only whether your answer passed (not which
  options you chose), and cannot answer for you; it helps you reason instead.
- **Self-check**: only your own **Done** records it.
- **Automatic check**: when you say you have done a task, Colleague may run the
  step's check (`step.check.run`) and tell you its actual result, but that run is
  a diagnostic and is never saved. The step passes only when you press **Check
  now**; a response check first needs your own press of the App's control in this
  lesson's Preview.

Colleague's feedback never changes a step's status. If Colleague says a step
passed, ask it to read the lesson again: only a saved **passed** result counts.
Your reading place is saved automatically by **L**. A change to your results,
reading place or practice projects notifies only your own signed-in pages, so
open Learning views refresh.

Starting, resuming or ending a lesson needs your direct request or an accepted
offer; a how-to question alone authorizes nothing.

## Learning mode

While you have a lesson in progress you are in learning mode: your projects
are only that lesson's practice project (none for Lesson 0 or a lesson without
one), and everything inside it works, Colleague included. Colleague checks this
(`learning-mode.read`, or `learningMode` in `learning.read`) before opening a
project for you. It does not open or work on another project while you are in
learning mode; opening one is refused with "You're in a lesson. Leave lesson to
get back to your projects." Colleague tells you that and offers to leave the
lesson. Leaving is your one click on **Leave lesson** (the yellow bar on a
desktop, or Learning's header); Colleague leaves for you
(`learning-mode.leave`) only when you ask or accept its offer, and returns to
the lesson (`learning-mode.enter`) only when you ask. Leaving keeps your
progress and place; **L** → **Resume** brings you back.

## Teacher notes

Colleague keeps short private notes about you as a learner
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

## Deleting a practice project

Ask Colleague to delete the practice project of one of your lessons. It names
the lesson, says the files, sessions and Preview go away for good with no
archive, and waits for you to confirm in the chat before deleting
(`practice.delete` with `confirmed`). A pinned session must be unpinned first;
that refusal changes nothing. Otherwise an active lesson is ended first (reason
*discard*); your saved results stay and continuing the lesson later prepares a
fresh project. If the delete still fails after the lesson was ended, Colleague
tells you both: the lesson stays ended and the project remains until you ask
again. Colleague cannot delete another learner's practice project. The one-click
delete in the **Practice** list needs no confirmation.

`learning.read` lists every saved attempt with its practice project slug, for
finding or deleting a practice project.

## Earlier lessons

Lessons started before Learning v2 were taught by a separate lesson
conversation, with quizzes and practical grading. Those attempts and their saved
results stay readable in **L** and can be ended, but cannot be continued or
taught. Start the lesson again in its current format and Colleague teaches it
from its steps.

## Courses and starts

Courses, course pages and their states are described in
[Choosing lessons and courses](learning-mode-ui.md). Opening a course does not
install or enable content. Colleague installs or updates an official catalogue
course only on your direct request or accepted offer (see
[Installing and updating Learning courses](learning-course-catalogue.md)).

A start requests that exact published lesson from an enabled release; the host's
lesson action must still authorize and admit it, and an unavailable host or a
failed read is not a successful start. A preview course can be started only by
the workspace owner: anyone else's start (Colleague included, acting for that
person) is refused with **This preview course can be tried only by the workspace
owner until it is released.** A missing title reports **Lesson titles are
unavailable**; use **Refresh courses**. Nothing substitutes an invented title or
another lesson.

**Resume saved lesson** requests only the displayed saved attempt, whose pin can
be older than the enabled catalogue; it appears only when the host supports
resume. Starting a different lesson first requires ending the active attempt:
ask Colleague, which uses `lesson.end` and keeps its history (see
[Lesson history and resume](learning-history.md)). Courses has no End button and
never ends a lesson for you. **Saved lesson history** stays read-only and visible
independently of start or resume support; ended history is not marked completed
without an actual completion result. **Saved lesson identity** shows the saved
commit and hash. Loading and errors create or repair no state.
