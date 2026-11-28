# Follow a plan's steps

Once you approve a plan in a session's Main chat, it runs through its steps on
its own, and one line above the message box says where it is. To read the plan
itself, its progress and its history, see [View a plan and its
history](plans.md).

## A plan's steps

A plan goes through four steps: **Implementation**, **Senior review**,
**Passes** and **Completed**. Once you approve it (**Implement plan**, or by
asking in chat), it runs to the end on its own; only a question for you or
**Stop** pauses it.

- **Implementation**: the plan stays here until every item outside Passes is
  built (`- [~]`). Junior works the items in the plan's order; it does one
  earlier only when the plan says another depends on it, and records why in
  Progress. It runs each item's own focused checks, never the full test suite:
  no step of a plan runs it.
  Vibe64 refuses Junior's report that it has finished while an item is still
  not done, naming the item. When the plan changes during Implementation,
  because Junior hands an item to Senior to correct, you ask for a change, or
  Senior corrects one, the chat says **Senior is changing the plan.
  Implementation continues once the change is saved.**, shows **Senior changes
  the plan.**, and once Senior has saved the change Vibe64 continues the
  implementation in a new turn without you asking. After **Stop**, a change you
  ask for waits for **Continue** like any other paused work.
- **Senior review**: one review of the plan's changes. Senior reads them
  against Plan and Progress, checks that they make sense and do what each item
  says, verifies every item outside Passes against the code as it is now, runs
  the focused tests for what changed, fixes what it finds within the plan, each
  fix proven by a test that failed first, and full-ticks each item its review
  proves. When the plan's next pass is **Review** (it is first unless you moved
  it), the same turn runs it: the chat shows **Senior reviews the plan and runs
  its Review pass.**, Senior judges the changes as Genesis's Review asks (the
  tests prove each change, the gaps, the costs) and full-ticks the Review item
  too, and Vibe64 runs no separate Review turn after it. The step is **Done**
  only when every item outside Passes and that Review item are ticked; Vibe64
  refuses Done before, naming what is open. A plan with no Review next keeps
  the review alone (**Senior reviews the plan.**). It never runs the full test
  suite. It ends **Done** or **Needs you** (numbered questions with a
  recommended answer each), or hands substantial rework back to Junior, after
  which the same review step runs again.
- **Passes**: each other item in the plan's Passes section runs in its own
  Senior turn, in order; see [A plan's passes](passes.md#a-plans-passes). A
  plan whose Senior review ended before this rule (its Review not yet run)
  runs its Review here once, as its own pass. A pass never
  runs the full test suite either, and a pass Genesis records waits for your
  answer about it before it is recorded as completed.
- **Completed**: once every item and every pass is ticked and no question is
  open, Vibe64 completes the plan and archives it, and saves it when
  **Automatically save changes** is on. Then it asks you once: **Run the full
  test suite?**; see [The full test suite](full-test-suite.md).

**Continue** resumes a paused or waiting plan from the plan as it now is,
including after items changed while it waited.

### The plan's status line

While a plan is open, one line above the message box says where it is, read
from the plan itself each time it changes:

| The line says | When |
|---|---|
| **Plan: implementing item 2 of 6, Replies join their thread** | Item 2 is the first one not built yet |
| **Plan: Senior review** | Every item is built, not every one proven yet, and Senior is reviewing it |
| **Plan: Senior review and Review pass** | The same, and the review runs the plan's Review pass in that turn: one step, until the items and the Review item are ticked |
| **Plan: ready for Senior review, ask Senior to start it** | Every item is built and nothing is reviewing it, as after a Junior chat: choose Senior or Auto and ask for the plan's review (**Plan: ready for Senior review and Review pass, …** when the review will run the Review pass too) |
| **Plan: Senior review starts when this answer ends** | Another answer came before the plan's next step (here Senior's review; also **Plan: item 2 of 6, Replies join their thread, starts when this answer ends** or a pass): it starts by itself once that answer ends (see [Auto workflow](auto-workflow.md)) |
| **Plan: pass Security (3 of 6)** | The plan is at its third pass of six |
| **Plan: needs you (2 questions)** | The chat waits for your answers |
| **Paused: item 2 of 6, Replies join their thread. Continue implementation to resume** | You stopped it (**Stop**); the line says what is paused (the item, **Senior review** or **Senior review and Review pass**, **changing the plan**, or a pass with its scope, such as **Paused: UI pass (whole app)**) and names the button above it, such as **Continue review**, **Continue the passes** or **Check delivery** |
| **Waiting: item 2 of 6, Replies join their thread. Continue implementation to resume** | Nobody stopped it, but its next step didn't start; the notice above it says why (**Details**). It doesn't go on by itself: press the button the line names |
| **Waiting: UI pass (whole app). Continue the passes is available when this answer ends** | The same while an answer is still running, which may be the assistant still working; the button stays greyed out, with that reason beside it, until the answer ends, and the plan still doesn't go on by itself after it |
| **Paused: Senior review. Send a message to go on** | Paused (or **Waiting**) with no button to resume it; your next message moves it on |
| **Plan: ready, Implement plan to start** | Senior made the plan; it waits for your go-ahead (during an answer: **Plan: ready · Implement plan is available when this answer ends**) |
| **Plan: completed** | The plan is completed and not yet archived |

A message you send while the plan's turn runs joins that turn. If the AI
service ends the turn just as your message reaches it (for example because the
signed-in AI account changed) and your message starts a turn of its own, that
turn carries on the plan's step: the plan stays where it was, and moves on by
itself when that turn ends. Only **Stop** pauses it.

The line updates as items are ticked. While files changed since the AI last
brought the plan up to date, the line ends with that count, such as **Plan:
implementing item 1 of 10, Store threads · 12 files changed since the plan's
last update**: a plan behind its work never looks current. A plan with no
checklist items shows no line.
