# View a plan and its history

Plans belong to a session's Main chat. Open the project and session whose plan
you want to inspect. Temporary chats and AI tasks do not have Auto plans.

## Create or update a plan

Ask **Senior**, directly or through **Auto**, to make a plan. This means a saved
Vibe64 plan available through the plan icon: a short user-friendly summary and
scope checklist, followed by detailed technical implementation instructions.
Plan and Progress are two tabs for one artifact: Plan defines the agreed
deliverables, acceptance criteria and implementation approach; Progress holds
actual work, evidence and blockers. You can explicitly request a
chat-only draft or another format instead.

Senior checks whether there is a current plan first. If there is, say whether to
update it or archive it and start another. If your request does not make that
choice clear, Senior asks before replacing it. An explicit instruction to archive
and replace the plan already authorizes that choice; the archive stays in History.
Senior confirms creation or updates after the plan helper has saved the result.

Both direct Senior and Junior receive the plan format and command instructions.
Both roles must read the full Plan, including its technical details, and Progress
before implementing or reviewing. Collapsing details in the viewer does not hide
them from the agent. The agent reads a long plan in pages, and Vibe64 refuses
its rewrite of the whole Plan or Progress unless it read both to the last page,
so a long Progress is never cut to the part one page returned. The agent writes
each document under the name it reads it by (the Plan as `text`, Progress as
`progressText`); a write under any other name is refused, saying the names the
command takes, so a misnamed Progress is never saved empty or reported as saved. Junior updates Progress and the marks of existing checklist
items as the work goes: a half tick once an item is built, a full tick once
Senior's review proves it (see [Checklist marks](#checklist-marks)); Senior
owns agreed Plan scope changes. Creating,
reopening, archiving and completing a plan still require Senior. In **Auto**, a
plan request is always Senior's: one that reached Junior is handed over without
Junior writing anything, the chat says **Senior is making the plan.**, and
Senior writes the plan from your request and the conversation without you
asking again (see [Auto](auto-workflow.md)). In a **Junior** chat, Junior writes
nothing and tells you that plans need **Senior** or **Auto**. An unsuccessful
save must be reported, and a chat outline alone is not a saved plan.

Every turn works on the plan with its role, also one that only answers a
question such as **Are you going to do it?**: Senior's and Junior's ticks and
Progress are saved. A pass you start on its own outside the plan, a **Custom**
chat, and a turn the chat has no running request for can only read the plan.
When such a turn tries a change, the AI hears which turn it is and tells you how
to get the change: ask for it in a new message once the pass ends, or in a
**Senior**, **Junior** or **Auto** chat.

The plan's last section, **Passes**, lists the passes that run once Senior has
reviewed it, one item each, such as **Security pass: the plan's changes**. It
starts with the passes ticked under **After a plan** in [Passes](passes.md);
ask Senior to change it, or start a pass from the Passes list to add one. Each
item names its pass by Genesis's exact title: Vibe64 refuses any other name
when the plan is written, so Senior puts it right in the same turn.

## Read the current plan

1. Select the document icon beside the usage percentage inside the chat composer.
   It is highlighted in muted yellow while the current plan is active. Its label
   is **View active plan** or **View plan and history**.
2. Select **Current plan**. The selected tab has a coloured underline.
3. Read the **Active** or **Completed** status and the plan's progress, such as
   **6 built · 2 proven of 9 requirements**: built counts every item that is
   built or proven, proven only the proven ones. An active plan also says when
   the AI last brought it up to date and how many of the session's files
   changed since, such as **Updated 47 min ago · 12 files changed since** (see
   [How current the plan is](#how-current-the-plan-is)). Select
   **Plan** for the stable summary, checklist and implementation instructions or **Progress** for work, evidence and
   blockers. Both tabs belong to the same current or archived artifact.
4. Select **Technical details** below the summary and checklist to expand the
   implementation instructions. Select it again to collapse them. These details
   start collapsed when opening a different document or plan; a Progress update
   does not collapse the same Plan you are reading. A **Passes** section after
   them stays shown.

New plans use a **Technical details** heading to identify that section. Older
plans without that heading remain fully visible; opening a plan never rewrites
or guesses how to divide its content.

The same controls appear on desktop and mobile. The dialog fits the viewport and
keeps its dimensions when you change views. Select **Close plan** to return to chat.
The icon remains available after completion and when only archived plans remain.
When there is no current plan, the icon opens **History** directly.
There is no icon when the session has neither a current plan nor history.

### Checklist marks

Each checklist item shows one of three boxes, so you can watch the plan fill in
as items get built instead of waiting for the end:

| Box | In the plan text | Meaning | When the AI sets it |
|---|---|---|---|
| Empty (**Not done yet**) | `- [ ]` | Not done yet | — |
| A dash in a filled box, the indeterminate checkbox (**Built, not yet proven**) | `- [~]` | Built: implemented, and its own focused checks pass | As soon as that item is implemented |
| Ticked (**Proven**) | `- [x]` | Proven by Senior's review | When Senior's review proves it: its reading of the changes and their focused tests, or the proof the plan states |

A screen reader reads each box's label, shown in bold above.

No item is the whole-project checks (such as one whole run of the test suite):
no step of a plan runs them, and once the plan is finished Vibe64 asks you
whether to run them (see [Run the whole-project checks after a
plan](whole-project-checks.md)).

Checklist wording stays stable while the marks update during development. The AI
never leaves a built item empty, and a partly done item stays empty. Review moves
an item back to built or to not done yet when its evidence is missing or it
regressed. Junior records supporting evidence and blockers in Progress. Senior
checks the marks against that evidence and explicitly completes the artifact only
after verifying every agreed acceptance requirement. Vibe64 refuses to complete
a plan while any item is not done yet or only built, and the refusal names each
such item and its mark, so Senior proves it or leaves the plan active with the gap in
Progress. A finished turn or a fully ticked checklist alone does not complete a
plan. Updates appear while the viewer is open.

The AI ticks each item the moment it is built and its own checks pass, not at
the end of its turn, and the last item too. It never asks you whether to run the
plan's passes, save or run the whole-project checks: the passes are the plan's
next step, which Vibe64 runs after Senior's review, Vibe64 saves the work when
the plan completes, and then asks you about the whole-project checks itself. When work on one item also builds others (a foundation
item, say, that the later items use), it walks the whole checklist and
half-ticks each item that is built, notes in Progress what is only partly built,
and never holds every tick until the first item is finished. Senior writes a
foundation that other items build on as its own item, or says so in the item, so
the marks can move as the work goes.

### The plan check after a turn

When a turn of Senior, Junior or Senior's review changed the session's files
(edited, added, deleted or committed) while a plan is active, but the plan's
marks and Progress did not change, Vibe64 sends that AI one short note in the
same chat before the turn counts as finished. The chat shows it as Vibe64's
note, not as your message, for example **4 files of the session's source
changed in this turn, but the plan's checklist marks and Progress did not.
Vibe64 asked the AI to bring the plan up to date.** The note names the changed
files and asks the AI to walk the checklist item by item, not only the item it
was on, and either update the marks and Progress or record that it checked the
plan and nothing needs a new mark. Vibe64 never decides which item a change
built: that is the AI's to judge. The AI then stops, and the work goes on as it
would have (Senior's review next, say).

A turn that ended asking you a question gets the check too: the note tells the
AI that Senior's review, the plan's passes, Save and the whole-project checks
are never a question for it to ask you, and to ask any other question again,
which then waits for your answer.

In Auto and in a Senior chat, the work goes on to Senior's review of the plan
whenever every item is built, also when the turn ended asking you something,
and after the check when the AI left the plan exactly as the check found it.
Senior verifies every item against the work and ticks it, and the plan then
moves on to its passes (a Senior chat whose items are all proven goes straight
to them). A Junior chat has no Senior turns: its built plan waits for Senior. An item whose last proof can't run in the session (a real phone,
a suite only CI runs) stays half-ticked until Senior's review asks you about it:
**Needs you**, a numbered question with a recommended answer, also written in
Progress. So a plan never waits at its last item, nor on a question about steps
Vibe64 runs. While an item is still open, a question from the AI waits for your
answer as usual.

The check runs once per turn: its own turn never gets another. Outside Auto, if
the AI ignores it, the turn ends normally and the plan shows it is behind. There
is no check for a plan's pass, an AI task, an answer to a question, a Custom
chat, a goal, a temporary chat, a turn you stopped or a turn that failed. After
the editor restarts, the turn that was running when it stopped gets no check.

### How current the plan is

An active plan says when the AI last brought it up to date (it ticked items,
wrote Progress or the plan, or checked the plan and found nothing to change)
and how many of the session's files, including its connected repositories,
changed since: **Updated 47 min ago · 12 files changed since**, or **Checked
just now · no files changed since**. These are facts, not a judgement of what
is done: the count covers files Git sees (edited, added, deleted or committed,
whoever changed them), not files Git ignores such as build output. A plan from
before this record shows only when it was last saved. A
count shown with **+**, such as **1000+ files changed since**, is at least that
many.

## A plan's steps

A plan goes through **Implementation**, **Senior review**, **Passes** and
**Completed**, and one line above the message box says where it is; see
[Follow a plan's steps](plan-steps.md).

## Automatic completion and archival

A plan is completed only when every item outside Passes is proven, every pass is
done and no question is open. A plan without passes is completed by Senior in
its review: in Auto, in the turn in which Senior reviews the plan Junior
implemented; in a Senior chat, or when Senior implemented it, in Senior's own
work on it. A plan with passes is completed by Vibe64 after its last pass. A
Junior or Custom chat leaves the plan active for Senior, and its work is saved
as usual. Vibe64 then moves that exact Plan and Progress pair into History.
Chat shows **Completed plan archived** with **View plan history**, which opens
this session's existing viewer. The plan icon remains available and opens
History when there is no current plan. With **Automatically save changes** on
(the default; see [Choose what happens once work is finished](chat-settings.md)),
Vibe64 then runs the ordinary **Save** once and notes the result in chat. When
a pass is stopped, needs you or can't run, the plan stays current and active at
that pass, and nothing is saved automatically.

Senior's review of a plan runs only when Junior implemented it in Auto and the
plan is still active afterwards; it is not a pass and runs no pass. Work done
without a plan is not reviewed, deslopped or UI-passed automatically: ask for
those from [Passes](passes.md) or by typing the request in chat, and they run in
a small plan of their own.

Senior can update checklist ticks and Progress while reviewing the plan without preventing
completion. The agreed plan wording must still match the checked scope, and
completion uses the latest saved Plan and Progress together.

A finished implementation or an agent's handoff explanation is not completion.
Interrupted checks, unfinished plans and unrelated requests do not archive a
plan. A different plan created while Senior reviews one is not archived by that review.
If automatic archival cannot be confirmed, the notice explains the problem;
inspect Current plan and History before retrying Archive. Older completed plans
are not moved retroactively just by opening or restoring a session.

Discussing a new plan leaves the current one untouched. After successful automatic
archival, there is no current plan to replace. Otherwise, explicitly choose an
update or archive-and-replace; Senior asks if that choice is unclear.

## Archive the current plan manually

1. Open **Current plan** and select **Archive** in the dialog header.
2. While the request runs, the control says **Archiving…**. On success, the viewer
   switches to **History**, where the saved plan is listed.

Archiving preserves the exact Plan and Progress pair and removes it from the current slot;
it does not mark unfinished work completed. Archive is disabled while the
assistant or its review is running. Wait for that work to finish.
If archiving fails, the plan stays visible and shared error feedback explains
the problem. If the plan changed, refresh the viewer before trying again.

## Read an archived plan and progress

1. Select **History**. Each entry shows its title, archive date, **Completed** or
   **Unfinished** status, and its progress, such as **4 built · 4 proven of 4
   requirements**. An empty list says
   **No archived plans**.
2. Select an entry. **History** stays selected, and **Archived · read-only** plus
   the archive date remain above the document while you scroll.
3. Select **Plan history** to return to the list, or **Current plan** to
   inspect the current document. **No current plan** means that slot is empty;
   it does not remove your history.

If there is no current plan, open an archive and select **Make current** in the
header. It says **Restoring…** while moving the plan back to the current slot,
then switches to **Current plan**. The plan reopens as **Active**, keeping its
Plan and Progress together, and disappears from History. This starts no AI work.
Archiving it later moves it back to History. Make current is disabled while the
assistant or its review is running; a competing current plan prevents the move.
If the move fails, shared error feedback explains the problem.

If a current plan already exists, either archive it first or explicitly ask Senior
in Main chat to reopen the desired archive, identifying its title and date.
Creating a new plan starts fresh Progress; it does not inherit the previous artifact's evidence. Reopening an archive retains that archive's exact Progress, including when it replaces another current plan.
If this replaces a current plan, Senior identifies which paired artifact will be archived
and confirms your choice unless you already authorized replacement. To implement
an active plan, explicitly request it in chat or select **Implement plan** in the
waiting Auto Planning notice. The viewer itself has no Implement button.

## Loading, errors and Colleague assistance

A loading placeholder means the selected document has not arrived yet. A load
error includes **Retry**. Do not treat a partially loaded plan as the whole record.

A plan file Vibe64 cannot use (one that belongs to another account, lost its
permissions or no longer matches its saved content) never stops the plan.
**History** then shows a warning above the list naming each such file and what
is wrong with it; the archived plan it holds is not listed, and the current plan
and every other archived plan work as usual. Cleanup keeps everything that
plan may still need. To bring it back, someone who administers the computer
gives the file back to the account Vibe64 runs as, or restores it from a backup;
it then reappears in History. When the current plan's own file is unreadable,
the plan command and the viewer refuse with that file's name and the same fix.

Colleague can explain these steps and, when its plan-reading action is available
for the session, offer to read the plan or summarize the recorded work and blockers from both documents, including
how many requirements are built and how many proven, and how current the plan
is: when the AI last brought it up to date and how many files changed since,
reported as those facts, never as a guess at what is done. It can
read an archive by its history identity without starting a coding turn. It must
finish all pages of both documents before claiming to have reviewed the complete artifact.
You can also ask **“Show me this session's plan”**, or name another accessible
project and session. Colleague opens that session's Main chat and the same
**Plan and history** dialog. It selects **Current plan** when one exists,
otherwise **History**, just like the document icon. Ask to show **History** or
**Current plan** explicitly to choose that tab. On mobile it reveals chat before
opening the dialog. Select **Close plan** to return to that session's chat.

Colleague confirms opening only after your connected browser displays the dialog.
If there is no plan or history, the session is unavailable, access is denied or
loading fails, it reports that problem. Reconnect or use the normal **Retry**
control before asking again. An unsuccessful Colleague request does not prove
the session has no plan; the native plan icon remains an independent way to
check. Opening the viewer reads the plan; it never creates,
edits, approves, archives, reopens or executes one and starts no coding turn.
Explaining the workflow or offering help is not authorization to change a plan.
Colleague's plan-reading action cannot edit or execute a plan. When you ask,
Colleague can **Archive** the current plan or **Make current** an archived one
through the same operations as the viewer's buttons, with the same limits: it
reads the whole current plan first, Archive is refused if the plan changed since
that read, Make current is refused while a current plan exists, and both wait
while the assistant or its review is running. Neither starts AI work; ask in
chat to continue a plan made current. Replacing a current plan with an archive
(reopen over it), editing and executing remain explicit Main-chat requests.

## Auto roles and workflow

For Senior/Junior routing, implementation, review, Deslop, the UI pass, scope deferral and
Stop or stage-specific Continue recovery, read [Choose Auto roles and follow the
workflow](auto-workflow.md). Plan and Progress remain one paired artifact.


Older history may have no separate Progress document. Its original inline evidence remains exact in Plan; the Progress tab explains that absence. Opening it never rewrites or splits old history. If a mutation reports that an offline upgrade is required, ask the installation operator to stop writers, back up and apply the candidate state upgrade. Do not edit private plan files or replace a history entry to bypass the error. A changed Plan or Progress revision requires a fresh paired read before retry.
