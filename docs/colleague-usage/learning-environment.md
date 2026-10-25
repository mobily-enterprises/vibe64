# The Learning environment (L)

Vibe64 has two modes: **Develop**, where you work on your own projects, and
**Learn**, where you take lessons. The yellow-outlined **L** button switches
between them. Each mode keeps its own place: pressing **L** returns you to
exactly the page you last had open in the other mode, also after a reload.

## Where the L button is

- Home and project pages: the first button at the left of the header.
- It is the same size as the other header icon buttons (40px on a phone) and
  the first keyboard stop in the header; Enter or Space presses it.
- Tooltips: **Switch to Learn** in Develop, **Back to Develop (your projects)**
  in Learn, where the L is solid yellow.
- It appears only for a signed-in person.

## Learn mode

Learn mode is saved for your account: every tab and device is in the same mode,
and a new tab opens in it. In Learn mode the header is Learning yellow, with a
warm yellow wash and an amber line along its bottom. After the L comes the
same project selector as in Develop. It shows your lesson's name, or **No
project selected** without a lesson in progress. Its menu holds **Courses**,
which opens the Courses overlay, and your lesson's practice project.

You have at most one lesson in progress. In Learn mode you are in your learning
space only (see [Practice projects](learning-practice-projects.md)):

- The lesson's practice project is the one project you can open. Opening any other project (for example from a saved
  address) takes you to the practice project with the note "You're in Learn
  mode. Press L to go back to your projects."
- With no lesson in progress the page shows **No project selected** (below).
  A studio lesson (one taught outside any project, with no practice project)
  shows the lesson itself on that page (see [The Lesson pane](#the-lesson-pane)).
- Nothing inside the lesson's practice project is limited: Preview, Files,
  Database, coding chats and Colleague all work. Account settings and AI
  Accounts stay available, so you can connect an AI during a lesson.

Press **L** to go back to Develop: your projects come back, at the page you
left. The lesson is only paused: it stays in progress, with its practice
project and conversation, and **L** brings you back to it. Colleague keeps a
separate conversation for Develop and for Learn: if Colleague is open when you
press **L**, it stays open and shows the other mode's conversation. In Develop the
lesson's practice project is not shown; opening its address takes you to your
projects with the note "This is a practice project. Press L to switch to
Learn." The workspace owner works the same way.

While a switch is being confirmed, the **L** button is disabled and the project
page you are leaving clears at once (pressing **L** always leaves a project
page), then the other mode's place opens. The page you left never shows an
error from the mode you switched to, also when you return to it later. If the
switch is not confirmed, the page comes back, a short notice says so, and you
can press **L** again.

## The lesson step bar

In Learn mode, while your lesson is loaded, a yellow bar above the project page
names the lesson and plays its current step, beat by beat. How it works is in
[The lesson step bar](lesson-step-bar.md).

## The Lesson pane

In Learn mode the current lesson is read on the page itself, beside
Colleague, your teacher. The **Lesson** pane is the one place a lesson is read:
the step list, the current step with its text, diagram, question or check,
**Show me** and **Teach me** (see [Reading a lesson](#reading-a-lesson)), and
the lesson's **Lesson finished** screen. Starting, continuing or resuming a
lesson from Courses and Colleague's **Step N/M** button both open it, at the step you were reading.

The lesson is an on/off toggle of its own, separate from **Preview** and
**Dash**:

- **On the lesson's practice project** the header shows the **Preview** |
  **Dash** switch and, after a thin divider, the **Lesson** toggle: a pill with
  a school icon and a small switch. Off, it is outlined and its switch is to
  the left (tooltip **Show lesson**). Press it and it turns solid Learning
  yellow with its switch to the right and a check (tooltip **Hide lesson**):
  the lesson now covers whichever of **Preview** or **Dash** was selected, as
  a yellow sheet with **Lesson** and a **Hide lesson** button at its top.
- **Pressing Lesson again hides the lesson.** So does **Hide lesson** on the
  sheet, or choosing **Preview** or **Dash** (that one then shows). What it
  covered is exactly as you left it: Preview is not reloaded and keeps its
  App's page, and Dash keeps its section. **Preview** or **Dash** stays
  selected in the switch while the lesson covers it.
- The address carries the toggle as `?lesson=1`, apart from the pane, so a
  reload, or **L** back to Learn, shows the lesson again over the same pane.
- **On Management and other screens outside any project** (a studio lesson)
  the toggle is on the lesson step bar. The lesson then lies over the right
  side of the page (all of it on a phone) without moving or narrowing the
  page underneath; it stays shown as you move between that page's tabs until
  you hide it.
- **On a lesson without a practice project** there is no
  coding session, so there is no chat column and no toggle: the Lesson
  pane fills the page.
- The reader lays itself out by the width it has: in a narrow pane (on a
  phone, or beside the chat column and an open Colleague) the step list becomes
  a row of numbered circles at the top (a tick for a passed step); the step
  text scrolls below them. When there are more circles than fit, the row
  scrolls sideways and follows the current step as you move through the
  lesson, so the step you are reading always stays in view.
- Your reading place (step and scroll position) is saved for your account. A
  reload in the same tab returns to it; in another browser the lesson opens at
  the step you last read.
- On a phone (and other narrow screens up to 980px wide) the page shows one
  side at a time: the chat or the project. The next-pane button at the top
  goes from **Preview** to **Dash** and back, showing the next pane's name
  (from under the lesson it hides the lesson too). The **Lesson** toggle is
  beside it; turning it on shows the project side with the lesson over it.

## No project selected and `/app`

`/app/learning` is Learn mode's page with no project selected: the usual
project page with the chat column, the **Preview** and **Dash** switches
(on a phone, the single switch button) and **Account settings**. The Dashboard
still lists its sections, without opening them, and there is no **+** for
sessions. It is used in two cases:

- **No lesson in progress.** Pressing **L** to switch to Learn opens Courses on
  its **Courses** tab, so you can pick a lesson straight away. If you close it,
  Preview shows a welcome, **Ready to learn something new?**, with a yellow
  **Choose a lesson** button that opens Courses again. On a phone the welcome
  is in the chat column, which a phone shows first; on a desktop the chat
  column says your teacher will chat there once a lesson starts. The
  Dashboard says **No lesson in progress** with the same button.
- **A studio lesson**, taught outside any project. The page shows
  the lesson in its Lesson pane, with no chat column, and a **Dashboard**
  switch whose page says **No project selected** (see
  [The Lesson pane](#the-lesson-pane)). **L** only switches mode.

**Take the tour**, in the account menu, starts the course's orientation lesson,
**Welcome to Vibe64**: a short studio lesson on the screens around you (your
AI, Colleague, **L**). It starts like any other lesson: it switches you to
Learn, the lesson already in progress just opens, and another lesson in
progress asks **Archive your lesson in progress?** first. With no installed
course naming one that you may start, Courses opens instead. The end of first-time AI setup offers the same tour once.

A local Vibe64 has no Projects page. Its `/` and `/app` addresses open Develop's
place, the project Vibe64 was started in, or in Learn mode Learn's place (the
lesson's practice project, or no project selected). `/app` does this without
reloading the page. If no project was started, it says so with **Try again**.

An old `?mode=learning` address from the retired Learning mode opens the ordinary
project page.

## The Courses overlay

**Courses** on the lesson step bar, or in the project menu beside **L**, opens
the Courses overlay above the page: the
catalogue where you choose, start and manage lessons. It fills the screen, with
a **Courses** tab, an **In progress** tab and an **Archived** tab, and at the
right a blue **Continue lesson** button (while a lesson is in progress) and
a **Back** button. A lesson is not read here: opening
one closes Courses and shows it in the page's
[Lesson pane](#the-lesson-pane).

- Press **Back** or Escape to close Courses. The page you were on (the
  editor, Management or any other page), and Colleague, are visible again,
  exactly as you left them.
- Press **Continue lesson** to go on with your lesson where it runs: for a
  project lesson its practice project, with the lesson shown.
- Press **Courses** again to come back to the same tab.
- A reload of the page leaves Courses closed; this tab remembers which Courses
  tab you were on for the next time you press **Courses**. In another browser it
  opens on **Courses**.

On a phone the overlay is a full-screen sheet; the tabs always show in full,
and the tab row scrolls sideways when it does not fit.

## Courses

**Courses** shows course cards with progress, course pages, the **Course
catalogue** and, for the workspace owner, **New course**; see
[Choosing lessons and courses](learning-mode-ui.md). A course lists only the
lessons you can take on this Vibe64: a lesson about screens this installation
doesn't have is simply not there.

- **Start lesson** or **Start next lesson** start
  the lesson, close Courses and open it in the Lesson pane of its practice
  project (or, without one, of the no-project page). No chat is created. Starting a lesson while a different one is in progress first asks
  **Archive your lesson in progress?**: **Archive and start** or **Keep it**.
- **Continue lesson** opens your lesson in progress in the Lesson pane.
- If a start was not confirmed, **Retry lesson start** repeats the same request.
- Without AI set up, a lesson waits for it: see `learning-mode-ui`.

## In progress and Archived

**In progress** shows your one lesson in progress with its practice project and
**Open** (which opens it in the Lesson pane), **Restart** and **Delete**. **Archived** lists the lessons you
finished or archived, each with **Delete**. Deleting asks once more (**Delete
for good**); see [Practice projects](learning-practice-projects.md).

## What my teacher knows about me

Below the courses, **What my teacher knows about me** shows the short private
notes Colleague keeps about how you learn: strengths, difficulties, preferences
and where you are. Colleague reads them when it starts teaching you and rewrites
them as a short summary. Only you can see them, on your own account; the
workspace owner and other people cannot. They never change a step's status or
whether a lesson is complete. Colleague reads them as a description of you, not
as instructions, so they cannot change its teaching or judging rules.

- **Nothing yet. Colleague adds notes as it teaches you.** means there are none.
- **Edit** (or **Write notes**) opens a text box (Markdown, at most 4000
  characters, with a counter); **Save** keeps your version, **Cancel** discards
  it. Below the notes, **Updated by Colleague** or **Updated by you** shows who
  changed them last and when.
- **Clear**, then **Clear all notes**, deletes them; **Keep them** cancels.
  Colleague starts again from nothing.
- If Colleague changed the notes while you were editing, **Save** is refused with
  "The notes changed since they were read…", the current notes are shown and
  your edit stays in the box: combine it and press **Save** again.
- Another failed save shows its message; press **Save** again.

## Reading a lesson

The left column (top row on a phone) lists the steps in order. Each shows its
title and **Passed**, **Not yet passed**, **Not checked yet** or **Optional**
(an optional step you have passed or marked done says **Done**). A passed step
shows a check mark instead of its number, so marking every step done leaves an
unbroken row of green check marks.
Select a step to read it. Only this attempt's results count: after **Restart**
or a redo every step starts again as not passed. When every required step has passed the list says
**Every required step is passed. This lesson is complete.** with a **Lesson
finished** button (in a narrow pane one short row under the step circles:
**✓ Lesson complete** and **Lesson finished**). **Lesson finished** opens the
lesson finished screen again.

A step shows **Step N of M**, its title and its text. Depending on the step it
also has:

- **Diagram** with **Play**: Play starts the diagram from its beginning and runs
  its animation in order. Play again replays it; saving your place in the
  lesson while it plays does not interrupt it. If a diagram fails, use
  **Reload diagram** on it.
- **Question**: tick every correct option, then **Check answer**. The answer
  is compared on the server; the result appears as the step's status. You can
  try again until it passes. Once passed, the question says **You already passed
  this question, so answers are not checked again.** and **Check answer** stays
  disabled; the pass is kept. The options you ticked in the passing answer
  stay ticked, also after a reload or in another browser.
- **Automatic check**: a step about an App interaction says "This step is
  checked automatically when you do it in your practice project", for example
  by pressing a button in its Preview. For a button step, read the step in
  the Lesson pane, then select **Preview** (**Show me** does this) and press the
  App's button yourself in the practice project's visible Preview. Your press
  counts only for the lesson step Learning currently shows, in that lesson's
  own practice session, while Courses is not covering the app; the
  status updates when the check finishes. The step's check decides whether
  the App's response is the expected one: a press that shows a different
  response is checked too and leaves the step not passed yet. In a new browser tab, open the lesson
  once before pressing. Colleague cannot press for you, and Run or
  reloading the Preview is not a press. A code step names the file to change
  and says "Make this change yourself in Dashboard → Files. Saving does not
  check it: press Check now when you are ready." **Check now** asks the check to
  look again. When it has not passed, the reason appears under **Check now**
  (for example that no press in the lesson's Preview was captured yet, or
  "needs your own change: edit `<file>` yourself in Dashboard → Files during
  this step, then press Check now"); the status does not change.
- A step you already passed in this attempt keeps its pass: a later
  **Check now** (or an answer sent again) is not checked again and shows "You
  already passed this step, so this was not checked again. Your earlier pass
  counts."
- **Done**: for a step you check yourself; the step's text says when to press
  it. A step already passed (in this attempt or one before, for example when you
  retake a lesson) says **You already passed this step, so it does not need to
  be marked done again.** and **Done** stays disabled.
- **Mark as done**: a step you only read (no question, check or **Done**) has
  a quieter **Mark as done** button beside **Next step**. Pressing it records
  the step as done and moves to the next step. The step then says **Done** and
  **You marked this step done.**, and the button no longer appears. These
  reading steps are optional: marking them is not needed to finish the lesson.
- **Show me**: closes Courses if it is open, opens the real place in the app (for example
  the practice project's Preview or a Dashboard section) and rings the control
  with a short caption. A step about one file opens that file in the practice
  project's **Dashboard → Files** editor. A step about the database (**ERD** or
  **Data**) opens **Dashboard → Database** for the practice project's selected
  session, opening the practice project first when another page is showing.
  The ring stays for a few seconds, also on a phone while the practice
  project's page is still loading, and clears when you tap or click anywhere.
  Click the control yourself. If the place is not
  available on the current page, the step comes back in the Lesson pane with the
  reason; open your practice project and try again.
- **Teach me**: opens Colleague beside the step and sends it the message
  "Teach me this step." for you. The step stays on screen in the Lesson pane;
  Colleague answers in its conversation. On a phone Colleague's full-screen chat opens over the step.
  If Colleague is not connected yet, an error says so; press **Teach me** again.
  If no AI is connected yet, nothing is sent:
  Colleague opens and says **Colleague cannot teach this step yet: it has no
  usable AI model, so nothing was sent.** with **Open AI Accounts**. Connect an
  AI there, then press **Teach me** again; no Models step is needed,
  because Colleague saves the recommended models for a connected AI itself.
  The message disappears as soon as an AI is usable.
- **Lesson notes** (when the lesson has them) and **Previous step** /
  **Next step**.
- Links in a step or its notes that go to another website (for example Z.AI's
  key page) open in a new browser tab, so Vibe64 and your lesson stay open.

Statuses come only from automatic checks, the answer comparison and your own
**Done** or **Mark as done**. Colleague never decides a step's status and does not know the
correct answers of a question.

## Lesson finished

When your own step result (in the Lesson pane, or an automatic check from your
Preview press) completes the last required step, the Lesson pane opens on the
**Lesson finished** screen: a check mark,
**LESSON FINISHED**, the lesson title and "You completed every required step: X
of Y steps passed." It finishes the lesson for you ("Finishing the lesson…"):
the lesson is archived with its practice project and conversation under
**Courses → Archived**, and you stay in Learn mode with no lesson in progress.
If finishing is not confirmed, an error appears with **Finish lesson**; press it
to try again. You don't need an AI for this. Then choose:

- **Next lesson: <title>** starts the next unfinished lesson of the same course
  (when there is one).
- **Back to courses** opens the Courses overlay; the Lesson pane goes away, since
  no lesson is in progress.

## The current step in Colleague

While a lesson is going, Colleague's header (next to **Colleague** and its −
and × buttons, on a desktop and in the phone's full-screen Colleague, also
during voice chat) shows a small yellow **Step N/M** button with a school icon,
or a check once that step has passed. Its tooltip is **Current lesson step:
<step title>**. It is hidden while Colleague is minimised.

Press it to see the current step in the page's **Lesson** pane (above), at that
step, with Colleague still open beside it on a desktop. On a phone Colleague's
full-screen chat minimises so the Lesson pane is visible; its avatar button
brings Colleague back. The step bar, the Lesson pane, Courses and Colleague share
one lesson state, so they and other tabs stay in step.

On a phone, when Colleague shows a lesson step for you its full-screen chat
minimises and the Lesson pane shows that step. When Colleague opens Courses for
you, closing Courses (× or Escape) returns you to Colleague's chat, not the page
behind it. **Show me** still shows the app.

An ended lesson stays readable with the note **This lesson has ended.** and a
**Go to Courses** button, where **Start lesson** starts it again as a new
attempt.

## Problems

- An error banner at the top of the lesson has **Retry**, which reads the
  lesson again. A failed **Check answer**, **Done** or **Check now** shows its
  message; press the same button again.
- A failed **Restart**, **Delete** or archived-lesson delete shows its message
  in the Attempts list, not in the lesson; it stays there until you try that
  change again.
- If your lessons could not be read, the Attempts list says so; the message
  goes away as soon as they are read again, for example when you reopen the
  tab.
- Signing out or switching account closes Courses and the lesson and clears the
  previous person's place on this device.

## What Colleague can do

Colleague can explain these controls, show your current step in the Lesson pane,
open or close the Courses overlay, point at or open a real place (the L button,
a Dashboard section, your account menu and more), and teach a step when you press **Teach me** or
ask. In Learn mode it opens and works only in the lesson's practice project;
when you ask for another project it says you're in Learn mode and that **L**
goes back to your projects. It switches mode, restarts or archives a lesson
only when you ask it to, and deletes a lesson only after you confirm that exact
lesson. It cannot press **Done**, answer a question or pass a check for you;
those are your own actions. Colleague can read and rewrite its notes about you when you ask
(for example "forget that I find Git hard"); only you can **Clear** them.
