# Run a UI pass

A UI pass brings the screens of your app in line with the project's UI
guidance: layout, spacing, typography, colours, controls and how screens
behave at narrow and wide widths. For a Material 3 project it follows that
guide's method and checks the screens against it. It keeps what each screen
does; a defect that would need a behavior change is reported, not fixed. Senior
checks the screens it changed in the managed browser and reports what changed
and what it verified. It never commits, pushes or deploys.

The UI pass sits beside Deslop. Deslop cleans up code; the UI pass cleans up
screens. Each runs either automatically during Auto's Senior review, when its
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

## Run it automatically after each task

Open **Chat mode**, the icon inside the message box, and choose **Auto**. Below **Deslop during Senior review**, turn on **Automatic UI pass**.
From then on, whenever Auto's Senior review checks finished work, Senior also
runs the UI pass on the screens that work changed, after any Deslop, in the
same review turn and before a plan is completed or saved automatically. Nothing
runs on its own while the switch is off.

The switch is off for new chats and for chats saved before it existed. It
appears only in Auto, is saved for this chat, and its change applies to the
next review. Turning it on saves at once. Turning it off asks first, as Deslop's
switch does: **Turn off Automatic UI pass?** says that the screens a plan
changes will no longer get a design review, and that typing “UI pass” in the
chat still runs one. **Cancel** keeps it on; **Turn off Automatic UI pass**
saves it off. The line under the switch is a reminder of the chat command:
**Or tell the agent “UI pass” any time — add “: <section>” or “: the whole
app”.** The chat-mode button's label adds **Automatic UI pass by Senior
on** while it is on. Like Deslop, it is the owner's main chat choice: a team
member sees it disabled, and it is disabled while a goal is active. Temporary
chats and AI tasks have no automatic UI pass; ask for one in main chat instead.

**Chat mode** and the switch are the same on desktop and mobile.

## Ask Colleague

Colleague can explain the UI pass and its scopes. It can also:

- start one: ask, for example, “Run a UI pass on the bookings pages in this
  session”; Colleague sends the matching `UI pass` message to main chat, which
  you then see there. A team member's message waits for the owner's approval as
  any other main chat message does.
- turn **Automatic UI pass** on or off for the owner through the chat mode
  action, and tell you whether it is on.

A question or an offer starts nothing; Colleague acts only on your direct
request or an offer you accept.

See [Choose Auto roles and follow the workflow](auto-workflow.md) for Auto's
review, and [Goals and model changes](coding-agent-goals.md) for goals.
