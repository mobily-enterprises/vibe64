# Run a pass on your app

A pass is one kind of improvement the AI makes to your app in one go, such
as **Deslop** (simpler code that does the same thing), the **UI pass**
(screens in line with the project's UI guidance) and the other passes
Genesis offers: **Visual identity**, **Quality pass**, **Data pass**,
**Security pass**, **User experience pass** and **Speed pass**. Genesis writes
what each pass does and the runs it offers; Vibe64 lists them, runs the one
you choose and suggests one now and then.

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

Select a run. The list closes and main chat sends that run's own request,
which Genesis writes, as your message, which you see in the chat, such as
**Deslop the whole app.** or **Quality pass: the changes since commit abc1234,
judged against the whole app.** The pass runs in its own turn on your
**Senior** model, as **Deslop** and **UI pass** do when you type them;
**Stop** ends it like any other turn. It never commits, pushes or publishes:
save its work as usual.

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

## When the project's Genesis is too old

A project runs passes with its own Genesis, the `genesis-compiler` version in
its `package.json`. When that version cannot run passes, the list says so
above the passes and names the update, such as **This project's Genesis
(genesis-compiler 1.10.15) cannot run passes. Update it to 1.10.21 or later
with npm install --save-dev genesis-compiler@1.10.21, then commit the
change.** The passes are still listed, without run buttons, and none is
suggested. When the version runs passes but lacks one, only that pass says
so (**This project's Genesis (genesis-compiler …) has no …**), followed by
the same update. When the project's dependencies are not
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
| after each change | Deslop, UI pass | 7 days and 20 commits |
| once a first working version exists | Visual identity | 90 days and 30 commits |
| every few weeks of active work | Quality pass, Data pass, Security pass, User experience pass, Speed pass | 21 days and 30 commits |

A pass is suggested once both parts of its interval have passed since it
last completed: the days, and that many commits. A pass that was never
completed is suggested once the app has that many commits in all. A pass that
was never completed comes first; otherwise the one most overdue for its
interval is suggested.

- Each run button, such as **Whole app**, starts the pass exactly as that
  run does in the list.
- **Later** hides the suggestion for a week.
- **Dismiss** hides it until that pass runs and completes again.

A suggestion only offers: no pass ever starts on its own.

## Who can run passes

Passes run on the workspace owner's main chat, so the **Passes** button and
suggestions appear for the owner only. A team member asks the owner, or
sends **Deslop** or **UI pass** in the chat, which waits for the owner's
approval like any other message.

## Ask Colleague

Colleague can explain the passes, their runs and how suggestions work. It
can start **Deslop** or a **UI pass** on your own changes for you by sending
that message to main chat (see [Run a UI pass](ui-pass.md)). For a pass's
runs, select one in the Passes list yourself.
