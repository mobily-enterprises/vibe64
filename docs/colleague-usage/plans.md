# View a plan and its history

Plans belong to a session's Main chat. Open the project and session whose plan
you want to inspect. Temporary chats do not have Auto plans.

## Read the current plan

1. Select the document icon beside the usage percentage inside the chat composer.
   It is highlighted in muted yellow while the current plan is active. Its label
   is **View active plan** or **View plan and history**.
2. Select **Current plan**. The selected tab has a coloured underline.
3. Read the **Active** or **Completed** status, checked-item count, checklist and
   evidence. Scroll inside the dialog for a longer document.

The same controls appear on desktop and mobile. The dialog fits the viewport and
keeps its dimensions when you change views. Select **Close plan** to return to chat.
The icon remains available after completion and when only archived plans remain.
When there is no current plan, the icon opens **History** directly.
There is no icon when the session has neither a current plan nor history.

The checkboxes record the coding models' work; they are not manually editable.
Junior updates checks and evidence during implementation. Senior reviews the
work, can uncheck unsupported claims, and explicitly marks the plan completed.
A finished turn or a fully ticked checklist alone does not complete a plan.
Updates appear while the viewer is open.

## Archive the current plan

1. Open **Current plan** and select **Archive** in the dialog header.
2. While the request runs, the control says **Archiving…**. On success, the viewer
   switches to **History**, where the saved plan is listed.

Archiving preserves the exact document and removes it from the current slot;
it does not mark unfinished work completed. Archive is disabled while the
assistant or its review is running. Wait for that work to finish.
If archiving fails, the plan stays visible and shared error feedback explains
the problem. If the plan changed, refresh the viewer before trying again.

## Read an archived plan

1. Select **History**. Each entry shows its title, archive date, **Completed** or
   **Unfinished** status, and checklist progress. An empty list says
   **No archived plans**.
2. Select an entry. **History** stays selected, and **Archived · read-only** plus
   the archive date remain above the document while you scroll.
3. Select **Back to plan history** to return to the list, or **Current plan** to
   inspect the current document. **No current plan** means that slot is empty;
   it does not remove your history.

If there is no current plan, open an archive and select **Make current** in the
header. It says **Restoring…** while moving the plan back to the current slot,
then switches to **Current plan**. The plan reopens as **Active**, keeping its
checklist and evidence, and disappears from History. This starts no AI work.
Archiving it later moves it back to History. Make current is disabled while the
assistant or its review is running; a competing current plan prevents the move.
If the move fails, shared error feedback explains the problem.

If a current plan already exists, either archive it first or explicitly ask Senior
in Main chat to reopen the desired archive, identifying its title and date.
If this replaces a current plan, Senior must tell you that the current plan will
be archived and remain accessible. To implement
an active plan, explicitly request it in chat; the viewer has no Implement button.

## Loading, errors and Colleague assistance

A loading placeholder means the selected document has not arrived yet. A load
error includes **Retry**. Do not treat a partially loaded plan as the whole record.

Colleague can explain these steps and, when its plan-reading action is available
for the session, offer to read the plan or summarize outstanding checks. It can
read an archive by its history identity without starting a coding turn. It must
finish all pages before claiming to have reviewed the complete document.
Explaining the workflow or offering help is not authorization to change a plan.
Colleague's plan-reading action cannot archive, reopen, edit or execute it:
those require the person's Archive or Make current control, or an explicit Main-chat request,
sent through an already-authorized chat operation when available.
