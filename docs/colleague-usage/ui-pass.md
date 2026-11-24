# Run a UI pass

A UI pass brings the screens of your app in line with the project's UI
guidance: layout, spacing, typography, colours, controls and how screens
behave at narrow and wide widths. For a Material 3 project it follows that
guide's method and checks the screens against it. It keeps what each screen
does; a real defect it finds is fixed separately, proven by a test that failed
first. What is outside its scope it fixes too when the session can; only what
needs you or what the session can't reach goes on the plan's **Leftovers** list.
Senior checks the screens it changed in the managed browser and reports what
changed and what it verified. It never commits, pushes or publishes.

The UI pass sits beside Deslop. Deslop cleans up code; the UI pass cleans up
screens. In main chat each runs as an item of a plan's **Passes** section: a
new plan's Passes include it while it is ticked under **After a plan** in
[Passes](passes.md#choose-the-passes-each-new-plan-starts-with), and asking for
it in the chat adds it to the open plan, or to a small plan of its own.

## Ask for a UI pass in the chat

Type one of these as the whole message in main chat and send it:

| Message | What the UI pass covers |
| --- | --- |
| `UI pass` | The changes since your last plan (the same as `UI pass: this task's changes`). In a lesson or **Fix it with AI**, the changes the current task made. |
| `UI pass: the bookings pages` | That named part of the app. Name it in your own words. |
| `UI pass: the whole app` | Every screen of the app. |

With no plan open, the chat says **New plan for the passes you asked for:**
followed by the small plan's title, and the UI pass starts. With a plan open,
it says **Added to the plan's Passes: UI pass.**, and the pass runs when the
plan reaches it.

`UI pass on …` and `UI pass for …` work as well as the colon. A message that
only mentions the UI pass, such as “What does the UI pass change?”, is ordinary
chat and starts nothing.

**Whole app** under **UI pass** in the chat's **Passes** list sends `UI pass
the whole app.` for you, and **Since last completed (…)** the changes since
the UI pass last completed, judged against the whole app; only those runs are
recorded as the UI pass completing. See [Run a pass on your app](passes.md).

The UI pass runs in its own turn on your **Senior** model, whatever the chat
mode, the way “Deslop” does; in **Custom** it uses the Custom model. It ends
**Done**, ticking its item in the plan's Passes, or **Needs you**, with numbered
questions; your reply goes straight back to it.

It cannot start while:

- the AI is still working: the chat says **UI pass uses the Senior model in its
  own turn. Finish or stop the current turn, then send UI pass again.**
- a goal is unfinished: the chat says **UI pass can't start during the current
  goal.** Open **Goal** and choose **Resume goal** to finish it, or **Cancel
  goal** to end it, then send it again.

In both cases the message is marked as not sent, with **Edit** and **Cancel**,
so you can send it again once the chat is free. If your Senior model is
unavailable, or cannot use coding tools, the UI pass is refused with that
reason instead of running on Junior; choose a Senior model in **Models**.

## Run it as part of each new plan

While its **After a plan** tick in
[Passes](passes.md#choose-the-passes-each-new-plan-starts-with) is ticked, as it
is for new chats, each new plan's Passes section includes **UI pass: the plan's
changes**. Once Senior has reviewed the plan, it runs in its own turn on your
**Senior** model, after the passes before it in the plan and before Deslop,
over the changes since the plan's work started, and the chat notes **UI pass
started: the plan's next pass (UI pass: the plan's changes)** as it starts. It
never runs on its own after a request without a plan, when a turn ends or when
you **Save**: type **UI pass** for that work instead. To leave it out of one
plan, ask Senior to remove it from that plan's Passes.

The tick is saved for each chat, so a chat that has it unticked keeps it so
until you tick it, and its change applies to plans made later. It is the
owner's main chat choice: team members don't see Passes, and the ticks are
unavailable while a goal is active. Temporary chats and AI tasks have no plans;
ask for a UI pass there and it runs as its own turn.

## Ask Colleague

Colleague can explain the UI pass and its scopes. It can also:

- start one: ask, for example, “Run a UI pass on the bookings pages in this
  session”; Colleague sends the matching `UI pass` message to main chat, which
  you then see there. A team member's message waits for the owner's approval as
  any other main chat message does.
- tick or untick the UI pass **After a plan** for the owner through the chat
  mode action, and tell you whether it is ticked.

A question or an offer starts nothing; Colleague acts only on your direct
request or an offer you accept.

See [Run a pass on your app](passes.md) for a plan's passes, [Choose
what happens once work is finished](chat-settings.md) for automatic save,
[Choose Auto roles and follow the workflow](auto-workflow.md) for Auto, and
[Goals and model changes](coding-agent-goals.md) for goals.
