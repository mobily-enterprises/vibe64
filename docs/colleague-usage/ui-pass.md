# Run a UI pass

A UI pass brings the screens of your app in line with the project's UI
guidance: layout, spacing, typography, colours, controls and how screens
behave at narrow and wide widths. For a Material 3 project it follows that
guide's method and checks the screens against it. It keeps what each screen
does; a defect that would need a behavior change is reported, not fixed. Senior
checks the screens it changed in the managed browser and reports what changed
and what it verified. It never commits, pushes or publishes.

The UI pass sits beside Deslop. Deslop cleans up code; the UI pass cleans up
screens. Each runs either automatically after each piece of work, when its
switch is on, or when you ask for it in the chat.

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

## Run it automatically after each piece of work

**Automatically UI pass changes**, under **Chat settings** in **Chat mode**
(the icon inside the message box), is on for new chats and works in every chat
mode. While it is on, once a piece of work is finished, the agent that finishes it
(Senior in **Auto**, otherwise the chat's own agent) runs the UI pass on the
screens that work changed, after any review and Deslop, in the same turn and
before **Save**. The chat notes **UI pass started automatically (Chat settings:
Automatically UI pass changes)** as it starts. Nothing runs on its own while the
switch is off.

It is saved for each chat, so a chat that has it off keeps it off until you
turn it on, and its change applies to the next piece of work. Turning it on
saves at once. Turning it off asks first, as the other switches do: **Turn off
Automatic UI pass?** says that the screens the work changes will no longer get
a design review, and that typing “UI pass” in the chat still runs one. **Cancel** keeps it on; **Turn off
Automatic UI pass** saves it off. The line under the switch is a reminder of the
chat command: **Or tell the agent “UI pass” any time — add “: <section>” or “:
the whole app”.** The chat-mode button's label adds **Automatic UI pass on**
while it is on. It is the owner's main chat choice: a team member sees it
disabled, and it is disabled while a goal is active. Temporary chats and AI
tasks have no automatic UI pass; ask for one in main chat instead. See [Choose
what runs after each piece of work](chat-settings.md) for all four switches.

**Chat mode** and the switch are the same on desktop and mobile.

## Ask Colleague

Colleague can explain the UI pass and its scopes. It can also:

- start one: ask, for example, “Run a UI pass on the bookings pages in this
  session”; Colleague sends the matching `UI pass` message to main chat, which
  you then see there. A team member's message waits for the owner's approval as
  any other main chat message does.
- turn **Automatically UI pass changes** on or off for the owner through the
  chat mode action, and tell you whether it is on.

A question or an offer starts nothing; Colleague acts only on your direct
request or an offer you accept.

See [Choose what runs after each piece of work](chat-settings.md) for the
switches, [Choose Auto roles and follow the workflow](auto-workflow.md) for
Auto, and [Goals and model changes](coding-agent-goals.md) for goals.
