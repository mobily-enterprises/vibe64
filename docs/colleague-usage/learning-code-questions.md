# Answering a code question in a lesson

This is part of [Choosing lessons and Learning conversations](learning-mode-ui.md).


Some practice lessons ask you to change code, for example "make `notes.mjs`
refuse an empty title". To answer:

1. Choose **Dashboard**, then **Files** in the session tools. It is
   the ordinary source editor for this lesson's practice project: the file list,
   **New file at source root**, **Download file**, **Star file** and a file's
   **⋮** actions menu (**Star file**, **Download file**, **New file here**,
   **Copy path**) work as in any project. Files open as code; the **Interface**
   view is not available in a lesson. **Explain** is shown but disabled; its
   tooltip says to ask your lesson teacher in Learning. On a phone, use the files
   button to show or hide the file list.
2. Open the file the teacher named and edit it. Your changes save automatically
   a moment after you stop typing; the editor shows when a save has finished.
3. Choose the graduation-cap option beside **Preview** and **Dashboard** (on a
   phone, the next-pane button labelled **Learning**) and press **Check my code** in the
   code-check bar docked at the bottom of its **Courses** view (it stays in view while you scroll).
   The button is there whenever a practice lesson is open; it checks only an open
   code question. The lesson's declared check runs on a private copy of
   the pinned exercise with your saved version of the named files. The result
   appears in that bar: a green **Check passed** with "Your code passed the check…",
   an amber **Not yet** with the check's reason (for example "Empty or blank titles are
   still accepted", or that the check stopped after its time limit because the
   code never finished), or a red **Could not check** saying what to do first. Fix the code and press **Check my code** again as often
   as you like; only your latest check counts.
4. After a passing check, explain to your teacher in Learning, in your own
   words, what you changed and why. The teacher submits that explanation with the
   check for grading. A pass is saved only when the check passed **and** the
   explanation meets the lesson's rubric.

What counts: only edits you saved yourself in the **Dashboard → Files** editor since the
teacher asked the question. If anything else changed a named file in the
meantime—the teacher or another assistant, a terminal command, Git, or another
editor—the check does not run and reports "needs an independent attempt: other
edits detected in `<file>`". That question cannot pass; ask the teacher for a new
question and write the change yourself. The teacher is instructed not to edit
those files or send solution code; it can give hints and point to lines.
Checking never saves progress by itself, and a check without your explanation
is not a pass. **Check my code** requires this lesson's Learning conversation
to be connected in this browser. Every press either checks your code or shows
why it could not in the line under the button: "This lesson's Learning
conversation is not open here" (open the lesson conversation, then press again),
"This lesson's Learning conversation is still loading its saved question" (wait
until the Learning chat shows its messages, then press again), "There is no open
lesson question yet" or a report that the question is not a code question (ask
the teacher for the code question first), or "Earlier presses are still being
handled" (wait, then press again). An asked, unanswered code question stays open
when the server restarts or the page reloads, including the next day: open the
lesson again and press **Check my code**; you do not need a new question, and
your earlier saves in **Dashboard → Files** still count. Colleague can explain
these steps but cannot type, save or check code for you.

## Code steps in step-based lessons

In newer, step-based lessons a code step names the files to change. Opening the
step records their starting contents; reopening the same step keeps that start,
while opening another code step starts a new one for that step. Only your own
saves in **Dashboard → Files** since you opened the step count; any other change
to a named file makes the check report "needs an independent attempt: other edits
detected in `<file>`" without running. If the step has no recorded start, the
check says so: open the step again, then make your change. The pass is recorded
only when you press the step's **Check** yourself; a check Colleague runs reports
the result without recording a pass. No explanation or grading is needed.
