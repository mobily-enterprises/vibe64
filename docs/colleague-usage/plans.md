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
them from the agent. Junior updates Progress and the marks of existing checklist
items as the work goes: a half tick once an item is built, a full tick once the
plan's final checks prove it (see [Checklist marks](#checklist-marks)); Senior
owns agreed Plan scope changes. Creating,
reopening, archiving and completing a plan still require Senior. In **Auto**, a
plan request is always Senior's: one that reached Junior is handed over without
Junior writing anything, the chat says **Senior is making the plan.**, and
Senior writes the plan from your request and the conversation without you
asking again (see [Auto](auto-workflow.md)). In a **Junior** chat, Junior writes
nothing and tells you that plans need **Senior** or **Auto**. An unsuccessful
save must be reported, and a chat outline alone is not a saved plan.

The plan's last section, **Passes**, lists the passes that run once Senior has
reviewed it, one item each, such as **Security pass: the plan's changes**. It
starts with the passes ticked under **After a plan** in [Passes](passes.md);
ask Senior to change it, or start a pass from the Passes list to add one.

## Read the current plan

1. Select the document icon beside the usage percentage inside the chat composer.
   It is highlighted in muted yellow while the current plan is active. Its label
   is **View active plan** or **View plan and history**.
2. Select **Current plan**. The selected tab has a coloured underline.
3. Read the **Active** or **Completed** status and the plan's progress, such as
   **6 built · 2 proven of 9 requirements**: built counts every item that is
   built or proven, proven only the proven ones. Select
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
as items get built instead of waiting for the final checks:

| Box | In the plan text | Meaning | When the AI sets it |
|---|---|---|---|
| Empty (**Not done yet**) | `- [ ]` | Not done yet | — |
| A dash in a filled box, the indeterminate checkbox (**Built, not yet proven**) | `- [~]` | Built: implemented, and its own focused checks pass | As soon as that item is implemented |
| Ticked (**Proven**) | `- [x]` | Proven by the plan's final checks | When the whole run, the review or the proof the plan states covers it |

A screen reader reads each box's label, shown in bold above.

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

## A plan's steps

A plan goes through four steps: **Implementation**, **Senior review**,
**Passes** and **Completed**. Once you approve it (**Implement plan**, or by
asking in chat), it runs to the end on its own; only a question for you or
**Stop** pauses it.

- **Implementation**: the plan stays here until every item outside Passes is
  built (`- [~]`). Junior works the items in the plan's order; it does one
  earlier only when the plan says another depends on it, and records why in
  Progress. It never starts the plan's final checks (the whole-project checks,
  such as one whole run of the test suite): those belong to Senior's review.
  Vibe64 refuses Junior's report that it has finished while an item is still
  not done, naming the item. When the plan changes during Implementation,
  because Junior hands an item to Senior to correct, you ask for a change, or
  Senior corrects one, the chat says **Senior is changing the plan.
  Implementation continues once the change is saved.**, shows **Senior changes
  the plan.**, and once Senior has saved the change Vibe64 continues the
  implementation in a new turn without you asking. After **Stop**, a change you
  ask for waits for **Continue** like any other paused work.
- **Senior review**: Senior runs the plan's final checks once, reads and records
  their result in Progress, verifies every item outside Passes against the code
  as it is now, fixes what it finds within the plan, each fix proven by a test
  that failed first, and full-ticks each item the proof covers. It ends **Done**
  or **Needs you** (numbered questions with a recommended answer each), or hands
  substantial rework back to Junior.
- **Passes**: each item in the plan's Passes section runs in its own Senior
  turn, in order; see [A plan's passes](passes.md#a-plans-passes).
- **Completed**: once every item and every pass is ticked and no question is
  open, Vibe64 completes the plan and archives it.

**Continue** resumes a paused plan from the plan as it now is, including after
items changed while it was paused.

### The plan's status line

While a plan is open, one line above the message box says where it is, read
from the plan itself each time it changes:

| The line says | When |
|---|---|
| **Plan: implementing item 2 of 6, Replies join their thread** | Item 2 is the first one not built yet |
| **Plan: Senior review** | Every item is built, not every one proven yet |
| **Plan: pass Security (3 of 6)** | The plan is at its third pass of six |
| **Plan: needs you (2 questions)** | The chat waits for your answers |
| **Plan: paused, Continue to resume** | Stopped, or waiting for **Continue** |
| **Plan: ready, Implement plan to start** | Senior made the plan; it waits for your go-ahead |
| **Plan: completed** | The plan is completed and not yet archived |

The line updates as items are ticked. A plan with no checklist items shows no
line.

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

Colleague can explain these steps and, when its plan-reading action is available
for the session, offer to read the plan or summarize the recorded work and blockers from both documents, including
how many requirements are built and how many proven. It can
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
