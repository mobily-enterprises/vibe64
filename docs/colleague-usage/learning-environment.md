# The Learning environment (L)

Learning does not belong to a project. The yellow-outlined **L** button opens
the Learning environment above whatever page you are on; closing it returns you
to exactly that page. The app underneath keeps working and is never replaced.

## Where the L button is

- Home and project pages: the first button at the left of the header.
- Hosted management pages (Projects, Users, AI Accounts and the other
  management screens): the first control in the header, after the menu button.
- It is the same size as the other header icon buttons (40px on a phone) and
  the first keyboard stop in the header; Enter or Space presses it.
- Tooltips: **Open Learning**, **Close Learning** while it is open, and
  **Return to your lesson** when the lesson is minimised. A minimised lesson
  also shows a small amber dot on the L.
- It appears only for a signed-in person. Hosted Vibe64 shows it after the
  account prerequisites are complete.

Pressing **L** again while Learning is open closes it. The old Learning mode
(tinted header, graduation-cap tab, teacher conversation) has been retired; an
earlier `?mode=learning` address opens the ordinary project page, and earlier
lesson history stays readable in Learning.

## The Learning screen

Learning fills the screen. Its top bar shows the L mark, a **Courses** tab, a
tab named after your open lesson, **Minimise** and a close button (✕, label
**Close Learning**). Escape also closes it.

- **Minimise** hides Learning but keeps everything as it was, so the app and
  Colleague are visible. Press **L** to come back.
- **Close Learning** returns to the page you were on. Your place is kept too:
  reopening L shows the same tab, lesson, step and scroll position.
- Your place is also saved for your account. A reload in the same tab reopens
  L where it was; in another browser L opens on **Courses**, and **Resume saved
  lesson** opens the lesson at the step you last read.

On a phone Learning is a full-screen sheet. The lesson's steps become a row of
numbered circles at the top (a tick for a passed step); the step text scrolls
below them. When there are more circles than fit, the row scrolls sideways and
follows the current step as you press **Next step** or **Previous step**, or
reopen the lesson, so the step you are reading always stays in view.

## Courses

**Courses** is the same course page as before: course cards with progress,
**View course** with its lesson path and statuses, **Refresh courses**, the
**Course catalogue** with **Install** and **Update** (see
[Installing and updating Learning courses](learning-course-catalogue.md)) and,
for the workspace owner, **New course** (see
[Choosing lessons and courses](learning-mode-ui.md)).

- **Start**, **Start next lesson**, **Start lesson** or **Try preview** start
  the lesson and open it straight away in the lesson tab. No teacher chat is
  created.
- **Continue** and **Resume saved lesson** open your saved lesson.
- If a start was not confirmed, **Retry lesson start** repeats the same request.
- On hosted Vibe64 the workspace owner also sees **Author trial** with
  **Resume author trial**, which opens the admitted draft snapshot in the same
  reader (see the hosted author-trial guide).

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
**Every required step is passed. This lesson is complete.** with a **Finish
lesson** button. **Finish lesson** ends the lesson (its results are kept, as
with any ended lesson) and returns to **Courses**, where the next lesson can be
started. You don't need Colleague for this, so it also works before an AI is
connected. If finishing is not confirmed, the error appears at the top of the
lesson; press **Finish lesson** again.

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
  disabled; the pass is kept.
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
- **Done**: for a step you check yourself; press it when you have done the step.
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
  "Teach me this step." for you. The step stays pinned above Colleague's chat.
  If Colleague is not connected yet, an error says so; press **Teach me** again.
- **Lesson notes** (when the lesson has them) and **Previous step** /
  **Next step**.
- Links in a step or its notes that go to another website (for example Z.AI's
  key page) open in a new browser tab, so Vibe64 and your lesson stay open.
- **Open practice project** (when the lesson has one) minimises Learning and
  opens that project.

Statuses come only from automatic checks, the answer comparison and your own
**Done**. Colleague never decides a step's status and does not know the
correct answers of a question.

On a phone, **Open lesson** on the step card in Colleague's full-screen chat
minimises that chat and shows the lesson at that step.

An ended lesson stays readable with the note **This lesson has ended.** A lesson
started in the earlier teacher format shows **This lesson was started with the
earlier teacher format** and **End this lesson**; end it, then start it again
from Courses. Its earlier completions still count.

## Problems

- An error banner at the top of the lesson has **Retry**, which reads the
  lesson again. A failed **Check answer**, **Done** or **Check now** shows its
  message; press the same button again.
- Signing out or switching account closes Learning and clears the previous
  person's place on this device.

## What Colleague can do

Colleague can explain these controls, open Learning on a lesson and step,
point at the L button, and teach a step when you press **Teach me** or ask. It
cannot press **Done**, answer a question or pass a check for you; those are
your own actions. Colleague can read and rewrite its notes about you when you ask
(for example "forget that I find Git hard"); only you can **Clear** them.
