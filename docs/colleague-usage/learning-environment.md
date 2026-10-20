# The Learning environment (L)

Learning does not belong to a project. The yellow-outlined **L** button opens
the Learning environment above whatever page you are on; pressing **L** again
hides it and returns you to exactly that page. The app underneath keeps working and is never replaced.

## Where the L button is

- Home and project pages: the first button at the left of the header.
- Hosted management pages (Projects, Users, AI Accounts and the other
  management screens): the first control in the header, after the menu button.
- It is the same size as the other header icon buttons (40px on a phone) and
  the first keyboard stop in the header; Enter or Space presses it.
- Tooltips: **Open Learning**, **Hide Learning** while it is open, and
  **Return to your lesson** when the lesson is hidden. A hidden lesson also
  shows a small amber dot on the L.
- It appears only for a signed-in person. Hosted Vibe64 shows it after the
  account prerequisites are complete.

**L** is the one control that opens and hides Learning.

## Learning mode (a lesson in progress)

A lesson is either in progress or not. While one is in progress (started and
not yet left or finished), you are in learning mode everywhere in Vibe64, for
your account: in every tab and on every device. The header stays Learning yellow, with a warm yellow wash and an amber
line along its bottom, even after you hide Learning and work in the normal app.
On a desktop the bar also shows the lesson's name and a **Leave lesson**
button; on a phone the yellow header and the amber dot on the L say it, and
**Leave lesson** is in Learning's own header.

In learning mode you are in your learning space only (see
[Practice projects](learning-practice-projects.md)):

- The lesson's practice project is the one project you can open. Hosted
  project lists are empty, with the note "You're in a lesson. Leave lesson to
  get back to your projects." A local Vibe64 shows the practice project instead
  of the project it was started in.
- Opening any other project (for example from a saved address) is refused with
  that note and you are taken to the practice project.
- Lesson 0 and other lessons without a practice project open no project; they
  use the Learning page (below).
- Nothing inside the lesson's practice project is limited: Preview, Files,
  Database, coding chats and Colleague all work. Account settings and AI
  Accounts stay available, so you can connect an AI during a lesson.

**Leave lesson** is always one click (the yellow bar on a desktop, Learning's
header, the Learning page, or the note shown when another project was refused).
It ends the lesson: your step results and the practice project are kept,
learning mode ends, the header returns to normal and your projects come back.
A practice project page, or the Learning page of a lesson without a practice
project, then goes to `/app` (on a local Vibe64, your project). To return, press **Continue
lesson** in **L** → **Courses**, or **Open** in **L** → **Practice**: a new
attempt starts in the same practice project (a new one if it was deleted), at
the first required step you have not passed, and you are back in learning
mode. Finishing the lesson (the **Lesson finished** screen) also ends learning
mode. There is no paused lesson. The workspace owner works the same way.

## The Learning page and `/app`

The Learning page (`/app/learning`) is the place for a lesson without a
practice project, such as Lesson 0. It has the normal header with **L**, the
yellow bar and **Leave lesson** during a lesson, and **Account settings** at the
right, and it opens **L** on the lesson. Hide **L** and the page shows the
lesson's name with **Open Learning** and **Leave lesson**. Outside a lesson it
opens **L** on **Courses**, with **Back to your projects**.

A local Vibe64 has no Projects page. Its `/app` address opens the lesson's
practice project during a lesson, the Learning page during a lesson without one,
and otherwise the project Vibe64 was started in, without reloading the page
(**L** stays as it was). If no project was started, it says so with **Try
again**. On hosted Vibe64 `/app` is the Projects page.

An old `?mode=learning` address from the retired Learning mode opens the ordinary
project page.

## The Learning screen

Learning fills the screen, covering the header, so its own top bar starts with
the same yellow **L** in the same place, followed by a **Courses** tab, a
**Practice** tab and a tab named after your open lesson. There is no separate minimise or close
button.

- Press that **L** (label **Hide Learning**, tooltip **Hide Learning (your
  place is kept)**; a 48px target on a phone) or Escape to hide Learning. The
  page you were on, and Colleague, are visible again, and the header **L**
  shows the amber dot.
- Press **L** again to come back to exactly where you were: the same tab,
  lesson, step and scroll position.
- Your place is also saved for your account. A reload in the same tab reopens
  L where it was; in another browser L opens on **Courses**, and **Continue
  lesson** opens the lesson at the step you last read.

On a phone Learning is a full-screen sheet; the **Courses** and **Practice**
tabs always show in full, a long lesson title is shortened, and the tab row
scrolls sideways when it does not fit. The lesson's steps become a row of
numbered circles at the top (a tick for a passed step); the step text scrolls
below them. When there are more circles than fit, the row scrolls sideways and
follows the current step as you press **Next step** or **Previous step**, or
reopen the lesson, so the step you are reading always stays in view.

## Courses

**Courses** shows course cards with progress, course pages, the **Course
catalogue** and, for the workspace owner, **New course**; see
[Choosing lessons and courses](learning-mode-ui.md).

- **Start**, **Start next lesson**, **Start lesson** or **Try preview** start
  the lesson and open it in the lesson tab. No chat is created.
- **Continue lesson** opens your lesson in progress, or starts a lesson you
  left again in its practice project.
- If a start was not confirmed, **Retry lesson start** repeats the same request.
- On hosted Vibe64 the workspace owner also sees **Author trial** with
  **Resume author trial**, which opens the admitted draft snapshot in the same
  reader (see the hosted author-trial guide).

## Practice

The **Practice** tab lists your practice projects with their lesson and status,
and your archived ones. **Open**, **Archive** and **Delete** are one click each;
see [Practice projects](learning-practice-projects.md).

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
title and **Passed**, **Not yet passed**, **Not checked yet** or **Optional**.
Select a step to read it. A step you passed in an earlier attempt of the same
lesson (for example before you started it again) shows **Passed** and still
counts. When every required step has passed the list says
**Every required step is passed. This lesson is complete.** with a **Lesson
finished** button (on a phone one short row under the step circles: **✓ Lesson
complete**, **Lesson finished** and **Practice**, which opens the practice
project). **Lesson finished** opens the lesson finished screen again.

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
  by pressing a button in its Preview. For a button step, open the step in
  Learning, then minimise Learning (**Show me** does this and opens the Preview)
  and press the App's button yourself in the practice project's visible Preview.
  Your press counts only for the lesson step Learning currently shows, in that
  lesson's own practice session, while Learning is not covering the app; the
  status updates when the check finishes. In a new browser tab, open the lesson
  in Learning once before pressing. Colleague cannot press for you, and Run or
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
- **Show me**: minimises Learning, opens the real place in the app (for example
  the practice project's Preview or a Dashboard section) and rings the control
  with a short caption. A step about one file opens that file in the practice
  project's **Dashboard → Files** editor. A step about the database (**ERD** or
  **Data**) opens **Dashboard → Database** for the practice project's selected
  session, opening the practice project first when another page is showing.
  The ring stays for a few seconds, also on a phone while the practice
  project's page is still loading, and clears when you tap or click anywhere.
  Click the control yourself. If the place is not
  available on the current page, Learning comes back with the reason; open
  your practice project and try again.
- **Teach me**: minimises Learning, opens Colleague and sends it the message
  "Teach me this step." for you. Colleague answers in its conversation.
  If Colleague is not connected yet, an error says so; press **Teach me** again.
  If no AI is connected yet (for example during Lesson 0), nothing is sent:
  Colleague opens and says **Colleague cannot teach this step yet: it has no
  usable AI model, so nothing was sent.** with **Open AI Accounts**. Connect an
  AI there, then press **Teach me** again; no Model routing step is needed,
  because Colleague saves the recommended routing for a connected AI itself.
  The message disappears as soon as an AI is usable.
- **Lesson notes** (when the lesson has them) and **Previous step** /
  **Next step**.
- Links in a step or its notes that go to another website (for example Z.AI's
  key page) open in a new browser tab, so Vibe64 and your lesson stay open.
- **Open practice project** (when the lesson has one) minimises Learning and
  opens that project.

Statuses come only from automatic checks, the answer comparison and your own
**Done**. Colleague never decides a step's status and does not know the
correct answers of a question.

## Lesson finished

When your own step result (in **L**, in Colleague's step dialog, or an automatic
check from your Preview press) completes the last required step, Learning opens
on the **Lesson finished** screen in the lesson tab: a check mark, **LESSON
FINISHED**, the lesson title and "You completed every required step: X of Y
steps passed. Your results are kept." It ends the lesson for you ("Finishing the
lesson…"); the yellow in-lesson state and Colleague's step button then
disappear. If finishing is not confirmed, an error appears with **Finish
lesson**; press it to try again. You don't need an AI for this. Then choose:

- **Practice project** (when the lesson has one): **Archive practice project**
  archives it (without rebuildable dependencies such as `node_modules`) and
  lists it under **Practice → Archived**. **Delete practice project** removes it
  at once, with no archive: its files, sessions and Preview are gone for good.
  **Keep** keeps it; open, archive or delete it later from **L** →
  **Practice**.
- **Next lesson: <title>** starts the next unfinished lesson of the same course
  (when there is one).
- **Back to courses**.
- **Read the lesson again** returns to the ended lesson's steps, read-only.

## The current step in Colleague

While a lesson is going, Colleague's header (next to **Colleague** and its −
and × buttons, on a desktop and in the phone's full-screen Colleague, also
during voice chat) shows a small yellow **Step N/M** button with a school icon,
or a check once that step has passed. Its tooltip is **Current lesson step:
<step title>**. It is hidden while Colleague is minimised.

Press it to see only the current step: a scrollable dialog above Colleague on a
desktop, a full-screen dialog over Colleague's on a phone (× **Close current
step**, Escape or back returns to Colleague). It shows the lesson code and title
and the step exactly as here (**STEP 3 OF 9 · OPTIONAL**, text, diagram, check,
status, **Show me**, **Teach me**). **Next step** is enabled once the step has
passed or is not required; **Previous step** goes back. There is no step list or
course browsing: use **L** for that. **Open in Learning** opens **L** at this
step; on a phone Colleague's dialog gives way to **L** and returns when you hide
**L**. **Show me** closes the dialog (on a phone also minimising Colleague) and
shows the place; if it cannot, the dialog comes back with the reason. **Teach
me** closes the dialog and asks Colleague. On the last step of a complete
lesson, **Finish lesson** takes the place of **Next step** and opens the
**Lesson finished** screen in **L**. The dialog and **L** share one
lesson state, so **L**, Colleague and other tabs stay in step.

On a phone, when Colleague opens Learning for you its full-screen chat
minimises and shows the lesson at that step; hiding Learning with **L** (or
Escape) returns you to Colleague's chat, not the page behind it. **Show me** and
**Open practice project** still show the app.

An ended lesson stays readable with the note **This lesson has ended.**

## Problems

- An error banner at the top of the lesson has **Retry**, which reads the
  lesson again. A failed **Check answer**, **Done** or **Check now** shows its
  message; press the same button again.
- Signing out or switching account closes Learning and clears the previous
  person's place on this device.

## What Colleague can do

Colleague can explain these controls, open Learning on a lesson and step,
point at the L button, and teach a step when you press **Teach me** or ask. In
learning mode it opens and works only in the lesson's practice project; when
you ask for another project it says you're in a lesson and offers to leave it.
It leaves or continues a lesson only when you ask it to, and archives or
deletes a practice project only after you confirm that exact project. It
cannot press **Done**, answer a question or pass a check for you; those are
your own actions. Colleague can read and rewrite its notes about you when you ask
(for example "forget that I find Git hard"); only you can **Clear** them.
