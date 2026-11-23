# Choose what happens once work is finished

The **Chat mode** only chooses who works. Two choices decide what happens once a
piece of work is finished, the same in **Auto**, **Senior**, **Junior** and
**Custom**:

- **Automatically save changes**, the one switch under **Chat settings**, runs
  the session's ordinary **Save** once the work is finished. While it is on, the
  agent also saves each finished and checked stage of longer work itself (see
  [The agent saves finished stages](#the-agent-saves-finished-stages)). It is on
  for new chats.
- **After a plan**, the ticks in [Passes](passes.md#choose-the-passes-each-new-plan-starts-with),
  chooses the passes each new plan's **Passes** section starts with. Once
  Senior has reviewed the plan, each runs in its own turn, before **Save**.
  **Review** and **Security pass** are always there.

Passes run only as a plan's **Passes**: never when a turn ends, never after a
request without a plan and never when you **Save**. Without a plan, a pass runs
when you ask for one, from the Passes list or by typing it, such as **Deslop**
or **UI pass**, in a small plan of its own.

Work done without a plan is not reviewed, deslopped or UI-passed automatically:
once its implementation ends it is finished, and **Save** runs when it is on.
When you want those checks, ask for them: from the Passes list (**Review**,
**Deslop**, **UI pass** and the rest, or **Several passes**), or by typing the
request in chat, such as **Deslop**, **UI pass** or **Run the Security and Data
passes**. With a plan, Auto adds Senior's review of it: when Junior has
implemented the plan and it is still active, Senior reviews it (see [When work
is finished](#when-work-is-finished)). That review is not a pass and runs none;
the plan's passes follow it.

Each chat keeps its own choices, so changing one chat's never changes
another's.

## Find the switch

Open **Chat mode**, the icon inside the message box. Under the chat modes,
**Chat settings** shows **Automatically save changes** with the line **Saves
once a request's work is finished. A plan's work is finished once its last pass
is done: each new plan's Passes start with the passes ticked in Passes (After a
plan), each run in its own turn; Review and Security pass always are.**

Turning it on saves at once. Turning it off asks first: **Turn off automatic
save?** explains that automatic save runs Save once a request's work is
finished, and for a plan once its last pass is done; that without
it, finished work stays only in this session until you choose **Save**; and
that archiving a session never saves its work. **Cancel** keeps it on; **Turn
off automatic save** saves it off for this chat. Either way **Chat mode** stays
open, so you can see the result. While it is on, the chat-mode button's label
ends with **Automatic save on**.

A change applies to the next piece of work. The switch is the owner's main chat
choice: a team member sees it disabled, and it is disabled while a goal is
active. Temporary chats, AI tasks and Fix it with AI have no Chat settings, run
no plan's passes and never save by themselves: their agent's save command
refuses. Neither do lessons: Deslop never rewrites a learner's code, and saving
is part of what a lesson teaches, so you choose **Save** yourself. **Chat mode** and the switch are the same on
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
- **With a plan**: the work is finished when the plan is completed. A plan's
  steps are **Implementation**, **Senior review**, **Passes** and
  **Completed**. In **Auto**, Junior implements every item, in the plan's
  order, and Senior then reviews the plan in a turn of its own: it runs the
  plan's final checks once, verifies every item outside Passes, fixes what it
  finds within the plan, and either ticks every item (**Done**) or asks you
  numbered questions (**Needs you**), or hands substantial rework back to
  Junior. A **Senior** chat reviews its own plan. A **Junior** or **Custom**
  chat never completes a plan: its work ends after its own turn, saved as
  usual, with the plan left active for Senior.
- **Once Senior has reviewed the plan**: each item in its **Passes** section
  runs in its own Senior turn, in the plan's order; after the last, Vibe64
  completes and archives the plan and **Save** runs last. A plan without passes
  is completed by Senior's review. See [A plan's passes](passes.md#a-plans-passes).

Nothing is saved automatically when:

- the agent asks you a question or reports a blocker (**Wait**): the work goes
  on once you answer. A waiting chat holds nothing up: you can still start a
  goal, renew the session or change the plan, and your next message replaces
  the waiting request;
- you press **Stop**, or a plan's pass is stopped, needs you or can't run;
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
stops: Senior reviews the plan next. So Junior's turn ends by saying what it
changed and what it checked. It does not ask you to try or publish the work,
and it offers no next steps. It may still say **Ready to try** while its checks
run, so you can try the change early. Every other turn ends normally. A
question the agent only answers ends without a note about saving, since nothing
changed. You see only the agent's final message, never its reasoning or the
outcome it reports to Vibe64, so its whole reply, including any question for
you, is in that message. Every turn of a piece of work also knows how that work
is saved: with **Automatically save changes** on, the agent saves each finished
and checked stage itself, and says, after its reply and never in its place, what
it saved or that the work will be saved automatically, and never asks you to
choose **Save**; with it off, it leaves **Save** to you.

## The agent saves finished stages

Automatic save runs only once a request's work is finished, so a long plan with
many stages would stay unsaved until its end, and the project's other sessions
could not build on its finished stages meanwhile. So while **Automatically save
changes** is on, Main chat's agent saves as it goes: at each finished and
checked stage of a plan, or once a piece of work is finished, never in the
middle of an edit. When the session is behind its saved version, it runs Update
first. It runs the session's own **Save**, the one the Save button runs, with the
same checks, backups and [connected repositories](connected-repositories.md),
saving the files as they are when it runs; it runs no pass, and a plan's passes
still run as before. Then it tells the other sessions it is working with
to update. [The session's AI saves its finished stages](github-work.md#the-sessions-ai-saves-its-finished-stages)
describes what it does when Save cannot save.

Only Main chat saves this way, during its own turn and only while the switch is
on. With the switch off, in a temporary chat, an AI task, Fix it with AI or a
lesson, the agent's save command refuses and says why, and saving stays your
choice. While a temporary chat or AI task is working beside Main chat, the
command also refuses, because Vibe64 can't tell which chat ran it; Main chat's
agent saves once the other chat has finished.

## What the chat shows

Save adds a notice as it starts, **Save started automatically (Chat settings:
Automatically save changes)**, then its result: **Saved automatically.**,
**Automatic save: nothing new to save.**, or **Automatic save didn't run:**
followed by Save's own reason (for example an Update is needed, a conflict, a
required pull request or an unavailable repository). Automatic save never runs
**Update** for you and never runs while the agent is working. A stage the agent
saves itself adds no automatic-save notice: the session shows **Saving work**
while it runs, as for any Save, and the agent's reply says what it saved. In a session with
connected repositories it saves their copies too, as **Save** does. The notices
a plan's passes add are described in [Passes](passes.md#what-the-chat-shows-while-a-plans-passes-run).

## Ask Colleague

Colleague can explain automatic save and a plan's passes, and tell you which
**After a plan** ticks are on. For the owner it can turn **Automatically save
changes** on or off and tick or untick **After a plan** through the chat mode action; it
turns something off only when you ask, after saying what is lost. A question or
an offer changes nothing; Colleague acts only on your direct request or an offer
you accept.
