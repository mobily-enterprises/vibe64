# Recover a conversation that exceeds its context limit

A maximum-context error means one request contains more conversation history than
the selected model accepts. It does not mean your credit or paid token allowance
has run out. A message reporting zero completion tokens was rejected before a
reply was generated; saved file changes from earlier work remain.

Do not keep adding messages to the same oversized context. Compaction summarizes
its working context while keeping the saved conversation. For a conversation
already stuck at this limit, ask the workspace operator to check native compaction
and recovery. Colleague can explain the error; it does not gain operator, shell
or account access through this guide.

After recovery is confirmed:

1. Reload the page and reopen the same project, session and Main chat.
2. Read the saved reply and status. Reopening does not send another request.
3. Select **Send** with a new continuation when ready. If an earlier request has
   unknown delivery, use its existing **Retry** before deciding to resend.

These steps are the same on desktop and phone. Changing accounts or models is
not a substitute for checking an uncertain request. Keep the intended account and
model unless you deliberately want to change them. If the context error returns,
report the session and exact error to the operator rather than deleting history
or repeatedly submitting more work. Never paste API keys into chat.

Claude may show **Pending** while starting its native process after a restart.
Keep the same conversation open and let that submission settle; a long saved
history is not a reason to create a replacement chat. If startup fails, use the
failed message's **Retry** after the reported problem is resolved. Colleague can
explain the status and recovery controls on desktop and phone.
For a recurring startup delay, give the operator the session and approximate
send time. Startup diagnostics separate process launch, initialization request,
completed input write and response arrival without recording the message body.
Colleague can explain this recovery path; inspecting server diagnostics requires
the operator's access.
Managed Claude conversations use Vibe64's Git workflow without Claude's automatic
startup Git snapshot or built-in commit/PR instructions. Agents can still inspect
current changes through the ordinary managed Git tools when the task needs them;
Save and publication keep their existing controls and permissions.

Project guidance can change while Codex is working. The current turn keeps its
installed instructions; the next idle admission reads the latest guidance without
interrupting healthy work. Preparing that guidance does not consume the separate
native-control timeout. If a connection error still appears, read the saved reply
and check any uncertain delivery before sending new work; do not assume the model
failed or repeat a request whose outcome is unknown.

## Attach files

Use **Add to message** or drop/paste files into the conversation. Each file may
be up to 500 MiB. Wait for its upload to finish before sending; an oversized
file remains marked as failed so you can remove it and choose a smaller file.
For a directory, upload an archive through Files → Session Dropzone. Uploading
does not itself send a message. Colleague can explain these steps; choosing a
file from the person's computer requires their interaction.


## Change AI while keeping the discussion

In Main chat, select the intended AI with the existing assistant controls, then
send your next message. Ordinary Claude and Codex conversations receive the
visible discussion up to the selected destination's available normal context.
Reasoning is excluded. This transfer keeps original message text and attribution;
it does not create a summary or change the saved chat.

If the history is too large, the oldest complete transferred messages are omitted
first. Returning to an existing AI sends missed or corrected messages within the
remaining allowance. The transfer reserves a small working space (5% of the
usable window, at least 32,768 tokens) and does not enable an
extended context window or change model settings. Carrying more history can still
increase input usage and cost.

When Claude's own memory is nearly full, Vibe64 first summarises it
automatically — the same compaction Claude performs on its own — and then sends
the missed messages that fit. The chat shows **Summarising the assistant's
memory before sending…** while this happens, which can take a minute or two;
keep the page open. Nothing in the saved chat changes.

If summarising fails, or even after it there is no room left, a **Not enough
room** dialog explains the problem and the message is not sent. Select
**Summarise and continue** to try again, or **Close** and choose another
assistant with the existing assistant controls. An unavailable usage reading also
stops delivery before sending; retry after reconnecting the assistant. If a
message instead reports uncertain delivery, use its existing **Retry**, which
checks the original receipt without rebuilding or duplicating the request.
These steps are the same on desktop and phone. Colleague can explain this dialog;
selecting its buttons requires the person's interaction.

This policy concerns ordinary Main chat. Learning's tool-bound context, temporary
chat context copying and Colleague's own history policy are separate.

While Claude is working, you can send a follow-up to steer the same conversation.
Claude reads it after its current command finishes; sending it does not stop
that command. Use **Stop** to cancel work.
Updated project guidance is applied when a later turn starts idle; it must not
block an ordinary follow-up or restart active work. Account changes and explicit
model settings still use their existing checks. If a message shows an error,
keep its text and use **Retry** after the reported problem is resolved; a failed
message does not mean Claude has stopped its previous task.
