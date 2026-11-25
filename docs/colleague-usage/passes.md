# Run a pass on your app

A pass is one kind of improvement the AI makes to your app in one go, such
as **Deslop** (simpler code that does the same thing), the **UI pass**
(screens in line with the project's UI guidance), **Review** (a test for each
behavior the app should have, and each defect it finds fixed after its failing
test) and the other passes Genesis offers: **Visual
identity**, **Quality pass**, **Data pass**, **Security pass**, **User
experience pass** and **Speed pass**. Genesis writes what each pass does and
the runs it offers; Vibe64 lists them and suggests one now and then.

In main chat, passes always run as part of a plan: the plan's last section,
**Passes**, lists them, one checklist item each, and the plan is the only list.
A plan's steps are **Implementation**, **Senior review**, **Passes** and
**Completed**: once Senior has reviewed the plan, each pass in its Passes
section runs in its own turn, in the plan's order, and after the last one
Vibe64 completes and archives the plan. A pass you start with no plan open
gets a small plan of its own, which runs at once.

## Open the Passes list

Select the checklist button (**Passes**) in the row under the main chat's
message box. On a phone the list opens as a sheet from the bottom of the
screen; on a wider screen it opens above the button.

Each row shows the pass's name, one line on what it does, and when it was
last completed in this project, with the number of commits since then (**Last
completed: Nov 10, 2026 · 12 commits since**), or **Never completed**. Genesis
keeps that date: it records it when the pass completes, in the project's own
files, so it travels with the project and counts passes completed in any
session.

## Run a pass

Under each pass is a button for each run Genesis offers for it:

- **Whole app** runs the pass over the whole app: the project's own code and
  screens in every part of it, never generated, vendored or dependency files.
- **Since last completed (abc1234, 42 commits)** appears once the pass has
  completed and the commit that recorded it is still in the project's
  history. It starts from the changes since that commit and judges them
  against the whole app.
- **Deep (212 files, 18,450 lines)** runs the pass over the whole app item by
  item: the AI writes a checklist of every file of the project's own code and
  everything the pass adds, reads each one in full and ticks it only with
  evidence you can check. The list says **Deep reads every file: it takes much
  longer and uses far more of your AI's allowance.**

Select a run. The list closes and main chat sends that run's own request,
which Genesis writes, as your message, such as **Deslop the whole app.** Then:

- With no plan open, the list says **A run starts a small plan of its own with
  that pass, which runs at once.** The chat says **New plan for the passes you
  asked for: Passes: Deslop, whole app.** and the pass starts.
- With a plan open, the list says **A run joins this plan's Passes.** The chat
  says **Added to the plan's Passes: Deslop.** If the plan is already at its
  passes, the next one runs now; if Senior hasn't reviewed it yet, Senior says
  in a sentence or two that the pass runs once the plan is reviewed, and runs
  nothing.

Each pass runs in its own turn on your **Senior** model. A **Whole app** or
**Since last completed** run never commits, pushes or publishes; a **Deep** run
commits its own work in small commits and never pushes or publishes. Save its
work as usual, or let **Automatically save changes** save it once the plan is
completed.

You can also type passes in main chat: **Run the Security and Data passes**,
**Do the UX and UI passes deeply**, **Run every pass on the whole app**,
**Deslop**, or **UI pass: the bookings pages**. They join the plan the same
way. With no run named they check the changes since your last plan (**the
changes since abc1234**); **Run the Master pass** runs every pass deeply. A
message steered into a running turn is a steer, never a pass.

In a lesson or **Fix it with AI**, a run is its own turn, as there are no
plans: typing **Deslop** or **UI pass** works on your own changes for the
current task.

Genesis records a pass as completed only after a **Whole app**, **Since last
completed** or **Deep** run of it finishes; a pass over a plan's changes or a
section of the app is not recorded as the pass.

The run buttons are unavailable while:

- the AI is working: the list says **A pass starts when the AI is idle.
  Wait for the current turn to finish, or stop it.**
- a goal is unfinished: the list says **A pass can't start during a goal.
  Open Goal to resume or cancel it first.**

If a pass is refused anyway, for example because a turn started at the same
moment, the list shows the reason. Nothing starts; select the run again once
the chat is free.

## Run several passes

**Several passes**, the last entry in the list, runs the passes you tick with
one run for all of them. Its tick boxes, **Passes to run, in this order**, are
in Genesis's order: **Review**, **Security pass**, **Data pass**, **Quality
pass**, **Speed pass**, **User experience pass**, **Visual identity**, **UI
pass** and **Deslop**. None is ticked when the list opens. Its buttons are
**Whole app**, **Since last completed** (only when every ticked pass offers it)
and **Deep**. The list says **Tick passes and choose one run for all of them.
They join the plan's Passes and run one after another, each in its own turn.**

Select a run. Main chat sends a message such as **Run Security pass, Data pass
and Deslop deeply.**, and the passes join the open plan's Passes, or a small
plan of their own, such as **Passes: Security pass, Data pass and Deslop,
deep**, one item each, in that order. A pass that never completed takes the
whole app for **Since last completed**.

## A plan's passes

While a plan with passes is open, the list starts with **This plan's passes**:
one line with each pass and its state, such as **Review ✓ · Security pass ✓ ·
Data pass: needs you · Quality pass · Deslop**. A state is **✓** (done),
**running**, **needs you** (it asked you questions), **paused** (you stopped
it), **can't run** (the chat says why) or **waiting**. Until Senior has reviewed
the plan, the list says **These run once Senior has reviewed the plan.**

Once the plan is at its passes:

- **Continue** runs the plan's next pass: its first one not ticked.
- **Run Review again**, under each done pass, unticks it and runs it now.
- **Restart from the first pass** unticks every pass and runs the first.

Each sends a short message as yours, such as **Continue the plan's passes.**
Before Senior's review they are refused with **This plan's passes start once
Senior has reviewed the plan.**

### How each pass runs

Vibe64 reads the next pass from the plan each time: the first unticked item
in its Passes section, such as **Security pass: the plan's changes**. The chat
says **Security pass started: the plan's next pass (Security pass: the plan's
changes)**. The pass runs Genesis's request for that item, such as **Security
pass: the changes since base commit abc1234…, judged against the whole app.**

A pass fixes what it finds within its scope, each fix proven by a test that
failed first: the pass decides what it looks for, not what it may fix. Review
writes the failing test and then fixes the code; Deslop keeps its cleanups
behaviour-neutral but fixes a real defect as a separate fix with its own test.
What is outside the scope is fixed too when the session can fix it: data and
files the AI created, small defects it found, a step that fails. A failing or
flaky test is a defect to fix until it passes every run, never a leftover. The
plan's one **Leftovers** list in Progress holds only what needs you (a choice, a
real device, an account, a click) or what the session can't reach, each with its
reason; a choice is asked as a numbered question with a recommended answer.
Vibe64 refuses a Progress whose Leftovers name a failing or flaky test, and
refuses to complete a plan while they do, so the AI fixes the test instead.
A plan's pass runs the focused tests for what it changed, never the
whole-project checks (such as one whole run of the test suite), even where the
pass's own guidance asks for one: no step of a plan runs them.

Senior's review and every pass end one of two ways:

- **Done**: everything within its scope is fixed and proven. It ticks its item,
  and the next pass starts in a new turn.
- **Needs you**: numbered questions, each with a recommended answer, in the
  chat and in the plan's Progress. The plan waits: **Waiting for your answer.
  Reply in chat to continue.** Your reply goes straight back to that pass, on
  Senior, which records each answer as a rule in Progress and finishes. If your
  message asks for something else, the pass does that first.

A pass never ends with "partial" or "for later": when it runs out of room it
carries on in its next turn. Say **don't ask, pick your recommendation** in the
chat and it is written into Progress with the time; every later step then picks
the recommended answer and records the choice instead of waiting.

**Stop** pauses the plan at that pass. **Continue** in the list, or **Resume**
in the chat, runs it again from the plan.

The last pass (or Senior's review, for a plan without passes) is the plan's
finishing step: first it fixes whatever Progress still holds that the session
can fix. After it, Vibe64 completes and archives the plan, and its reply is the
plan's one closing message: a line per step saying what it fixed, the choices
made for you, and the Leftovers, each with its reason. It never offers to make a
plan for them. Then, with **Automatically save changes** on, **Save** runs, and
Vibe64 asks you once whether to run the whole-project checks, with **Yes** and
**No** above the message box; see [Run the whole-project checks after a
plan](whole-project-checks.md).

### What the chat shows while a plan's passes run

- A pass the Genesis serving this project can't run holds the plan at that
  pass, skipping nothing: **User experience pass can't run:** followed by the
  reason, then **Change the plan's Passes, or put it right and choose Continue
  in Passes.**
- When Vibe64 can't tell where the plan's work started, a pass over the plan's
  changes holds the plan the same way: **Review can't run: Vibe64 can't tell
  where this plan's work started in the session's history.** Vibe64 never runs
  a whole-app pass instead.

## Choose the passes each new plan starts with

Beside each pass's runs is an **After a plan** tick. These ticks are only the
starting point for new plans: when a plan is made, its Passes section starts
with the ticked passes, each over the plan's changes, in Genesis's order. The
list says **After a plan: each new plan's Passes section starts with the
ticked passes, which check the plan's changes, each in its own turn, once
Senior has reviewed the plan. To change one plan's passes, change that plan.**
A plan Senior writes with its own Passes section, because you asked for other
passes, keeps it.

- **Review** and **Security pass** are always ticked and can't be unticked:
  each says **Always in a new plan's Passes.**
- **Data pass**, **Quality pass**, **UI pass** and **Deslop** are ticked in a
  new chat; **User experience pass**, **Speed pass** and **Visual identity** are
  not.
- A pass whose Genesis offers a deep run over a plan's changes also has a
  **Deeply** tick, which you can tick once **After a plan** is ticked. Its item
  then reads **the plan's changes, deeply**. None is ticked in a new chat.

A tick saves at once, for this chat, and applies to plans made later; an open
plan keeps its own Passes. To change those, ask in the chat (Senior changes
the plan) or start a pass from this list. If Vibe64 refuses the change, the
tick goes back and the list shows why. Before the chat has a **Chat mode**, the
list says **Choose a Chat mode to change these; until then the ticked passes
run after a plan.** During a goal the ticks are unavailable, and the list says
**After a plan can change once the current goal finishes.** Lessons and Fix it
with AI show no ticks.

The commit a plan's changes start from is where its work started: the commit
Vibe64 noted when the previous plan finished, or when a plan became current
with none noted, otherwise where the session's work left the project's main
history.

## Which Genesis runs the passes

Every project runs its passes with the Genesis this Vibe64 runs, whatever its
language and whatever `genesis-compiler` version its `package.json` lists, so
every pass this Vibe64 offers runs in every project. A project never needs to
list Genesis, install it or update it for passes.

The one exception is Genesis's own source repository (its `package.json` is
named `genesis-compiler`), which runs passes with its own source. There the
list can say that this source cannot run passes, such as **This Genesis source
(genesis-compiler 1.10.15) cannot run passes.**, that it lacks one pass, or
that it runs passes differently from this Vibe64's Genesis (**… runs passes
differently from genesis-compiler 1.10.25. Update the older of the two.**).
Such a pass is listed without run buttons and never suggested.

## Suggestions

Now and then a short suggestion appears above the message box, such as
**Your app has changed a lot since Quality pass was last completed. Run it
again? 42 commits in 25 days.**, or **Data pass has never been completed on
this app. Run it? 64 commits so far.** It appears only while the chat is
idle: no turn running, no goal, and nothing typed in the message box. One
pass is suggested at a time.

Each pass has an interval, from Genesis's advice on when to run it:

| Genesis suggests running it | Passes | Suggested again after |
| --- | --- | --- |
| after each change | Deslop, UI pass, Review | 7 days and 20 commits |
| once a first working version exists | Visual identity | 90 days and 30 commits |
| every few weeks of active work | Quality pass, Data pass, Security pass, User experience pass, Speed pass | 21 days and 30 commits |

A pass is suggested once both parts of its interval have passed since it
last completed: the days, and that many commits. A pass that was never
completed is suggested once the app has that many commits in all, and comes
first; otherwise the one most overdue for its interval is suggested.

- Each run button, such as **Whole app**, starts the pass exactly as that
  run does in the list. A suggestion never offers the **Deep** run: open the
  Passes list for it, where its cost is shown.
- **Later** hides the suggestion for a week.
- **Dismiss** hides it until that pass runs and completes again.

A suggestion only offers: it never starts a pass by itself.

## Who can run passes

Passes run on the workspace owner's main chat, so the **Passes** button,
its **After a plan** ticks and suggestions appear for the owner only. A team
member asks the owner, or types a pass, such as **Deslop**, in the chat, which
waits for the owner's approval like any other message. A team member's
request to change the **After a plan** ticks is refused with **Main chat runs
on the workspace owner's AI. Only the owner can change its chat mode, passes
after a plan, Chat settings or model.**

## Ask Colleague

Colleague can explain the passes, their runs (Deep included), a plan's Passes
section and steps, Several passes and how suggestions work, and tell you which
passes are ticked **After a plan**. It can start passes for you by sending them
to main chat, one or several with a run, where they join the open plan or a
plan of their own, and it can **Continue**, **Run again** or **Restart** the
open plan's passes. For the owner it can tick or untick **After a plan** and
**Deeply** through the chat mode action; it can't untick **Review** or
**Security pass**, and it unticks a pass only when you ask, after saying what
is lost.
