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

## Choose who handles a request

In **Auto**, name **Senior** or **Junior** in your message to choose either role
for that request. For example, “Junior developer: say hello” needs no plan, and
“Senior, implement the current plan” uses Senior for implementation.

Without an explicit role, Senior handles discussing, writing and improving plans,
review and Deslop. Junior implements an existing plan: say “Execute the plan” or
ask it to continue implementation. Answering the plan's open questions so coding
can proceed also defaults to Junior; recording accepted choices or implementation
progress does not change that default. An explicit Senior or Junior request
always takes precedence. Junior also handles other questions and work, including
implementation without a plan. The router uses your new request, the last three
visible messages and a short current-plan summary to understand follow-ups.

Auto uses three workflow states: **Working**, **Waiting** and **Complete**.
The current stage is separate: **Planning**, **Implementation** or **Review**.
Router chooses a role and one of conversation, planning, implementation or review
only for a new Auto request. It does not decide what happens after each turn.

The working agent reports one of four outcomes:

- **Continue** keeps its stage and role while authorised work or checks remain.
- **Handoff** moves finished implementation to Senior review. If Senior discovers
  substantial necessary rework, Senior updates the technical plan and Progress
  within the agreed outcome and hands that work back to Junior. Junior finishes
  it, then Senior reviews again and performs any enabled Deslop.
- **Wait** retains the stage for a real blocker, your required decision or an
  explicit pause. A status question or clarification is incorporated into the
  ongoing work; it does not abandon review.
- **Complete** is available only to Senior after verified review. Senior explicitly
  completes an involved plan before Auto archives it after the final explanation.

The agent's concrete explanation appears as an ordinary **Status** message in
chat. It is evidence of the reported work, not independent verification.
Auto waits after two consecutive turns without reported progress or eight
automatic steps. Inspect the reason and select **Resume workflow** to continue
with a fresh allowance. This does not grant permission to change the product scope.

If implementation is blocked on a requirement you want to defer, say so explicitly
in **Auto**: for example, “Exclude actual email delivery from this implementation.
Keep email setup and real delivery testing as future work before release, and
finish the remaining plan.” Without an explicitly requested role, Router sends
this scope change to **Senior**, who can edit the saved Plan. Junior can update
Progress but cannot remove agreed requirements.

Senior records the deferred requirement and its agreed timing under **Deferred
work** in Progress before removing it from the current acceptance scope, keeping
the completed implementation evidence. When every remaining item is checked and
supported by evidence, Senior hands the revised implementation to separate Senior review
and any enabled **Deslop**. Missing resources for the explicitly deferred work
do not block that review. Remaining implementation continues; a pause or missing
evidence can still stop the handoff. Ordinary draft-plan edits do not trigger
review just because all their items are checked.

Deferral does not complete the excluded work or schedule it automatically. Its
record stays with Progress, including after the reviewed plan moves to History.
Use the document icon beside the usage percentage to open **Progress** in
Current plan or History. Explicitly request the deferred work when ready. The same conversational steps apply on desktop and mobile. Colleague can
explain this process and offer to send your explicit scope-change request through
the existing chat action; an explanation or offer alone does not authorise it.

The composer's **Stop** pauses the current workflow and interrupts active work
or request preparation. Auto retains the stage, plan and completed changes.
A late successful result cannot undo Stop. Select **Resume workflow** when ready;
this starts a fresh turn at the retained stage. A failed or interrupted turn, or
one ending without a confirmed outcome, leaves **Waiting** with a concrete reason.

After a server restart, unfinished scheduling requires explicit **Resume workflow**;
opening a session never sends another turn. **Check delivery** checks the original
receipt of an uncertain message without sending a second copy. If the plan or
conversation changed before an unsent handoff, stop it and send a fresh request.
An unsent handoff shows **Stop** beside **Resume workflow**. Stopping it preserves
history and file changes, and lets you send a new request. A delivery check remains
necessary for an uncertain attempt; stopping does not prove it was never delivered.

Recovery errors and controls stay above the composer; workflow explanations stay
in the scrollable chat. Desktop and mobile use the same controls. Colleague can
explain the retained stage and blocker and offer to stop work or send your requested
continuation through its existing actions. An explanation or offer alone does not
authorise another turn. Colleague's watches treat Waiting as needing attention.

Auto always uses a separate Senior review after implementation, even when Senior
implemented it or both roles use the same model. The **Deslop** switch adds
behavior-preserving cleanup to Senior review; turning it off does not disable
review. Unfinished checks continue in Senior review; substantial necessary rework
returns to Junior and comes back for another review. A changed product requirement
needs your decision. Planning-only work waits for your request to implement it.
Direct Senior, Junior and Custom keep their direct behavior without automatic
continuation or review. Junior cannot mark a plan completed.

Executing the current plan requires it to be Active. A missing or Completed plan
is explained without reviving an old task. Independent work does not need a plan.
Junior can update Progress; only Senior can manage its lifecycle and
explicitly mark it Completed after verifying the evidence.

If an automatic handoff failed before its message was sent, you can type a new
request and use the ordinary **Send** button (or speak a new request). Sending
replaces that failed, unsent handoff; it does not mark its review completed.
The previous coding history, plan and file changes remain. **Resume workflow** still
resumes the retained stage, and **Stop** cancels it without sending new work.
A handoff with unconfirmed delivery still requires **Check delivery** first.
Colleague can explain these choices and offer to help you continue; sending new
work requires your direct request or accepted offer.


Older history may have no separate Progress document. Its original inline evidence remains exact in Plan; the Progress tab explains that absence. Opening it never rewrites or splits old history. If a mutation reports that an offline upgrade is required, ask the installation operator to stop writers, back up and apply the candidate state upgrade. Do not edit private plan files or replace a history entry to bypass the error. A changed Plan or Progress revision requires a fresh paired read before retry.
