# Run a UI pass

A UI pass brings the screens of your app in line with the project's UI
guidance: layout, spacing, typography, colours, controls and how screens
behave at narrow and wide widths. For a Material 3 project it follows that
guide's method and checks the screens against it. It keeps what each screen
does; a defect that would need a behavior change is reported, not fixed. Senior
checks the screens it changed in the managed browser and reports what changed
and what it verified. It never commits, pushes or publishes.

The UI pass sits beside Deslop. Deslop cleans up code; the UI pass cleans up
screens. Each runs automatically after a completed plan, while it is ticked
under **After a plan** in [Passes](passes.md#choose-the-passes-that-run-after-a-plan),
or when you ask for it in the chat.

## Ask for a UI pass in the chat

Type one of these as the whole message in main chat and send it:

| Message | What the UI pass covers |
| --- | --- |
| `UI pass` | The changes the current task made (the same as `UI pass: this task's changes`). |
| `UI pass: the bookings pages` | That named part of the app. Name it in your own words. |
| `UI pass: the whole app` | Every screen of the app. |

`UI pass on …` and `UI pass for …` work as well as the colon. A message that
only mentions the UI pass, such as “What does the UI pass change?”, is ordinary
chat and starts nothing.

**Whole app** under **UI pass** in the chat's **Passes** list sends `UI pass
the whole app.` for you, and **Since last completed (…)** the changes since
the UI pass last completed, judged against the whole app; only those runs are
recorded as the UI pass completing. See [Run a pass on your app](passes.md).

The UI pass runs in its own turn on your **Senior** model, whatever the chat
mode, the way “Deslop” does; in **Custom** it uses the Custom model. It is not
reviewed again afterwards and does not change or reopen the current plan.

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

## Run it automatically after a plan

The UI pass also runs on its own when a plan is completed, while its **After a
plan** tick in [Passes](passes.md#choose-the-passes-that-run-after-a-plan) is
ticked, as it is for new chats. It then runs in its own turn on your **Senior**
model, after the other ticked passes and before Deslop, over the changes since
the plan's work started, and the chat notes **UI pass started automatically
after the plan (Passes: After a plan)** as it starts. It never runs on its own
after a request without a plan, when a turn ends or when you **Save**: type
**UI pass** for that work instead.

The tick is saved for each chat, so a chat that has it unticked keeps it so
until you tick it, and its change applies to the next completed plan. It is the
owner's main chat choice: team members don't see Passes, and the ticks are
unavailable while a goal is active. Temporary chats and AI tasks run no pass
after a plan; ask for one in main chat instead.

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

See [Run a pass on your app](passes.md) for the passes after a plan, [Choose
what happens once work is finished](chat-settings.md) for automatic save,
[Choose Auto roles and follow the workflow](auto-workflow.md) for Auto, and
[Goals and model changes](coding-agent-goals.md) for goals.
