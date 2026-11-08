# Choose what runs after each piece of work

The **Chat mode** only chooses who works. What happens once a piece of work is
finished is chosen by four **Chat settings** switches, the same in **Auto**,
**Senior**, **Junior** and **Custom**:

| Switch | What it does | New chats |
| --- | --- | --- |
| **Automatically review changes** | Checks the finished work against your request, fixes what it finds, and checks the work's tests. | On |
| **Automatically deslop changes** | Cleans up the code without changing what it does: duplicated helpers, dead code and muddled structure. | On |
| **Automatically UI pass changes** | Brings the screens the work changed in line with the project's UI guidance; see [Run a UI pass](ui-pass.md). | On |
| **Automatically save changes** | Runs the session's ordinary **Save** once the steps above are done. | On |

A new session's chat starts in **Auto** with all four switches on. Each chat
then keeps its own choices, so changing one chat's switches never changes
another's.

## Find the switches

Open **Chat mode**, the icon inside the message box. Under the chat modes,
**Chat settings** lists the four switches in the order they run. Under
**Automatically deslop changes** a line reads **Or tell the agent “Deslop” any
time.**; under **Automatically UI pass changes** it reads **Or tell the agent
“UI pass” any time — add “: <section>” or “: the whole app”.** Either message
runs that step straight away, whatever its switch says.

Turning a switch on saves at once. Turning one off asks first, naming what is
lost:

- **Turn off automatic review?**: mistakes in finished work are no longer caught
  before you see them. Deslop and the UI pass still run while they are on.
- **Turn off Deslop?**: code quality will suffer; over time the project gets
  harder to change and may crash and burn, unless you ask for “Deslop”
  regularly yourself. Skip it only for a quick throwaway project.
- **Turn off Automatic UI pass?**: the screens the work changes no longer get a
  design review; typing “UI pass” still runs one.
- **Turn off automatic save?**: finished work stays only in this session until
  you choose **Save**. Archiving a session never saves its work.

**Cancel** keeps the switch on; the red button saves it off for this chat.
Either way **Chat mode** stays open, so you can see the result. The
chat-mode button's label names each step that is on, for example **Automatic
review on. Automatic deslop on. Automatic UI pass on. Automatic save on**. A
change applies to the next piece of work. The switches are the owner's main chat choice: a team
member sees them disabled, and they are disabled while a goal is active.
Temporary chats, AI tasks and Fix it with AI have no Chat settings and run none
of these steps. Neither do lessons: Deslop never rewrites a learner's code, and
saving is part of what a lesson teaches, so you choose **Save** yourself. **Chat mode** and the switches are the same on desktop and
mobile.

## Who does each step

- **Senior**, **Junior** or **Custom**: that one agent implements, reviews,
  deslops and runs the UI pass. In a Junior chat Junior reviews its own work.
  Only Senior completes a plan, so a Junior chat records its findings in the
  plan's Progress, a Custom chat (which cannot change the plan) reports them in
  its reply, and both leave the plan active for Senior to complete. When the
  review finds substantial rework, the same agent goes back to implementing it
  and the finishing turn runs again afterwards.
- **Auto**: Router still chooses who handles each new message; see [Choose Auto
  roles and follow the workflow](auto-workflow.md). Senior always does the
  review, Deslop and UI pass, and Junior implements, with no extra Router call.

## When they run

They run once per piece of work, never after each file, plan step or turn, in
this order: review, Deslop, the UI pass (all in one turn by the same agent),
then **Save** last.

- **With a plan**: once, after the whole plan is carried out.
- **Without a plan**: once, when the agent reports the work finished. The agent
  reports an outcome as Auto's does: **Continue**, **Wait**, **Handoff** (the
  work is finished and changed files) or **Complete** (it only answered, or
  changed nothing).

Nothing runs when:

- the agent asks you a question or reports a blocker (**Wait**): the steps run
  once you answer and the work is finished. A waiting chat holds nothing up:
  you can still start a goal, renew the session or change the plan, and your
  next message replaces the waiting request;
- you press **Stop**: nothing is reviewed, and those changes are covered by the
  next review;
- the message only asked a question or changed no files;
- the turn ends without the agent reporting an outcome: in Senior, Junior and
  Custom it is an ordinary reply, and its changes are covered by the next review.

Each review covers everything changed since the last one, so a quick follow-up
is reviewed on its own, and work that stopped or waited before review is
included in the next.

With review, Deslop and the UI pass all off, finished work goes straight to
**Save** (when it is on) and the chat notes **Work finished.**

## What the chat shows

Each step that a switch starts adds a notice to the chat as it starts, for
example **Deslop started automatically (Chat settings: Automatically deslop
changes)**. Save then adds its result: **Saved automatically.**, **Automatic
save: nothing new to save.**, or **Automatic save didn't run:** followed by
Save's own reason (for example an Update is needed, a conflict, a required pull
request or an unavailable repository). Automatic save never runs **Update** for
you and never runs while the agent is working. In a session with connected
repositories it saves their copies too, as **Save** does.

## Ask Colleague

Colleague can explain these switches and tell you which are on. For the owner
it can turn any of them on or off through the chat mode action; it turns one
off only when you ask, after saying what is lost. A question or an offer
changes nothing; Colleague acts only on your direct request or an offer you
accept.
