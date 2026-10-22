# Lesson history and step results

An *attempt* is one run of a lesson. It starts with **Start lesson** and ends
only when you finish the lesson, restart it or delete it. Its step results, its
practice project (when the lesson has one) and its teacher conversation all
belong to that attempt. These rules apply on desktop and phone.

## One lesson in progress

You have at most one lesson in progress. It can stay paused, with its practice
project, for as long as you like: switching to Develop (press **L**) or closing
the browser never ends it, and **L** brings you back to it in Learn mode.

Learn mode itself is saved separately from any lesson, so Learn mode with no
lesson in progress is normal. Your mode and current lesson survive a reload.

Starting a different lesson while one is in progress asks once whether to
archive the current one first; cancelling keeps it in progress. Starting the
lesson that is already in progress just opens it. Colleague can explain this
and archives the current lesson only on your request.

## How an attempt ends

- **Finished**: when every required step has passed, finishing the lesson
  archives the attempt. A lesson that is not complete cannot be finished.
- **Restart**: archives this attempt and starts a new one of the same lesson
  content, with a fresh practice project, teacher and step results.
- **Delete**: removes the attempt's practice project and conversation without
  archiving them.

Archiving the current lesson to start another one ends it like **Restart**,
without finishing it. Once an attempt has ended, its step results and the code
it recorded for code steps are removed; the archived bundle keeps what you
built. Lessons written in the retired first format (quiz questions instead of
steps) cannot be started.

## Step results

Step results belong to the attempt in progress: a choice answer, **Done** on a
self-check step, **Mark as done** on a reading step, or an automatic check
result. A lesson is complete when every
required step has passed in that attempt. A new attempt (**Restart**, or
starting a lesson again after finishing it) begins with no results.

Once any attempt of a lesson has finished, the course list keeps showing that
lesson as completed, even after its attempts are archived, deleted or dropped
from history.

Only these record a pass: the automatic check run by your own action (pressing
the App's control in the lesson's Preview, or **Check now** on a code step after
editing the files yourself), the server's answer comparison, or **Done**. When
Colleague runs a step check it only reports what the check found; nothing is
saved, so it can neither record a pass nor use up the lesson's results.
Colleague never sees or reveals choice answers. After a step passes, later
answers or checks for it change nothing. An attempt keeps at most 64 step
results and always keeps room for one pass of each step not yet passed: a
"not yet" result that would use that room is shown but not saved, so retries
never block a later pass. Code you write in the attempt's practice project
counts for its code steps; code from an earlier attempt never does. The lesson
remembers the last step and scroll position across reloads.

## History limits

Each learner keeps at most 32 attempts. Starting another lesson removes the
oldest ended attempts to make room; it is never refused for lack of space.
Completed lessons are kept separately, so pruning never loses a completion.
Missing or corrupt pinned content needs exact owner restoration, even when no
lesson is in progress. Reading state never repairs a missing record or creates
a substitute workspace; ask the installation owner to inspect corrupt, foreign
or missing content rather than changing the lesson.
