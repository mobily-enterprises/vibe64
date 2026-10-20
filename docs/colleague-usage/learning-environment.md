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
(tinted header, graduation-cap tab, teacher conversation) is no longer opened
by L; earlier lesson history stays readable. If a page is still in the old
mode (an earlier `?mode=learning` address or a Colleague request), L is lit
and titled **Leave Learning mode and open Learning**: pressing it leaves that
mode and opens the Learning environment.

## The Learning screen

Learning fills the screen. Its top bar shows the L mark, a **Courses** tab, a
tab named after your open lesson, **Minimise** and a close button (✕, label
**Close Learning**). Escape also closes it.

- **Minimise** hides Learning but keeps everything as it was, so the app and
  Colleague are visible. Press **L** to come back.
- **Close Learning** returns to the page you were on. Your place is kept too:
  reopening L shows the same tab, lesson, step and scroll position.
- Your place is also saved for your account, so another browser or a reload
  opens the lesson at the step you last read.

On a phone Learning is a full-screen sheet. The lesson's steps become a row of
numbered circles at the top (a tick for a passed step); the step text scrolls
below them.

## Courses

**Courses** is the same course page as before: course cards with progress,
**View course** with its lesson path and statuses, **Refresh courses**, the
**Course catalogue** with **Install** and **Update** (see
[Installing and updating Learning courses](learning-course-catalogue.md)) and,
for the workspace owner, **New course** (see
[Choosing lessons and Learning conversations](learning-mode-ui.md)).

- **Start**, **Start next lesson**, **Start lesson** or **Try preview** start
  the lesson and open it straight away in the lesson tab. No teacher chat is
  created.
- **Continue** and **Resume saved lesson** open your saved lesson.
- If a start was not confirmed, **Retry lesson start** repeats the same request.
- On hosted Vibe64 the workspace owner also sees **Author trial** with
  **Resume author trial**, which opens the admitted draft snapshot in the same
  reader (see the hosted author-trial guide).

## Reading a lesson

The left column (top row on a phone) lists the steps in order. Each shows its
title and **Passed**, **Not yet passed**, **Not checked yet** or **Optional**.
Select a step to read it. When every required step has passed the list says
**Every required step is passed. This lesson is complete.**

A step shows **Step N of M**, its title and its text. Depending on the step it
also has:

- **Diagram** with **Play**: Play starts the diagram from its beginning and runs
  its animation in order. Play again replays it. If a diagram fails, use
  **Reload diagram** on it.
- **Question**: tick every correct option, then **Check answer**. The answer
  is compared on the server; the result appears as the step's status. You can
  try again.
- **Automatic check**: the step is checked when you do the task in your practice
  project, for example by pressing a button in its Preview. **Check now** asks
  the check to look again.
- **Done**: for a step you check yourself; press it when you have done the step.
- **Show me**: minimises Learning, opens the real place in the app (for example
  the practice project's Preview or a Dashboard section) and rings the control
  with a short caption. A step about one file opens that file in the practice
  project's **Dashboard → Files** editor. Click the control yourself. If the place is not
  available on the current page, Learning comes back with the reason; open
  your practice project and try again.
- **Teach me**: minimises Learning, opens Colleague and sends it the message
  "Teach me this step." for you. The step stays pinned above Colleague's chat.
  If Colleague is not connected yet, an error says so; press **Teach me** again.
- **Lesson notes** (when the lesson has them) and **Previous step** /
  **Next step**.
- **Open practice project** (when the lesson has one) minimises Learning and
  opens that project.

Statuses come only from automatic checks, the answer comparison and your own
**Done**. Colleague never decides a step's status and does not know the
correct answers of a question.

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
your own actions.
