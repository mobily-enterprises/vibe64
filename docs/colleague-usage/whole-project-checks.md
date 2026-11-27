# Run the whole-project checks after a plan

Once a plan is finished, Vibe64 asks you once whether to run the project's
whole-project checks now, such as one whole run of the test suite. **Yes** runs
them once in a Senior turn that fixes what they find; **No** runs nothing.

## Why no step of a plan runs them

The whole-project checks are the checks the project runs as a whole, such as one
whole run of the test suite. They can take a long time, and the plan's passes
would leave a run before them behind, so no step of a plan runs them: not
Junior's implementation, not Senior's review (see [A plan's
steps](plan-steps.md#a-plans-steps)) and not a pass. Each step runs the focused tests
for what it changed. Outside a plan the AI follows the same rule: it runs the
whole test suite only with your OK, which it asks for once the work is complete,
saying what will run and roughly how long.

## What they run

The whole-project checks are the checks your project's Stack declares under
**Verification**, each part its own entry: its lint, unit tests, database
tests, client tests, browser tests and build. A part missing from Verification
is a part no whole run covers, so if one is missing, ask the coding agent to
declare it. The project's one command for a whole run (`npm run verify`, for
example) runs exactly those parts, once each, the browser tests included, never
just a list of them. The coding agent sets each part up to report how long it
took and its 10 slowest test files, and to take the number of tests run at once
from the computer that runs them, never a fixed number in the project.

Genesis records a pass as completed only after its whole run passed, or after
you said to finish without it. So a plan's passes that Genesis records (run
over the **Whole app**, **Since last completed** or **Deep**; see [Run a pass on
your app](passes.md)) are not recorded in their own turns: they wait for your
answer here.

## The question

Once the plan is finished (completed, archived and, with **Automatically save changes**
on, saved), the chat asks, after the save's own note: **The plan is finished.
Run the whole-project checks once now, on the finished plan's work?** The line
above the message box shows **Run the whole-project checks once now?** with
**Yes** and **No**. While the assistant answers, both stay greyed out, with the
reason beside them.

## Your answer

- **Yes** sends **Yes, run the whole-project checks once now, on the finished
  plan's work. The plan is finished, so this is new work, not one of its
  steps.** as your message, and Senior runs them once in its own turn, labelled
  **Whole-project checks**, without the Router (a Custom chat's own agent runs
  them in a Custom chat). Its reply records each check, its command, whether it
  passed and its counts.
  It fixes what they find as new work, each fix proven by a test that failed
  first, and never runs them a second time: after a fix it runs that fix's
  focused tests. It explains every failure and never calls one pre-existing or
  environmental: a missing tool or a refusal by the environment is a defect to
  fix, reported with what is missing. It runs them in the session, never
  detached to outlive it. Once every check passes, it records the plan's passes
  that waited for this answer. The plan stays completed. When it fixed something, the fixes
  are saved like any other finished work (with **Automatically save changes**
  on); when everything passed and nothing changed, nothing is saved.
- **No** runs nothing. The chat notes **Whole-project checks not run. Vibe64
  won't ask again for this plan.** When the plan ran passes that Genesis
  records, the note names them, for example **Deslop stays unrecorded as
  completed, since the whole-project checks didn't run.**
- **Typing a message instead** ends the question too, and that message's turn is
  told what Vibe64 had asked: when it asks for the checks (**yes, run them**,
  say), the AI runs them once; otherwise it does what you asked.

## Asked once

Vibe64 asks only once per finished plan: after Yes, No or another message, it
never asks again, and nothing runs the checks without your Yes or your request.
A plan finished before this question existed is not asked about. Colleague can
explain the question and, at your request, answer it for you through its chat
action: Yes sends that message with the whole-project checks marked to run, and
No answers the finished plan's request with the No.

## An older plan that lists the whole run

A plan made before this rule may have an item such as **The whole test suite
passes**. Senior's review never ticks it on focused tests, which would claim a
proof that never ran: it rewrites the item, as a plan change within the agreed
outcome, into what its review proves (the focused tests for the plan's changes
pass), notes in Progress that the whole run is offered once the plan is
finished, and reviews the plan again as it now stands, ticking what the
evidence proves.
