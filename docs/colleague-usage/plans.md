# View a plan and its history

Plans belong to a session's Main chat. Open the project and session whose plan
you want to inspect. Temporary chats do not have Auto plans.

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
them from the agent. Junior can update Progress; Senior owns agreed Plan scope changes. Creating,
reopening, archiving and completing a plan still require Senior. An unsuccessful
save must be reported, and a chat outline alone is not a saved plan.

## Read the current plan

1. Select the document icon beside the usage percentage inside the chat composer.
   It is highlighted in muted yellow while the current plan is active. Its label
   is **View active plan** or **View plan and history**.
2. Select **Current plan**. The selected tab has a coloured underline.
3. Read the **Active** or **Completed** status and number of requirements. Select
   **Plan** for the stable summary, checklist and implementation instructions or **Progress** for work, evidence and
   blockers. Both tabs belong to the same current or archived artifact.
4. Select **Technical details** below the summary and checklist to expand the
   implementation instructions. Select it again to collapse them. These details
   start collapsed when opening a different document or plan; a Progress update
   does not collapse the same Plan you are reading.

New plans use a **Technical details** heading to identify that section. Older
plans without that heading remain fully visible; opening a plan never rewrites
or guesses how to divide its content.

The same controls appear on desktop and mobile. The dialog fits the viewport and
keeps its dimensions when you change views. Select **Close plan** to return to chat.
The icon remains available after completion and when only archived plans remain.
When there is no current plan, the icon opens **History** directly.
There is no icon when the session has neither a current plan nor history.

The scope checklist remains stable during execution; it is not a live progress gauge.
Recorded marks in historical plans remain visible. Junior records implementation
and verification in Progress. Senior reads both documents, verifies every agreed
acceptance requirement against the work and evidence, and explicitly completes the artifact.
A finished turn or a fully ticked checklist alone does not complete a plan.
Updates appear while the viewer is open.

## Automatic completion and archival

After Auto's final Senior review and any enabled Deslop finish successfully,
Senior explicitly marks the involved plan Completed. Once the final explanation
has been delivered and that review turn finishes, Vibe64 automatically moves
that exact Plan and Progress pair into History. Chat shows **Completed plan
archived** with **View plan history**, which opens this session's existing viewer.
The plan icon remains available and opens History when there is no current plan.

A finished implementation or an agent's handoff explanation is not completion.
Interrupted reviews, unfinished plans and unrelated requests do not archive a
plan. A different plan created while reviewing is not archived by the old review.
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
   **Unfinished** status, and number of requirements. An empty list says
   **No archived plans**.
2. Select an entry. **History** stays selected, and **Archived · read-only** plus
   the archive date remain above the document while you scroll.
3. Select **Back to plan history** to return to the list, or **Current plan** to
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
an active plan, explicitly request it in chat; the viewer has no Implement button.

## Loading, errors and Colleague assistance

A loading placeholder means the selected document has not arrived yet. A load
error includes **Retry**. Do not treat a partially loaded plan as the whole record.

Colleague can explain these steps and, when its plan-reading action is available
for the session, offer to read the plan or summarize the recorded work and blockers from both documents. It can
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
Colleague's plan-reading action cannot archive, reopen, edit or execute it:
those require the person's Archive or Make current control, or an explicit Main-chat request,
sent through an already-authorized chat operation when available.

## Auto roles and workflow

For Senior/Junior routing, implementation, review, Deslop, scope deferral and
Stop or Resume workflow recovery, read [Choose Auto roles and follow the
workflow](auto-workflow.md). Plan and Progress remain one paired artifact.


Older history may have no separate Progress document. Its original inline evidence remains exact in Plan; the Progress tab explains that absence. Opening it never rewrites or splits old history. If a mutation reports that an offline upgrade is required, ask the installation operator to stop writers, back up and apply the candidate state upgrade. Do not edit private plan files or replace a history entry to bypass the error. A changed Plan or Progress revision requires a fresh paired read before retry.
