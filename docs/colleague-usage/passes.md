# Run a pass on your app

A pass is one kind of improvement the AI makes to your app in one go, such
as **Deslop** (simpler code that does the same thing), the **UI pass**
(screens in line with the project's UI guidance), **Review** (a test for each
behavior the app should have) and the other passes Genesis offers: **Visual
identity**, **Quality pass**, **Data pass**, **Security pass**, **User
experience pass** and **Speed pass**. Genesis writes what each pass does and
the runs it offers; Vibe64 lists them, runs the one you choose, runs the ones
you tick after each completed plan and suggests one now and then. The
**Master pass** runs several passes deeply, one after another.

## Open the Passes list

Select the checklist button (**Passes**) in the row under the main chat's
message box. On a phone the list opens as a sheet from the bottom of the
screen; on a wider screen it opens above the button.

Each row shows the pass's name, one line on what it does, and when it was
last completed in this project, with the number of commits since then (**Last
completed: Nov 10, 2026 · 12 commits since**), or **Never completed**. Genesis
keeps that date: it records it when the pass completes, in the project's own
files, so it travels with the project and counts passes completed in any
session. A pass that is running, or was stopped before it finished, still
shows its last completed date, or **Never completed**.

## Run a pass

Under each pass is a button for each run Genesis offers for it:

- **Whole app** runs the pass over the whole app: the project's own code and
  screens in every part of it, never generated, vendored or dependency files.
- **Since last completed (abc1234, 42 commits)** appears once the pass has
  completed and the commit that recorded it is still in the project's
  history. It starts from the changes since that commit, here 42 commits
  since `abc1234`, and judges them against the whole app, so what they
  duplicate, or should reuse, elsewhere in the app counts too.
- **Deep (212 files, 18,450 lines)** runs the pass over the whole app item by
  item: the AI first writes a checklist of every file of the project's own code
  (here 212 files, 18,450 lines) and everything the pass adds, such as every
  screen for the UI pass, then reads each one in full and ticks it only with
  evidence you can check, such as a named test or a commit. Under the buttons
  the list says **Deep reads every file: it takes much longer and uses far more
  of your AI's allowance.** Its report opens with the count, such as **212 of
  212 items ticked with evidence**.

Select a run. The list closes and main chat sends that run's own request,
which Genesis writes, as your message, which you see in the chat, such as
**Deslop the whole app.** or **Quality pass: the changes since commit abc1234,
judged against the whole app.** The pass runs in its own turn on your
**Senior** model, as **Deslop** and **UI pass** do when you type them;
**Stop** ends it like any other turn. A **Whole app** or **Since last
completed** run never commits, pushes or publishes: save its work as usual. A
**Deep** run commits its own work as it goes, in small commits that each say
what changed and why, and never pushes or publishes: save its work as usual.

Genesis records a pass as completed only after one of these runs finishes.
Typing **Deslop** or **UI pass** yourself works on your own changes for the
current task, and a narrowed pass you type, such as **UI pass: the bookings
pages**, works on that part; neither is recorded as the pass.

The run buttons are unavailable while:

- the AI is working: the list says **A pass starts when the AI is idle.
  Wait for the current turn to finish, or stop it.**
- a goal is unfinished: the list says **A pass can't start during a goal.
  Open Goal to resume or cancel it first.**

If a pass is refused anyway, for example because a turn started at the same
moment, the list shows the reason, such as **Quality pass uses the Senior
model in its own turn. Finish or stop the current turn, then send Quality
pass again.** Nothing starts; select the run again once the chat is free.

## Run the Master pass

The **Master pass** is the last entry in the Passes list. It runs several
passes deeply, one after another, so you can ask for all of them at once.

Under it is a tick box for each pass it runs, all ticked when the list
opens, in the order it runs them: **Review**, **Security pass**, **Data
pass**, **Quality pass**, **Speed pass**, **User experience pass**, **Visual
identity**, **UI pass** and **Deslop**. Untick a pass to leave it out. The
order stays the same whichever passes you tick: Review comes first, so every
later pass starts from tested work, then security, so the others build on what
it fixes, and Deslop last, so it tidies up after them. With nothing ticked, its
buttons are unavailable.

Its buttons are its runs, each with its size:

- **Whole app (212 files, 18,450 lines)** runs each ticked pass as a Deep run
  over the whole app.
- **Since last completed (abc1234, 7 commits; 12 files, 960 lines)** appears
  once a Master pass has completed and the commit that recorded it is still in
  the project's history. Each ticked pass then works through the changes since
  that commit deeply: every changed file, the code those changes use or
  replace, and a check of the whole app for anything they repeat or leave
  unused. The size counts the files those changes touch.

Under the buttons the list says **Runs each ticked pass deeply, one after
another: it takes much longer and uses far more of your AI's allowance.**

Select a run. The list closes and main chat sends Genesis's request as your
message: **Master pass the whole app.** with every pass ticked, or one naming
the ticked passes, such as **Master pass (Security pass, Data pass, Deslop)
the whole app.** It runs in its own turn on your **Senior** model, and
**Stop** ends it like any other turn. The AI finishes each pass before the next
starts: its work committed and the app's whole test suite passing. A pass that
does not apply, such as the UI pass in an app without screens, is skipped with
its reason. It keeps a ledger of where it is, so sending the same run again
after a stop carries on from there. Its report covers every pass: its
checklist count, what changed, its commits and anything it left for you to
decide. It never pushes or publishes: save its work as usual.

Each pass it runs is recorded as completed when it finishes, and so is the
Master pass, once every ticked pass has finished.

## Choose the passes that run after a plan

Passes start on their own at one moment only: when a plan is completed. They
never start when a turn ends, after a request without a plan or when you
**Save**; then a pass runs only when you start it from this list, with the
Master pass, or by typing it.

Beside each pass's runs is an **After a plan** tick. Above the passes the list
says **After a plan: when a plan is completed, each ticked pass checks the
plan's changes in its own turn, in Master pass order, then Automatically save
changes runs if it is on. Nothing runs after a request without a plan.**

- **Review** and **Security pass** are always ticked and can't be unticked:
  each says **Always runs after a plan.**
- **Data pass**, **Quality pass**, **UI pass** and **Deslop** are ticked in a
  new chat; **User experience pass**, **Speed pass** and **Visual identity** are
  not.
- A pass whose Genesis offers a deep run over a plan's changes also has a
  **Deeply** tick, which you can tick once **After a plan** is ticked. A deep
  run works through every changed file item by item: it takes much longer and
  uses far more of your AI's allowance. None is ticked in a new chat.

A tick saves at once, for this chat, and applies to the next completed plan. If
Vibe64 refuses the change, the tick goes back and the list shows why. Before
the chat has a **Chat mode**, the list says **Choose a Chat mode to change
these; until then the ticked passes run after a plan.** During a goal the ticks
are unavailable, and the list says **After a plan can change once the current
goal finishes.** Lessons and Fix it with AI show no ticks: they run no pass
after a plan.

### What happens when a plan is completed

When Senior completes a plan (see [Choose what happens once work is
finished](chat-settings.md#when-work-is-finished)), the ticked passes run one
after another, in the Master pass order: **Review**, **Security pass**, **Data
pass**, **Quality pass**, **Speed pass**, **User experience pass**, **Visual
identity**, **UI pass**, **Deslop**. Each runs in its own turn on your
**Senior** model, with Genesis's request for the changes since the plan's work
started, such as **Security pass: the changes since base commit abc1234…,
judged against the whole app.**, or, ticked **Deeply**, **Security pass
deeply: …**. Each judges those changes against the whole app. The commit they
start from is where the plan's work started: the commit Vibe64 noted when the
previous passes after a plan finished, or when a plan became current with none
noted, otherwise where the session's work left the project's main history.

After the last pass, the completed plan is archived and, with **Automatically
save changes** on, **Save** runs. These runs never change a pass's **Last
completed** date or its **Since last completed** run: only the runs you start
from this list count.

### What the chat shows after a plan

Each pass adds a notice as it starts, such as **Security pass started
automatically after the plan (Passes: After a plan)**, or **Data pass deeply
started automatically after the plan (Passes: After a plan)**.

- A ticked pass this project's Genesis can't run is skipped with its reason,
  such as **User experience pass skipped after the plan:** followed by the
  reason the Passes list gives for it.
- When Vibe64 can't tell where the plan's work started, no pass runs: **The
  passes didn't run after the plan: Vibe64 can't tell where this plan's work
  started in the session's history. Run them from Passes.** The plan is then
  archived and saved as usual. Vibe64 never runs a whole-app pass instead.
- **Stop**, or a pass turn that fails, ends the passes: **The passes after the
  plan stopped: Security pass was stopped, so Security pass, Data pass, Deslop
  didn't finish and nothing was saved automatically. Run them from Passes.** The
  completed plan stays as it is, and **Resume** doesn't restart them: start the
  passes you still want from this list, then **Save**.

## When the project's Genesis is too old

A project runs passes with its own Genesis, the `genesis-compiler` version in
its `package.json`. When that version cannot run passes, the list says so
above the passes and names the update, such as **This project's Genesis
(genesis-compiler 1.10.15) cannot run passes. Update it to 1.10.21 or later
with npm install --save-dev genesis-compiler@1.10.21, then commit the
change.** The passes are still listed, without run buttons, and none is
suggested. When the version runs passes but lacks one, only that pass says
so (**This project's Genesis (genesis-compiler …) has no …**), followed by
the same update; a version from before the Master pass says so under it,
such as **This project's Genesis (genesis-compiler 1.10.21) has no Master
pass.** When the project's Genesis runs passes in a different way
from the Genesis this Vibe64 runs, the list says **This project's Genesis
(genesis-compiler …) runs passes differently from genesis-compiler 1.10.21.
Update the older of the two.**; the older one may be the project's or this
Vibe64's. When the project's dependencies are not
installed, the list says **This project's Genesis (genesis-compiler) is not
installed. Install the project's dependencies with npm install.**

Ask the AI in main chat to make the update the list names, then save it as
usual; the runs appear the next time you open the list.

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
completed is suggested once the app has that many commits in all. A pass that
was never completed comes first; otherwise the one most overdue for its
interval is suggested.

- Each run button, such as **Whole app**, starts the pass exactly as that
  run does in the list. A suggestion never offers the **Deep** run: open the
  Passes list for it, where its cost is shown.
- **Later** hides the suggestion for a week.
- **Dismiss** hides it until that pass runs and completes again.

A suggestion only offers: it never starts a pass by itself.

## Who can run passes

Passes run on the workspace owner's main chat, so the **Passes** button,
its **After a plan** ticks and suggestions appear for the owner only. A team
member asks the owner, or sends **Deslop** or **UI pass** in the chat, which
waits for the owner's approval like any other message. A team member's
request to change the passes after a plan is refused with **Main chat runs on
the workspace owner's AI. Only the owner can change its chat mode, passes after
a plan, Chat settings or model.**

## Ask Colleague

Colleague can explain the passes, their runs (Deep included), the Master pass,
the passes that run after a plan and how suggestions work, and tell you which
passes are ticked **After a plan**. It can start **Deslop** or a **UI pass** on
your own changes for you by sending that message to main chat (see [Run a UI
pass](ui-pass.md)). For the owner it can tick or untick **After a plan** and
**Deeply** through the chat mode action; it can't untick **Review** or
**Security pass**, and it unticks a pass only when you ask, after saying what
is lost. For a pass's runs or the Master pass, select one in the Passes list
yourself.
