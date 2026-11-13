# Run a pass on your app

A pass is one kind of improvement the AI makes to your app in one go, such
as **Deslop** (simpler code that does the same thing), the **UI pass**
(screens in line with the project's UI guidance) and the other passes
Genesis offers: **Visual identity**, **Quality pass** and **Data pass**. Genesis writes
what each pass does; Vibe64 lists them, runs the one you choose and
suggests one now and then.

## Open the Passes list

Select the sparkles button (**Passes**) in the row under the main chat's
message box. On a phone the list opens as a sheet from the bottom of the
screen; on a wider screen it opens above the button.

Each row shows the pass's name, one line on what it does, and when it last
ran in this project, with the number of commits since then (**Last run: Nov
10, 2026 · 12 commits since**), or **Never run**. Genesis keeps that date: it
records a pass's run when the pass completes, in the project's own files, so
it travels with the project and counts runs from any session.

## Run a pass

Select **Run** beside the pass. The list closes and main chat sends the
pass's own request, which Genesis writes, as your message, which you see in
the chat. **Deslop** and the **UI pass** work on your own changes for the
current task (**Deslop your own changes for the current task.**); the other
passes work on the whole app (**Quality pass the whole app.**). To narrow a
pass, type it yourself instead, such as **UI pass: the bookings pages**. The
pass runs in its own turn on your **Senior** model, as **Deslop** and
**UI pass** do when you type them; **Stop** ends it like any other turn. It
never commits, pushes or publishes: save its work as usual.

**Run** is unavailable while:

- the AI is working: the list says **A pass starts when the AI is idle.
  Wait for the current turn to finish, or stop it.**
- a goal is unfinished: the list says **A pass can't start during a goal.
  Open Goal to resume or cancel it first.**

If a pass is refused anyway, for example because a turn started at the same
moment, the list shows the reason, such as **Quality pass uses the Senior
model in its own turn. Finish or stop the current turn, then send Quality
pass again.** Nothing starts; select **Run** again once the chat is free.

## Suggestions

Now and then a short suggestion appears above the message box, such as
**Your app has changed a lot since Quality pass last ran. Run it again? 42
commits in 25 days.**, or **Data pass has never run on this app. Run it?
64 commits so far.** It appears only while the chat is idle: no turn
running, no goal, and nothing typed in the message box. One pass is
suggested at a time.

Each pass has an interval, from Genesis's advice on when to run it:

| Genesis suggests running it | Passes | Suggested again after |
| --- | --- | --- |
| after each change | Deslop, UI pass | 7 days and 20 commits |
| once a first working version exists | Visual identity | 90 days and 30 commits |
| every few weeks of active work | Quality pass, Data pass | 21 days and 30 commits |

A pass is suggested once both parts of its interval have passed since it
last ran: the days, and that many commits. A pass that never ran is
suggested once the app has that many commits in all. A pass that never ran
comes first; otherwise the one most overdue for its interval is suggested.

- **Run** starts the pass, exactly as **Run** in the list does.
- **Later** hides the suggestion for a week.
- **Dismiss** hides it until that pass runs and completes again.

A suggestion only offers: no pass ever starts on its own.

## Who can run passes

Passes run on the workspace owner's main chat, so the **Passes** button and
suggestions appear for the owner only. A team member asks the owner, or
sends **Deslop** or **UI pass** in the chat, which waits for the owner's
approval like any other message.

## Ask Colleague

Colleague can explain the passes and how suggestions work. It can start
**Deslop** or a **UI pass** for you by sending that message to main chat
(see [Run a UI pass](ui-pass.md)). For the other passes, select **Run** in
the Passes list yourself.
