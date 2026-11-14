# Choose what happens once work is finished

The **Chat mode** only chooses who works. Two choices decide what happens once a
piece of work is finished, the same in **Auto**, **Senior**, **Junior** and
**Custom**:

- **Automatically save changes**, the one switch under **Chat settings**, runs
  the session's ordinary **Save** once the work is finished. It is on for new
  chats.
- **After a plan**, the ticks in [Passes](passes.md#choose-the-passes-that-run-after-a-plan),
  chooses the passes that run when a plan is completed, each in its own turn,
  before **Save**. **Review** and **Security pass** always run.

Passes run on their own only when a plan is completed: never when a turn ends,
never after a request without a plan and never when you **Save**. Without a
plan, a pass runs only when you ask for one: from the Passes list, with the
Master pass, or by typing it, such as **Deslop** or **UI pass**.

Work done without a plan is no longer reviewed, deslopped or UI-passed
automatically: once its implementation ends it is finished, and **Save** runs
when it is on. When you want those checks, ask for them: from the Passes list
(**Review**, **Deslop**, **UI pass** and the rest), through the Master pass, or
by typing the request in chat, such as **Deslop**, **UI pass** or "Review my
changes". With a plan, Auto adds one turn of its own and only one: when Junior
has implemented the plan and it is still active, Senior checks and completes it
(see [When work is finished](#when-work-is-finished)). That check is not a pass,
has no setting and runs no pass.

Each chat keeps its own choices, so changing one chat's never changes
another's.

## Find the switch

Open **Chat mode**, the icon inside the message box. Under the chat modes,
**Chat settings** shows **Automatically save changes** with the line **Saves
once a request's work is finished. When a plan is completed, the passes ticked
in Passes (After a plan) run first, each in its own turn; Review and Security
pass always do.**

Turning it on saves at once. Turning it off asks first: **Turn off automatic
save?** explains that automatic save runs Save once a request's work is
finished, and after the passes that run when a plan is completed; that without
it, finished work stays only in this session until you choose **Save**; and
that archiving a session never saves its work. **Cancel** keeps it on; **Turn
off automatic save** saves it off for this chat. Either way **Chat mode** stays
open, so you can see the result. While it is on, the chat-mode button's label
ends with **Automatic save on**.

A change applies to the next piece of work. The switch is the owner's main chat
choice: a team member sees it disabled, and it is disabled while a goal is
active. Temporary chats, AI tasks and Fix it with AI have no Chat settings, run
no pass after a plan and never save by themselves. Neither do lessons: Deslop
never rewrites a learner's code, and saving is part of what a lesson teaches, so
you choose **Save** yourself. **Chat mode** and the switch are the same on
desktop and mobile.

## When work is finished

- **Without a plan**: the work is finished when the agent reports it finished,
  and nothing runs after it: no review, Deslop or UI pass. **Save** runs (when
  it is on) and the chat notes **Work finished.** The agent reports an outcome
  as Auto's does: **Continue**, **Wait**, **Handoff** (the work is finished and
  changed files) or **Complete** (it changed only a plan, not files). When your
  message only gets an answer, or work that changes no files or plan, and no
  decision waits on you, the agent reports nothing and simply replies: Vibe64
  records that reply as finished, saves nothing, and no Status message appears
  under **Workflow details**. Only a message's first turn ends this way; the
  turns after **Continue** always report.
- **With a plan**: the work is finished when the plan is completed, and only
  **Senior** completes a plan. In **Auto**, Junior implements it and Senior then
  checks it in a turn of its own: it reads the whole plan and its Progress,
  verifies each requirement, fixes small gaps and completes the plan, or leaves
  it active with the gaps recorded, or hands substantial rework back to Junior.
  That check is not a pass and runs none. A **Senior** chat completes the plan
  itself once it has verified it. A **Junior** or **Custom** chat never completes
  a plan: its work ends after its own turn, saved as usual, with the plan left
  active for Senior.
- **When a plan is completed**: the passes ticked under **After a plan** run one
  after another, each in its own Senior turn over the plan's changes; then the
  completed plan is archived and **Save** runs last. See [Passes after a
  plan](passes.md#choose-the-passes-that-run-after-a-plan).

Nothing is saved automatically when:

- the agent asks you a question or reports a blocker (**Wait**): the work goes
  on once you answer. A waiting chat holds nothing up: you can still start a
  goal, renew the session or change the plan, and your next message replaces
  the waiting request;
- you press **Stop**, or a pass after a plan is stopped or fails;
- the message only asked a question or changed no files;
- the turn ends without the agent reporting an outcome: in Senior, Junior and
  Custom it is an ordinary reply.

A message you steer into a working turn, such as a status question, changes
none of this: the agent answers it and carries on, and when that turn finishes
the work, what comes next runs as it would have without your message. The same
holds when the agent messages another session during the turn and the chat
shows that sent message before the agent's final reply.

## How each turn ends

When Auto's Junior implements a plan, the work is not finished when Junior
stops: Senior checks the plan next. So Junior's turn ends by saying what it
changed and what it checked. It does not ask you to try or publish the work,
and it offers no next steps. It may still say **Ready to try** while its checks
run, so you can try the change early. Every other turn ends normally. A
question the agent only answers ends without a note about saving, since nothing
changed. You see only the agent's final message, never its reasoning or the
outcome it reports to Vibe64, so its whole reply, including any question for
you, is in that message. Every turn of a piece of work also knows how that work
is saved: with **Automatically save changes** on, the agent says, after its
reply and never in its place, that the work will be saved automatically, and
never asks you to choose **Save**; with it off, it leaves **Save** to you.

## What the chat shows

Save adds a notice as it starts, **Save started automatically (Chat settings:
Automatically save changes)**, then its result: **Saved automatically.**,
**Automatic save: nothing new to save.**, or **Automatic save didn't run:**
followed by Save's own reason (for example an Update is needed, a conflict, a
required pull request or an unavailable repository). Automatic save never runs
**Update** for you and never runs while the agent is working. In a session with
connected repositories it saves their copies too, as **Save** does. The notices
the passes after a plan add are described in [Passes](passes.md#what-the-chat-shows-after-a-plan).

## Ask Colleague

Colleague can explain automatic save and the passes after a plan, and tell you
which are on. For the owner it can turn **Automatically save changes** on or off
and tick or untick the passes after a plan through the chat mode action; it
turns something off only when you ask, after saying what is lost. A question or
an offer changes nothing; Colleague acts only on your direct request or an offer
you accept.
