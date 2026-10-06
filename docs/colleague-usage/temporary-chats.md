# Choose the AI for a temporary chat

Open **Temporary AI** from the session toolbar, or from **Session actions** in
a narrow chat. Select the temporary chat you want to change. Its **Chat mode**
icon is inside the message box.

Ordinary temporary chats offer **Custom**, **Senior** and **Junior**. Choose
**Custom** to open the **Orchestrator**, **Model** and **Thinking** fields. Select
an available connection and model, then **Apply**. The next message uses that
choice and the existing conversation history. Main chat's selection is unchanged.

## Hand a merge repair to another model

**Fix it with AI** for an Update conflict opens a temporary repair using Senior
and sends the repair instructions once. Its reply appears in that temporary
chat; Main chat's history is unchanged.
Merge repair always retains the Senior role. To hand it to Codex:

1. If it is still working, press **Stop** and wait for it to stop.
2. Open its **Chat mode** icon and choose **Choose model**.
3. Select **Codex**, the desired model and thinking level, then **Apply**.
4. Send a follow-up asking it to inspect the current edits and continue the repair.

The repair instructions, messages and work already in the session remain. A
model change does not undo edits or prove the merge correct. **Check Update**
verifies the repaired session through Vibe64's existing repository operation.
Only available models can be selected; an active goal must finish before a
model change. An old request admitted to another role must be cancelled and
resent to Senior; an already running turn must first be stopped.

Colleague can explain these steps and change a temporary chat's selection through
its authorized temporary-conversation action when explicitly asked. Stopping or
sending work remains a separate requested action.

## Work elsewhere while a chat runs

Select **Main chat** or another temporary tab to continue elsewhere. The hidden
chat keeps receiving progress, and a new assistant reply marks it unread. Open
that chat to clear its unread indicator. Returning to the view or reloading
restores saved chats and their history; it does not send the request again.

Leaving the view does not stop work or close a chat. Use **Stop** to interrupt
work while retaining the conversation, or **Close** to remove that chat after
cleanup succeeds. Colleague can explain the current state and perform supported
chat actions when you request them.

## Recover a lost delivery confirmation

If a send fails before admission, **Retry** sends the original message with its
original settings and files. Anything you typed or attached afterward stays in
the composer. Accepted files leave the composer; later attachments remain.

If a message shows **Check delivery**, use that control with the original message.
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
