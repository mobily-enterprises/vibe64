# Work in a temporary chat

A temporary chat is your own short-lived conversation beside Main chat, in the
same session and on the same source. Use it for a focused question or an
investigation you don't want in Main chat's history. Each one is a tab in the
**Temporary AI** workspace, and you can keep several open at once.

Temporary chats are only yours. Tasks that Vibe64 starts (**Fix it with AI** on
Update, Save, workspace preparation, a preview sign-in or project
setup, starting or inspecting a project from its setup screen, and the Database's
Data overview) and the tasks and reviews Colleague runs for you open in the
[AI task window](ai-tasks.md) instead. They never appear as temporary chat tabs,
also after a reload.

## Open a temporary chat

Open **Temporary AI** (the mask icon, **Open temporary AI**) from the session
header, or from **Session actions** (three dots) when the header is too narrow
for it. If the session already has temporary chats, it shows them and creates
nothing; it starts a new chat only when there are none. Just after a session
opens, it waits for the saved chats to load before deciding. If they cannot be
loaded, it shows the error and **Try again** instead of starting one. To add
another chat, select **New temporary AI task** (the plus beside the tabs).

When Main chat has messages, a new chat first asks in **New temporary chat**
whether to **Include recent chat context**; see
[Start a temporary chat with recent context](temporary-chat-context.md). Choose
**Create chat**. When Main has no messages, the chat opens directly.

In **New temporary chat**, **Cancel** returns directly to Main when starting the
first chat. If another temporary chat was selected, it stays selected with its
draft intact. Dismissing the dialog has the same effect; no chat is created and
no message is sent. This applies on desktop and narrow screens.

The tabs start with **Main chat**, then one tab per temporary chat. **Main chat**
stays in place while the other tabs scroll. Select a tab to switch to it. The
open chat's tab is filled and starts with a check mark; the other tabs, including
**Main chat**, are outlined.

## Choose the AI for a temporary chat

Select the temporary chat you want to change. Its **Chat mode** icon is inside
the message box. Temporary chats offer **Fix it with AI**, **Custom**, **Senior**
and **Junior**; a team member's offer **Fix it with AI** and **Custom**. **Fix it
with AI** uses the model AI setup chose for fixes, which may run in a different
tool from Main chat. Choose **Custom** to open the **Orchestrator**, **Model** and
**Thinking** fields. Select an available connection and model, then **Apply**. The
next message uses that choice and the existing conversation history. Main chat's
selection is unchanged. Auto is Main chat only.

A new chat starts on Main chat's mode (Auto becomes Senior); a team member's starts
on **Fix it with AI**. After that, each chat keeps its own choice: changing Main
chat later doesn't change it. Only available models can be selected; an active
goal must finish before a model change, and an already running turn must first be
stopped.

## Rename a temporary chat

New temporary chats are named **Temporary 1**, **Temporary 2** and so on. Each
number is given once, when the chat is created, and is not reused while the
session keeps that chat; closing a chat or reloading does not renumber others.

To rename a chat, select its tab, then select the pencil (**Rename …**) beside
its name. In **Rename chat**, enter a name of up to 80 characters in **Chat name**
and select **Rename**, or press Enter. Line breaks and extra spaces become single
spaces. Leave the name empty to return to its numbered name. **Cancel** or Escape
keeps the current name. The new name is saved immediately, survives reload and
appears in the session's other open tabs. Renaming works while the assistant is
working and does not send a message or change the conversation. The pencil
appears only on the selected tab, on desktop and on a phone.

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
You can attach files, a Preview screenshot, or Preview's console and network
diagnostics; they belong to that chat. The same controls remain available in
narrow layouts. Goals are not offered in Temporary chat.

Guidance sent to a working Claude chat does not interrupt it: Claude moves its
current command to the background, where it keeps running, and reads the
guidance within moments. If that work changes the project's Genesis files, the
changed project guidance applies from the chat's next idle turn. Output already
shown remains attached to its original request; the follow-up response belongs
to the new request. Reloading the chat preserves that relationship and the
recorded AI labels.
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

## Work elsewhere while a chat runs

Select **Main chat** or another temporary tab to continue elsewhere. The hidden
chat keeps receiving progress, and a new assistant reply marks it unread: a dot
on its tab, and on the **Temporary AI** icon (or on **Session actions** when the
header is narrow). Open that chat to clear its unread indicator; opening the
**Session actions** menu alone does not. Returning to the view or reloading
restores saved chats and their history; it does not send the request again, and
showing a finished chat's history does not start its AI. After a reload Main chat
shows first; your temporary chats are waiting under **Temporary AI**.

While Save or Update is changing the session source, an existing chat's saved
messages remain readable, including older pages. You can keep typing in its
composer; plain draft text saves independently and stays there after reload.
The draft's saving/saved/error indicator follows that text save. Successfully
saving text does not confirm a failed model-setting save. Failed settings remain
pending, and their error clears only after the pending state saves. A failed draft
save retains your text and shows **Draft not saved; check the error and retry.**;
do not assume it will survive reload until it is saved. If another client has
started Close, queued autosaves stop and the chat explains that cleanup must
finish; they do not recreate the closing conversation.
An unsaved new chat still needs its normal creation step. A model or mode choice
on its own can be saved for the next turn while Save or Update runs. An update
that also changes files waits for the source operation, even if it includes a
model choice. Sending a message, changing files (including pasted or dropped
files), stopping work and closing the chat also wait for the source operation to
finish. A slow chat-update notification does not hold up a separate plain draft
save once the earlier update has been stored. If one of those actions reports
that another operation is starting, wait for Save or Update to settle and try that
action again; do not resend a message whose delivery is uncertain.

A temporary chat opened in one browser tab or window appears in the session's
other open tabs once it is saved, which happens when it is created or its first
message is sent. A tab that lost its connection catches up when it reconnects.
Every open tab shows the same progress: when the reply arrives, “AI is working…”
clears in each tab, including tabs that did not send the message.

Leaving the view does not stop work or close a chat, and it still saves the
draft and settings you just changed. Use **Stop** to interrupt
work while retaining the conversation, or **Close** (the X on the chat's tab) to
remove that chat after cleanup succeeds. Archiving the session closes its open
temporary chats in the browser; their saved history stays with the archived
session.

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
It checks whether that exact message reached the selected chat. If it did,
nothing is sent again. If the AI proves it never received the message, Retry
sends it once with its original settings; while delivery is still unknown,
nothing is sent. A visible message can still be awaiting confirmation. If the
connection cannot read the native receipt, keep the chat and retry the check
after reconnecting. **Cancel** is always available on a pending, unconfirmed or
failed message, including while **Checking…** is shown (it ends that check).
The message shows **Cancelling…** until the server confirms, then leaves the
chat for good; the server also stops any work that message started. If the
server cannot be reached, the message stays with **Couldn't reach the server —
Cancel again**, and the chat retries after reconnecting. If the AI had already
received it, its answer still appears in the conversation. A failed message
that never reached the chat, for example because the temporary chat itself
could not start, has nothing on the server to cancel: **Cancel** removes it at
once, and **Edit** returns its text to the composer. **Stop** remains available for ongoing work. **Close** removes
the temporary chat only after its native work and attachments are safely cleaned
up; a failed Close shows its error beside the chat and can be retried. If you used
more than one AI in this chat, Close cleans up each retained native conversation.
A retry continues the unfinished cleanup without repeating histories already
removed. You do not have to retry it yourself when the cleanup left belongs to
one AI: the next time that AI finishes a turn in the same session (in Main chat,
another temporary chat or an AI task), Vibe64 tries the Close again and removes
the chat once cleanup succeeds. Archiving or renewing the session also finishes
it first. If its cleanup still cannot finish then, Archive session or the
renewal's confirmation stops with **A chat in this session could not finish
closing: <reason>. Resolve that, then try again.** and the session stays open.
Resolve the reason, often an AI account to reconnect, then try again.
Removing the view alone preserves the chat.

After the update that replaced repair chats with [AI tasks](ai-tasks.md), an old
repair chat that used Codex or OpenCode may show as closing, with the notice
**Vibe64 deletes this old repair chat and its Codex conversation after Codex next
works in this session. Close deletes them now.** (or OpenCode). Nothing is
needed: it disappears after that AI's next turn in the session, or when you
archive or renew the session. Select **Close** to remove it now. An old repair
chat that used both Codex and OpenCode says **This old repair chat holds Codex
and OpenCode conversations. Close deletes it with them.** and stays until you
select **Close** or archive or renew the session.

## Typing and message order

Typing indicators coalesce actual input into one small update at most every five
seconds, without sending your draft. They expire within ten seconds of the last
update. Blur, Send, switching chats and reconnecting send no additional typing
request. Prompt suggestions wait for a five-second typing pause and at least
thirty seconds between generations; refocusing does not generate new hints.

Messages and replies appear together in time order, including follow-ups sent
while the assistant is working. This works the same way in Main and Temporary
chat, on desktop and phone. Reopening or reloading shows the same history without
resending messages.

## What Colleague can do

Colleague can explain any of this, and offer to do the supported steps for you.
An explanation or an offer does nothing by itself; Colleague acts only when you
ask it to or accept its offer:

- **List** the session's temporary chats and **read** one's status and recent
  messages. AI tasks are not in that list; Colleague reads them as AI tasks.
- **Create** a temporary chat, only when you ask for a chat of your own. It
  appears among your tabs; creating it neither selects it nor sends anything.
  When you ask, it can copy
  recent Main messages into it, as **Include recent chat context** does. Work
  Colleague runs for you is a Colleague task in the
  [AI task window](ai-tasks.md), not a temporary chat.
- **Update** a chat: rename it (an empty name restores **Temporary N**), or change
  its **Chat mode** for the next message.
- **Send** a message or guidance to a chat, and **Stop** its work.
- **Close** a chat, which removes its saved history and attachments.
- **Open** a temporary chat or Main chat in your browser.

Colleague offers the same choices as the **Chat mode** menu: **Fix it with AI**,
**Custom** with a model it has seen in AI setup or the session's access (it never
invents one), and for the owner **Senior** or **Junior**. A team member's Colleague
offers only **Fix it with AI** and **Custom**, and a new chat it creates for them
starts on **Fix it with AI**; the owner's starts on Main chat's mode (Auto becomes
Senior). Auto is Main chat only. Choosing a model, sending work, stopping work and
closing a chat each remain separate requests.
