# Choose the AI for a temporary chat

Open **Temporary AI** from the session toolbar, or from **Session actions** in
a narrow chat. Select the temporary chat you want to change. Its **Chat mode**
icon is inside the message box.

In **New temporary chat**, **Cancel** returns directly to Main when starting the
first chat. If another temporary or host conversation was selected, it stays
selected with its draft intact. Dismissing the dialog has the same effect; no
chat is created and no message is sent. This applies on desktop and narrow screens.

Ordinary temporary chats offer **Fix it with AI**, **Custom**, **Senior** and
**Junior**; a team member's offer **Fix it with AI** and **Custom**. **Fix it with
AI** uses the model AI setup chose for fixes, which may run in a different tool
from Main chat. Choose **Custom** to open the **Orchestrator**, **Model** and
**Thinking** fields. Select an available connection and model, then **Apply**. The next message uses that
choice and the existing conversation history. Main chat's selection is unchanged.

## Rename a temporary chat

New temporary chats are named **Temporary 1**, **Temporary 2** and so on. Each
number is given once, when the chat is created, and is not reused while the
session keeps that chat; closing a chat or reloading does not renumber others.

To rename a chat, select its tab, then select the pencil (**Rename …**) beside
its name. Enter a name of up to 80 characters and select **Rename**, or press
Enter. Line breaks and extra spaces become single spaces. Leave the name empty
to return to its numbered name. **Cancel** or Escape keeps the current name.
The new name is saved immediately, survives reload and appears in the session's
other open tabs. Renaming works while the assistant is working and does not send
a message or change the conversation. The pencil appears only on the selected
tab, on desktop and on a phone.

Colleague can rename a temporary chat through its temporary-conversation update
action when you ask it to.

## Send and steer

Temporary chat uses Main's round Send arrow and square Stop control. While a
message is being delivered, you can type and send another; it appears as
**Pending** until the earlier delivery settles. The diagonal arrow sends guidance
to a working assistant. **Stop** interrupts that chat without closing it.
**Reply ready · background task still running…** means the answer is already
shown but a background command Claude started is still running; any later
follow-up reply appears after the answer without replacing it.
Completed replies and progress updates are saved about a second after they
finish, even while the request is still working and nobody has the chat open,
so other viewers and a later reopen see them with their actual timing.
The same controls remain available in narrow layouts. Goals are not offered in
Temporary chat.

Guidance sent to a working Claude chat does not interrupt it: Claude reads the
guidance after its current command finishes. Output already shown remains
attached to its original request; the follow-up response belongs to the new request.
Reloading the chat preserves that relationship and the recorded AI labels.
After **Stop** confirms a Claude reply has stopped, text already shown remains
under **Show all … progress updates** on its original request. It is an
interrupted partial reply, not a completed answer, and remains after reload.
If Claude saves more of that same output while Stop is finishing, it remains one
reply; the saved native copy does not add a second bubble on reload. Text already
retained for a stopped request is not replayed as a new completed answer.
Claude's internal no-response placeholder after Stop or a model change is not
an AI reply. It does not add a new answer to the stopped request. Actual assistant
replies and provider errors remain visible, even when their wording is similar.

Assistant replies show their recorded AI and model, including streaming and
reopened history. Hover the label to see its provider. Changing Chat mode affects
the next request; it does not relabel earlier replies. An older reply without
recorded selection says **agent**, rather than claiming it used today's choice.
The existing **Retry**, **Cancel** and **Edit** controls belong to the original
message; uncertain delivery is checked before any resend.

## Hand a merge repair to another model

**Fix it with AI** for an Update conflict opens a temporary repair on the Fix it
with AI model and sends the repair instructions once. Its reply appears in that
temporary chat; Main chat's history is unchanged.
Merge repair stays in Fix it with AI mode or on a model you choose. To hand it to Codex:

1. If it is still working, press **Stop** and wait for it to stop.
2. Open its **Chat mode** icon and choose **Choose model**.
3. Select **Codex**, the desired model and thinking level, then **Apply**.
4. Send a follow-up asking it to inspect the current edits and continue the repair.

The repair instructions, messages and work already in the session remain. A
model change does not undo edits or prove the merge correct. **Check Update**
retries Vibe64's repository operation without acknowledging unresolved conflicts.
If the repair is already complete, choose **Review resolved conflicts**, inspect
the file list, then **I've resolved these conflicts — apply Update**. This also
works after a stopped or failed repair, or after edits made in Main chat. No
additional AI turn is required. The same review is available on the Update error
without opening a repair chat. See [Update conflict recovery](github-work.md#apply-an-update-after-resolving-conflicts).
Only available models can be selected; an active goal must finish before a
model change. An old request admitted to another role must be cancelled and
resent to Senior; an already running turn must first be stopped.

Colleague can explain these steps and change a temporary chat's selection through
its authorized temporary-conversation action when explicitly asked. Stopping or
sending work remains a separate requested action.

Colleague offers the same choices as the **Chat mode** menu: **Fix it with AI**,
**Custom** with a model it has seen in AI setup or the session's access (it never
invents one), and for the owner **Senior** or **Junior**. A team member's Colleague
offers only **Fix it with AI** and **Custom**, and a new chat it creates for them
starts on **Fix it with AI**; the owner's starts on Main chat's mode (Auto becomes
Senior). A merge repair chat accepts only **Fix it with AI** or **Custom**. Auto
is Main chat only. Colleague doesn't start an Update conflict's **Fix it with AI**
repair itself: choose that button on the Update error.

## Work elsewhere while a chat runs

Select **Main chat** or another temporary tab to continue elsewhere. The hidden
chat keeps receiving progress, and a new assistant reply marks it unread. Open
that chat to clear its unread indicator. Returning to the view or reloading
restores saved chats and their history; it does not send the request again.

While Save or Update is changing the session source, an existing chat's saved
messages remain readable, including older pages. You can keep typing in its
composer; plain draft text saves independently and stays there after reload.
The draft's saving/saved/error indicator follows that text save, independently
of background Update-recovery status saves. Successfully saving text does not
confirm a failed model-setting save. Failed settings remain pending, and their
error clears only after the pending state saves. A failed draft save retains your
text; do not assume it will survive reload until it is saved. If another client has
started Close, queued autosaves stop and the chat explains that cleanup must
finish; they do not recreate the closing conversation.
An unsaved new chat still needs its normal creation step. A model or mode choice
on its own can be saved for the next turn while Save or Update runs. An update
that also changes files or repair state waits for the source operation, even if
it includes a model choice. Sending a message, changing files (including pasted
or dropped files), stopping work and closing the chat also wait for the source
operation to finish. A slow chat-update notification does not hold up a separate
plain draft save once the earlier update has been stored. If one of those actions reports that another
operation is starting, wait for Save or Update to settle and try that action
again; do not resend a message whose delivery is uncertain.

A temporary chat opened in one browser tab or window appears in the session's
other open tabs once it is saved, which happens when it is created or its first
message is sent. A tab that lost its connection catches up when it reconnects.
Every open tab shows the same progress: when the reply arrives, “AI is working…”
clears in each tab, including tabs that did not send the message.

Leaving the view does not stop work or close a chat. Use **Stop** to interrupt
work while retaining the conversation, or **Close** to remove that chat after
cleanup succeeds. Colleague can explain the current state and perform supported
chat actions when you request them.

## Recover a lost delivery confirmation

If the assistant finishes just as you send a steer, a confirmed pre-delivery
completion rejection lets that same queued message continue once as a new request.
Stop, cancellation and uncertain delivery never trigger that automatic retry.
An earlier answer remains attached to its original message even when a later
message is rejected; the rejected message and its recovery controls remain visible.

If a send fails before admission, **Retry** sends the original message with its
original settings and files. Anything you typed or attached afterward stays in
the composer. Accepted files leave the composer; later attachments remain.

If a message shows **Retry**, use that control with the original message.
It checks whether that exact message reached the selected chat; it does not send
the work again. A visible message can still be awaiting confirmation. If the
connection cannot read the native receipt, keep the chat and retry the check
after reconnecting. **Stop** remains available for ongoing work. **Close** removes
the temporary chat only after its native work and attachments are safely cleaned
up; a failed Close can be retried. If you used more than one AI in this chat,
Close cleans up each retained native conversation. A retry continues the unfinished
cleanup without repeating histories already removed. Removing the view alone
preserves the chat.

Colleague can explain recovery and perform supported chat actions when asked.
Choosing a model, stopping work and closing a chat remain separate requests.

During Update repair, **Checking Update…** means the repository operation has
not yet been confirmed. After a disconnect or reload, an uncertain result is
shown as unconfirmed, not as success or failure. Check the saved Update status
before trying again. Only its confirmed result clears the checking state; a
failed conflict check keeps its review and retry controls.

Background focused tasks keep their selected Helper model and workload limits;
they do not add their exchanges to Main. A profile audit identifies the selected
request, not independent proof of provider enforcement or successful completion.
Wait for the task result before reporting success. No new user control or permission
is introduced by restoring the server's original detached execution entry points.


Typing indicators coalesce actual input into one small update at most every five
seconds, without sending your draft. They expire within ten seconds of the last
update. Blur, Send, switching chats and reconnecting send no additional typing
request. Prompt suggestions wait for a five-second typing pause and at least
thirty seconds between generations; refocusing does not generate new hints.

Messages and replies appear together in time order, including follow-ups sent
while the assistant is working. This works the same way in Main and Temporary
chat, on desktop and phone. Reopening or reloading shows the same history without
resending messages. Colleague can explain the order; no repair action is needed.
