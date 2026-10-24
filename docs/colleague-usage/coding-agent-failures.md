# When a coding agent fails or stops

For sending, steering and stopping, see [Direct coding agents and follow assignments](coding-agents.md). This topic covers what to do when an assistant cannot start, stops on its own or reports a failure.

If Claude cannot initialize, inspect the failed request before selecting **Retry**.
An initialization failure occurs before that request reaches Claude; it does not
complete the requested work. Vibe64 keeps a bounded, credential-redacted startup
diagnostic in its private operational log before confirmed process cleanup. The
request stays in chat for review; use **Retry** to recover its delivery.
Colleague cannot read that log.

If an assistant stops because its credits or quota are exhausted, open **Chat
mode** and choose another connected **Orchestrator**, or choose **Custom** and a
permitted model. A pending automatic continuation or review does not prevent
this change: Vibe64 cancels its old scheduling and waits for routing-helper
cleanup before switching. During an active turn, the new settings are saved for
the next turn. After a different main AI is saved in AI setup, an unfinished
goal is cancelled the next time it would continue; see [Goals and model changes](coding-agent-goals.md). A reported cleanup failure keeps
the previous selection; retry after restoring the execution service.
The session's files and saved conversation remain. Switching does not resend
the session's already-delivered opening briefing through project setup. A first
switch to Claude carries the bounded conversation history directly, including
transfers larger than the project-prompt request limit.
Switching does not resend
the old request or confirm uncertain delivery. Use **Retry** for that
original request before deciding to repeat it; send a new instruction when you
want the new assistant to continue the work. After the switch, **Send** becomes
available automatically; reloading or **Retry** is not required to
start a new request. **Previous assistant delivery unconfirmed** describes the
old attempt and explains how to continue with your selected assistant. Its
**Retry** control only checks that previous attempt.
These steps apply on desktop and
mobile. Colleague can explain the notice and change a supported selection when
you ask it to; provider credit top-ups require your interaction.

If failure, Stop or reconnection observes different outcomes for one assistant
turn, Vibe64 reuses that turn's first recovery checkpoint and its recorded
outcome. A failed turn can therefore have a valid checkpoint.

**Recovery snapshot not saved** means Vibe64 could not confirm the automatic
recovery copy for an assistant turn. It does not mean your working files were
deleted or prevent you from chatting. An interrupted snapshot command is named
as such; expand **Technical details** for the original error and recovery steps.
Vibe64 attempts another snapshot when the next assistant turn finishes, including
failed or stopped turns—not immediately when you send a message. A successful
snapshot clears the warning automatically.

Select **Dismiss** to hide this particular failure. This takes effect immediately
and is remembered for this project/session in the same browser across reloads.
It does not delete diagnostic records or create a snapshot. A later failure shows
a new warning, even if its error text is the same. The same controls work on desktop
and mobile; no SSH or administrator access is required. Colleague can explain the
notice and its recovery steps; use the visible Dismiss button yourself. Repeated
identity, permission or storage failures still need operator investigation.

An unsupported OpenCode version needs operator runtime repair before retrying;
repeating a message cannot fix it. Colleague can explain this startup error on
desktop or mobile but cannot repair the host installation.

If OpenCode produces reasoning without a final answer, it makes one automatic
attempt to obtain that answer. You can still send a new instruction; it waits for
that recovery message to be confirmed before delivery. **Stop** remains available
while it waits. If delivery or the final answer cannot be confirmed, inspect the
existing messages and work before retrying; do not send the same request again.
The original request and its reasoning remain in the chat. These controls work
on desktop and phone; Colleague can explain the status and offer a supported
check, but does not silently repeat your message.
Progress summaries describe the work in progress; they do not mean the final
answer is ready. They remain attached to the same conversation after reconnecting.

For goal controls and changing models while a goal is running or paused, read
[Goals and model changes](coding-agent-goals.md).

If a Learning practice conversation's source clone was removed, Codex shows the
same clone-recovery notice as a Working conversation. Keep the saved lesson and
request while resolving the missing clone before retrying.

If Codex cannot load its model catalogue, ask the operator to check its
installation/connection and restart the assistant service. Colleague can explain
this desktop/mobile recovery but cannot perform the host operation.

If Codex stops while the editor restores its managed controls, its notice identifies
that interruption. An interruption with no known cause is not reported as a
provider failure. **Stop**, service restart, missing final-response delivery and a
confirmed provider failure retain their distinct notices. Your saved file changes
remain; inspect the result and send a new message when ready to continue.

If Codex reaches its total usage allowance, the chat shows the provider's limit
message and any retry time it supplies, even if Codex already wrote progress or
an answer during that turn. Saved replies and file changes remain. Use **View
Codex usage & billing** to inspect the allowance, wait for availability, or choose
another available AI through **Chat mode**. Restarting the conversation does not
reset the allowance. Colleague can explain these options; it cannot increase
your provider allowance.
