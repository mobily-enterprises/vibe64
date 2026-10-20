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

Starting, continuing or leaving a lesson needs your direct request or an accepted
offer; a how-to question alone authorizes nothing.

## Learning mode

While you have a lesson in progress you are in learning mode, in your learning
space only: the one project you can open is that lesson's practice project
(none for Lesson 0 or a lesson without one), and everything inside it works,
Colleague included. Colleague checks this
(`learning-mode.read`, or `learningMode` in `learning.read`) before opening a
project for you. It does not open or work on another project while you are in
learning mode; opening one is refused with "You're in a lesson. Leave lesson to
get back to your projects." Colleague tells you that and offers to leave the
lesson. Leaving is your one click on **Leave lesson** (the yellow bar on a
desktop, Learning's header or the Learning page); Colleague leaves for you
(`learning-mode.leave`) only when you ask or accept its offer. Leaving ends the
lesson and keeps your results and its practice project. **Continue lesson** in
**L** → **Courses** (or Colleague's `lesson.continue`, when you ask) starts it
again in the same practice project.

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

## Practice projects

Colleague lists your practice projects and archives (`practice.list`) and opens
one when you ask (`practice.open`, which continues its lesson). It archives a
practice project (`practice.archive`), deletes one (`practice.delete`) or
deletes an archive (`practice.archived.delete`) only when you ask: it names the
lesson, says what is kept (an archive keeps source, sessions and state without
rebuildable dependencies such as `node_modules`; a delete keeps nothing), and
waits for you to confirm that exact project in the chat (`confirmed`). A pinned
session must be unpinned first; that refusal changes nothing. Archiving or
deleting the project of the lesson in progress ends that lesson first; your
saved results stay. Colleague cannot see or change another learner's practice
projects, and it cannot turn a practice project into one of your own projects.
The one-click buttons in **L** → **Practice** need no confirmation (see
[Practice projects](learning-practice-projects.md)).

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

**Continue lesson** on the lesson in progress requests only that displayed
attempt, whose pin can be older than the enabled catalogue; it appears only when
the host supports it. Starting a different lesson first requires leaving the
lesson in progress (**Leave lesson**), which keeps its history (see
[Lesson history and resume](learning-history.md)). **Saved lesson history** stays read-only and visible
independently of start or resume support; ended history is not marked completed
without an actual completion result. **Saved lesson identity** shows the saved
commit and hash. Loading and errors create or repair no state.
