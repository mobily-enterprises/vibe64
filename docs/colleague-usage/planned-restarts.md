# A planned restart of the workspace (heads-up, pause, resume)

A host that runs Vibe64 for you can restart its machine for an update. It
gives five minutes' notice first. During those minutes Vibe64 pauses the
work that must not be cut in half, tells every AI that is working, and after
the restart picks up where it left off. On your own computer nothing gives
such notice, so none of this appears.

## Before the restart: the amber banner

Every open page of the editor shows an amber banner across the top:

> This workspace restarts at 07:40 (in 4 minutes): Platform update. Save,
> Update, Preview starts and deploys are paused until then; everything running
> then stops, and the AI picks up where it left off afterwards.

The time is in your own time zone, and the countdown moves every second. The
reason is whatever the host gave.

## What is paused, and what still works

Until the restart these are paused, because a restart in their middle could
leave something half done:

- **Save** and **Update this session**: the session header's Save button is
  disabled, and its tooltip and the Save window say "Paused until 07:40: this
  workspace restarts then";
- starting **Preview** or **Run** when its output has Prepare steps: the
  Preview status says "Paused until 07:40: this workspace restarts then". One
  without Prepare steps, or one already running, starts as usual;
- **Workspace preparation**;
- adding, archiving or removing a project;
- creating or archiving a session;
- saving **Env** values;
- the steps Vibe64 starts by itself after an AI turn (handing a plan to
  Senior, Senior's review, a plan's pass): they wait and start by themselves
  after the restart;
- the AI's own Git commit, push and rebase;
- a host's own lasting operations, such as **Publish to staging** and
  **Deploy to production**.

Anything paused that you try anyway is refused with the time, for example:
"Save is paused: this workspace restarts at 07:40 UTC. Try again after the
restart." (Messages from the server name the time in UTC.)

Reading, browsing files, the chats, an already running Preview, and running
commands all keep working. Nothing already running is stopped early: a Save
that started before the notice finishes if it can.

## What the AI is told

Every chat whose AI turn is running (Main chat and every temporary chat, in
every open session) gets a note from Vibe64, shown as Vibe64's, never as yours:
the restart time, that everything stops then, not to start new subagents,
tests, builds, installs or migrations, to let short commands finish and stop
long ones at a safe point, and to write where it is and what's next before
the minute before the restart. A chat with no running turn is left alone; a
turn that starts during the five minutes gets the same note first. Short
helper runs (prompt ideas, session names, Save subjects) are not told and are
simply ended by the restart.

## After the restart: the green message

Once the workspace is back, every page shows a green message, once:

> Restarted for an update at 07:40. Nothing was lost. The AI that was working
> picked up where it left off. Stopped then: the command npm test (Checkout
> form).

The AI in each session that was working resumes by itself, told what was
stopped ("Restarted at 07:40. This was stopped: your turn; the command
`npm test`. Continue from your notes."). Commands that were stopped are not
rerun for you; the AI reruns what it needs. **Dismiss** hides the message.
**Reload** appears only when the editor itself changed in the update; reload
then to use the new version. The red crash banner is for real crashes only: a
planned restart stops the editor cleanly and doesn't show it (see the Crashes
guide).

## When the restart doesn't happen

If the host cancels the restart, or its time passes and the workspace kept
running, the banner goes, everything paused opens again, the steps that were
waiting start, and each AI that was told hears "the planned restart didn't
happen; carry on."

## What Colleague can do

Colleague can explain the banner, what is paused and until when, and what was
stopped and resumed afterwards. It cannot move, cancel or skip a planned
restart, and it cannot run a paused operation during the five minutes: the
same refusal applies to it.
