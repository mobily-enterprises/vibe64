# AI tasks

An AI task is a specific job given to an agent: a problem, the conversation that
works on it, the proof that it worked, and an outcome. People find it in one
window that presents the problem and its solution, or the lack of one, together.
A task ends **Done** or **Not done**. Done is proved, never assumed; Not done is
decided by a person. Update, Save, workspace preparation, preview sign-in, incoming
merge, project setup and the Data overview have moved to AI tasks so far. Other repairs, and repairs recorded before this change, stay in
[temporary assistance](temporary-assistance.md) until they move.

## The server owns a task

A task is a nested `task` field on its temporary conversation record. It holds the
kind, phase, reason, problem, attempt, pending effect, log and outcome. One pure
machine moves it and is the only writer of the field, apart from copying a
conversation into a development copy. Everything else asks: a client sends a
command, a finished turn sends an event, and the runner carries out the effect the
machine asked for. A task therefore keeps going without a browser, and reads the
same after a reload, on another device and for another member.

Each move adds to the task's `revision`, so a late answer can never replace a newer
one in a browser. A browser's conversation snapshot carries only `task.kind`; the
prompts a task carries never reach it, and a task's own route presents the task
without them.

The kinds are plain objects on the server, so a check or retry survives restart.
A kind says what the task is called, its steps, how it opens, and how it is proved.
Each kind lives in its own file under `kinds/`. Update's check runs Vibe64's Update
operation with the task's recorded conflict review. Save's check runs Vibe64's Save
to the destination the session has now, so a fixed Save pushes by itself; work a
person saved meanwhile counts, because nothing left to save after a ready Save means
Save succeeded. A Save refused for a reason only a person can settle (a changed
destination review, connected projects, Update first, nothing to save) stops at
`needs_you(check_stuck)` without asking the AI again. Workspace preparation's check
runs Vibe64's preparation retry and waits for its result; it refuses to start while
Update is failed, because Update prepares the workspace again. Preview sign-in's
check runs the application's identity command for the identity the person chose;
the browser sends that identity and its error as the task's input. An incoming
merge's check runs the explicit repair review and refuses leftover conflict markers;
its conflict also arrives as input, because only the person's Merge met it. Merge
stays the person's reviewed action. Project setup's check re-reads the opening
inspection; one kind covers repair, adopt, inspect and create, so its problem names
the task (`title`, `noun`, `opening`). The Data overview's check reads the overview
back through the database service: present, valid against the refreshed schema and,
for a whole or new-tables review, with no table unreviewed. A database that can't be
read is not the AI's to repair. Input is untrusted text: a check hands it
back to its owner, which validates it again. Any other failed check goes
back to the same conversation up to three times.

One task at a time runs in a session, whatever its kind and whoever started it.
Starting the same problem reopens the open task; starting another is refused. A task
that ended and waits for Close doesn't block: starting a new one closes it.
Repository operations refuse to start during a task that changes the repository,
apart from the task's own check. The session's Update, Save and Prepare actions,
and Incoming's Merge, Discard and review, are refused this way, not hidden. A
button's view reloads when its task ends Done (`done`).

A completed repair runs its check by itself, on the server, whether or not any
browser watched the turn end. A failed check returns to the same conversation.
A person's Check, Continue or review carries on from where the task stopped.

Cancel is always accepted at once and recorded. A turn is stopped through the
existing native Stop. Update, Save, Prepare and a sign-in have no real stop, so a task cancelled
during such a check waits for the run to end, and says so.

A turn lost to a restart stops at `needs_you(interrupted)` with Continue. A check
interrupted by a restart runs again with the same request identity, so the
existing Update operation is recovered rather than repeated. Connecting,
disconnecting or switching an AI account never stops or waits on a running turn;
a failure caused by an account stops at `needs_you(ai_unavailable)`. Archiving a
session ends its open task as Not done, and the archive dialog warns about it first.

## The window

`Vibe64AiTaskWindow` is one component for every kind. It knows nothing about
sessions or stores: a source object supplies the task and what a person can do to it.
`projectAiTask` turns a task into words, steps and actions in one place, and the
server's phase and reason decide them all.

Screen fit is one rule for every task. Under 600 px wide, or under 560 px tall at any
width, the window fills the screen and honours the safe area; the short-height case
folds the header and problem into two rows. From 600 px it is a dialog of
`min(92vw, 46rem)` by `88dvh`, and from 960 px `46rem` by `min(80dvh, 46rem)`. The
height is fixed, so the window never jumps as its content changes. Touch targets are
48 px on coarse pointers, and motion stops under reduced motion.

The window has a header with a status line, the problem, a Progress and Chat tablist
with arrow keys, the chosen view, and a footer present only while the person is
needed. The outcome replaces the problem strip and views, and Close replaces Hide and
Cancel. The window opens on Chat when the AI asked something or the person decides
the end, otherwise on Progress, and never switches view by itself.

Esc hides an active task and closes an ended one. Clicking outside does nothing. Focus
goes to the title on open, never the composer, then to the outcome heading when the
task ends, and back to the opener or the tray on leaving. `?aiTask=<id>` names the
open window, so a reload, a copied link and phone Back all behave as a person expects.

The app-bar tray is one chip, never a list, because a session has one task. It shows
how the hidden task is going and reopens it. The Fix it with AI button follows the same
task: **Opening…**, **Being fixed… →** and **See result →**. A task ending while its
window is hidden raises a toast with **See result**, and a person whose window someone
else closes hears how the task ended.

Chat reuses the temporary conversation's delivery, draft and attachment code through
an ownership filter. A record with `task` belongs to the window and never appears as a
temporary chat; a record without one belongs to the temporary workspace.
