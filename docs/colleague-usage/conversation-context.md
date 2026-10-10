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
   unknown delivery, use its existing **Check delivery** before deciding to resend.

These steps are the same on desktop and phone. Changing accounts or models is
not a substitute for checking an uncertain request. Keep the intended account and
model unless you deliberately want to change them. If the context error returns,
report the session and exact error to the operator rather than deleting history
or repeatedly submitting more work. Never paste API keys into chat.

Project guidance can change while Codex is working. The current turn keeps its
installed instructions; the next idle admission reads the latest guidance without
interrupting healthy work. Preparing that guidance does not consume the separate
native-control timeout. If a connection error still appears, read the saved reply
and check any uncertain delivery before sending new work; do not assume the model
failed or repeat a request whose outcome is unknown.
