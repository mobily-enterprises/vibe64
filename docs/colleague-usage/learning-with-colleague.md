# Lessons: Colleague teaches

For authoring and Git publication, read `lesson-authoring`. For pinned content
and owner recovery, read `teaching-content`. For pointing and "show me", read
`learning-teacher-guide`.

## Two conversations: Develop and Learn

Vibe64 has two modes, switched with **L**: **Develop** (your own projects) and
**Learn** (your practice projects). Colleague keeps a separate conversation for
each, and the one you see always follows the mode:

- **Develop** has your one Colleague conversation, with its read-only previous
  conversations, watches and assignments, exactly as before. It does not teach:
  ask it about lessons and it tells you to press **L** (it can switch for you
  when you ask or accept its offer, with `learning-mode.set`).
- **Learn** gives each lesson attempt its own teacher conversation. Leaving the
  lesson (pressing **L**, or reading another lesson) and coming back resumes
  that same conversation. Learn mode with no lesson in progress has one
  conversation of its own. Restarting a lesson starts a fresh teacher.
- Switching never interrupts Colleague: a reply it is writing finishes in its
  own conversation, still on the projects of the mode it started in, which you
  see again when you switch back. Watched agents
  keep being followed while you are in Learn; their updates wait in Develop's
  conversation until you return. **Start fresh** and **Previous conversations**
  work within the conversation you are in.
- In Learn, Colleague does not create assignments or watches; in Develop it does
  not teach, read lessons or your teacher notes.

## Colleague as your teacher

In Learn mode, **Courses** (on the lesson step bar, or in the project menu beside **L**) is the catalogue
where you choose and start lessons; your current lesson is read on the Learn
page itself, in its **Lesson** tab beside Colleague (see `learning-environment`).
You can read lessons yourself without AI. Choose **Teach me** on a lesson step,
or ask Colleague about your lesson, and Colleague teaches the current step.
**Teach me** opens Colleague beside the step and sends "Teach me this step.";
the step stays on screen, so Colleague refers to it rather than repeating it:

- It reads your lesson with `lesson.read` (the steps in order with their text,
  diagram, guide and check kind, plus your saved results) and explains the step
  in its own words, by text or voice. Reading changes nothing. Long lessons
  arrive in pages; Colleague reads every page before claiming a step's text is
  missing.
- It points at, or with "show me" opens, the real Vibe64 places the step uses,
  replays the step's diagram, can show your current step in the **Lesson** tab,
  and can open **Courses** or close it so you see the app. Courses keeps its
  place while closed.
- In Learn mode with a lesson in progress, Colleague's header shows a small
  yellow **Step N/M** button (a check once the step passed). Pressing it shows
  that step in the page's **Lesson** tab (see `learning-environment`); on a
  phone Colleague's full-screen chat also minimises so the step is visible, and
  its avatar button brings Colleague back. It appears on the desktop panel, the
  phone's full-screen chat and during voice chat. Develop shows no step button.
- Before asking you to press **Done**, answer a question or press **Check now**,
  it looks at that step's saved result. A step that already passed is not asked
  for again: Colleague says it passed and moves on to the next unpassed step.
- It tells you in plain words what it opened or highlighted, without receipt
  fields or IDs. If it could not open or point at a step's place (for example the
  control is hidden), it says so plainly and describes the path in words.

On a phone, Colleague's full-screen chat minimises itself when it opens Courses,
shows a lesson step or rings a control, so you can see it; reopen Colleague with
its avatar button. **Teach me** on a phone opens Colleague's full-screen chat
over the Lesson tab, which stays underneath.

## Colleague never judges

A step passes only through your own action in the lesson:

- **Choice question**: only your own answer counts. Colleague never sees or
  reveals the correct option, sees only whether your answer passed (not which
  options you chose), and cannot answer for you; it helps you reason instead.
- **Self-check**: only your own **Done** records it.
- **Reading step**: optional; only your own **Mark as done** records it.
- **Automatic check**: when you say you have done a task, Colleague may run the
  step's check (`step.check.run`) and tell you its actual result, but that run is
  a diagnostic and is never saved. The step passes only when you press **Check
  now**; a response check first needs your own press of the App's control in this
  lesson's Preview.
- **Review check**: the step shows its rubric, what your finished work must
  show. Only your own **Check my work** asks your own AI (your Helper route in
  **AI Accounts → Model routing**) to review your practice work against it;
  Colleague never runs a review for you. A review answers **Passed** (final) or
  **Not yet** with a comment and a hint. While the coding agent is still
  working it says "Wait until the agent finishes"; with nothing changed yet it
  says "No changes yet" without asking your AI; pressing again without new
  work shows the same review. When the review cannot finish (no Helper route,
  the provider failed, or the reply was unusable) nothing is recorded: fix the
  cause and press it again.
- **When you are stuck**: Colleague can read your practice work for the
  current step (`step.evidence.read`): the files you changed since the lesson
  started and their diff, the lesson's coding conversation when the step's
  review uses it, the rubric and your last review. It uses this to help you
  with the next move; reading it never passes a step.

Colleague's feedback never changes a step's status. If Colleague says a step
passed, ask it to read the lesson again: only a saved **passed** result counts.
Your reading place is saved automatically. A change to your mode, lesson,
results, reading place or practice project notifies only your own signed-in
pages, so open views (and Colleague's conversation) refresh.

Starting, restarting, finishing or deleting a lesson, and switching mode, needs
your direct request or an accepted offer; a how-to question alone authorizes
nothing.

## Which projects Colleague opens

Colleague opens only the projects of your mode. In **Learn** that is your
practice project (none for a lesson without one); opening any of
your own projects is refused with "You're in Learn mode. Press L to go back to
your projects." In **Develop** it opens your own projects, and a practice
project is refused with "This is a practice project. Press L to switch to
Learn." Colleague relays the reason and offers to switch; it switches for you
(`learning-mode.set`) only when you ask or accept. Switching ends nothing: the
lesson in progress stays paused, with its practice project, until you come
back.

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

## Lessons in progress and archived

One lesson is in progress at a time. Colleague reads it, with its practice
project, and your archived lessons with `practice.list`. When you ask:

- **Start a different lesson** (`lesson.start`): while another is in progress
  this is refused until the current one is archived. Colleague asks you first
  and archives it (`archiveCurrent`) only after you agree.
- **Finish** (`lesson.finish`), once every step passed: the lesson is completed
  and archived with its practice project and this teacher conversation.
- **Restart** (`lesson.restart`): archives this attempt and starts the lesson
  again with a fresh practice project, fresh results and a fresh teacher.
- **Delete** (`lesson.delete`): removes the lesson's practice project and
  teacher conversation without archiving.
- **Delete an archived lesson** (`practice.archived.delete`): removes it for
  good.

Colleague restarts or deletes only after you confirm that exact lesson in the
chat (`confirmed`); it names the lesson and says what is kept. A pinned session
must be unpinned first; that refusal changes nothing. Colleague cannot see or
change another learner's lessons, and it cannot turn a practice project into one
of your own projects. The buttons under **Courses** → **In progress** and
**Archived** do the same (see [Practice projects](learning-practice-projects.md)).

## Earlier lessons

Lessons started before Learning v2 were taught by a separate lesson
conversation, with quizzes and practical grading. Those attempts and their saved
results are not kept by Rev 4's learning space reset. Start the lesson again in
its current format and Colleague teaches it from its steps.

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

**Open** on the lesson in progress returns to that attempt, whose pin can be
older than the enabled catalogue. Starting a different lesson first archives the
lesson in progress, after your confirmation (see
[Lesson history and resume](learning-history.md)). **Saved lesson history** stays read-only and visible
independently of start or resume support; ended history is not marked completed
without an actual completion result. **Saved lesson identity** shows the saved
commit and hash. Loading and errors create or repair no state.
