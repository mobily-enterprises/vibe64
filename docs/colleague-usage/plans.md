# View a plan and its history

Plans belong to a session's Main chat. Open the project and session whose plan
you want to inspect. Temporary chats do not have Auto plans.

## Create or update a plan

Ask **Senior**, directly or through **Auto**, to make a plan. This means a saved
short Vibe64 scope checklist available through the plan icon. Plan and Progress are two tabs for one artifact: Plan defines the agreed deliverables and acceptance criteria; Progress holds actual work, evidence and blockers. You can explicitly request a
chat-only draft or another format instead.

Senior checks whether there is a current plan first. If there is, say whether to
update it or archive it and start another. If your request does not make that
choice clear, Senior asks before replacing it. An explicit instruction to archive
and replace the plan already authorizes that choice; the archive stays in History.
Senior confirms creation or updates after the plan helper has saved the result.

Both direct Senior and Junior receive the plan format and command instructions.
Both roles must read Plan and Progress before implementing or reviewing. Junior can update Progress; Senior owns agreed Plan scope changes. Creating,
reopening, archiving and completing a plan still require Senior. An unsuccessful
save must be reported, and a chat outline alone is not a saved plan.

## Read the current plan

1. Select the document icon beside the usage percentage inside the chat composer.
   It is highlighted in muted yellow while the current plan is active. Its label
   is **View active plan** or **View plan and history**.
2. Select **Current plan**. The selected tab has a coloured underline.
3. Read the **Active** or **Completed** status and number of requirements. Select
   **Plan** for the stable scope checklist or **Progress** for work, evidence and
   blockers. Both tabs belong to the same current or archived artifact.

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

## Archive the current plan

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

After an Auto implementation turn, Router checks the original request, accepted
steering, the full current Plan and Progress, the latest five visible messages and the execution
outcome. The status says **Router is deciding whether to continue, review or wait…**.
It chooses one outcome:

- **Continue implementation** when authorised work remains and needs no user
  decision. This keeps the selected coding role, usually Junior, and starts from
  completed work. A decision affecting one part can leave independent work eligible.
- **Senior review** when implementation is ready. Review checks the evidence;
  Router's decision and checkbox counts do not prove that a plan is completed.
- **Wait** for your pause, a necessary answer, missing access or resources, unclear
  intent, or stalled work. The notice says **Implementation incomplete**, **Waiting
  for your answer**, or **Paused at your request**, with the reason. A later explicit
  instruction to proceed can supersede a pause; asking for an update cannot.

The notice shows Router's explanation and, when continuing, the next step. These
are AI judgments about recorded evidence, not independent verification. Auto stops
after two consecutive turns without reported progress, or eight automatic
implementation continuations. Review the remaining work and send a new request
if you want it to proceed. These bounds apply per new request.

The composer's **Stop** cancels pending work and interrupts Router. Failed or
interrupted execution does not automatically continue. After a restart, recovered
completion needs an explicit **Retry review**. An already prepared implementation
handoff offers **Continue implementation**; uncertain delivery offers **Check
delivery**, which checks its existing receipt without sending again. If the plan
or conversation changed, stop the handoff and send a fresh request. Direct
Senior, Junior and Custom modes do not automatically continue.

When **Review pending** appears before implementation is finished, choose **Stop**
beside **Retry review** in the notice. This cancels the pending handoff, preserves
the conversation, source changes and unfinished plan, and frees the composer.
Then send “Continue implementation of the remaining plan items” or choose Junior
for a direct implementation request. The same **Stop** control is available for
pending planning and implementation handoffs. If delivery is uncertain, use
**Check delivery** first; cancelling a handoff does not prove an attempted message
was never delivered. Colleague can explain this recovery and offer to stop the
pending work or send your explicit continuation through its existing actions.

When ready, Auto starts one separate Senior review, even when Senior implemented
it or both roles use the same model. The **Deslop** switch adds behavior-preserving
cleanup to that review. A failed Router decision leaves **Retry review** for an
explicit review request, or use **Stop** to cancel it. The same controls and
notices appear on desktop and mobile. Colleague's conversation watches treat
unfinished waiting outcomes as needing attention. Colleague can explain the outcome and offer
to send a requested continuation through the existing chat operation; an
explanation or offer alone does not authorise another turn.

Ordinary answers, planning,
requested reviews and cleanup do not start a repeating review cycle. Direct
Senior, Junior and Custom modes retain their direct behavior without automatic
review.

Executing the current plan requires it to be Active. A missing or Completed plan
is explained without reviving an old task. Independent work does not need a plan.
Junior can update Progress; only Senior can manage its lifecycle and
explicitly mark it Completed after verifying the evidence.

If an automatic handoff failed before its message was sent, you can type a new
request and use the ordinary **Send** button (or speak a new request). Sending
replaces that failed, unsent handoff; it does not mark its review completed.
The previous coding history, plan and file changes remain. **Retry review** still
retries the original handoff, and **Stop** cancels it without sending new work.
A handoff with unconfirmed delivery still requires **Check delivery** first.
Colleague can explain these choices and offer to help you continue; sending new
work requires your direct request or accepted offer.


Older history may have no separate Progress document. Its original inline evidence remains exact in Plan; the Progress tab explains that absence. Opening it never rewrites or splits old history. If a mutation reports that an offline upgrade is required, ask the installation operator to stop writers, back up and apply the candidate state upgrade. Do not edit private plan files or replace a history entry to bypass the error. A changed Plan or Progress revision requires a fresh paired read before retry.
