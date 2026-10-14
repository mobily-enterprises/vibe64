# Direct coding agents and follow assignments

Use Main chat for ongoing work in a session. Temporary conversations give another
conversation access to that same session's source; a different session has its
own worktree and does not see unsaved edits automatically.
Main chat remains available for Codex, Claude and OpenCode when Colleague is not
enabled. Open the intended project and session directly; Colleague is not a
prerequisite for **Send**, **Steer** or **Stop**.

Main and temporary chats use your Studio login. If it expires, sign in and
reopen the intended chat. Check uncertain delivery before retrying; signing in
or reloading reconnects history and updates without resending. Main also refreshes
the same conversation after a reported finish if its completion update was missed.
If old live fragments remain, reload and inspect the saved reply before sending
more work. These steps apply on desktop and mobile.

A compact connection warning keeps loaded messages and drafts. Its **Reload
chat** reconnects observation without resending or stopping work; the warning
alone cannot establish whether the agent is running. Access denial clears cached
messages and hides Reload: sign in with the authorized account and reopen chat.
Desktop and phone use the same recovery. Colleague can explain it; reconnecting
this browser view requires your interaction.
While that warning is shown, the avatar and its controls occupy space above the
messages so they cannot cover the warning or **Reload chat**, including on a
phone. History has less visible height until the warning clears; your avatar
preference, loaded messages and draft stay intact.
Scroll chat if a short phone view cannot fit the warning and composer together.

Status and recovery panels use a pale blue background with dark text in the
light theme, and a blue tinted background with light text in the dark theme.
This applies to connection and test-approval notices, session renewal messages,
and session information. Disabled notice controls remain readable.
A **Retry connection** or **Reconnect** notice uses these same colours. **Retry connection** remains visible but
unavailable while Vibe64 is checking the connection; your draft is kept. In the
dark theme the notice uses the theme's contrasting text. Desktop and phone show
the same status and recovery controls; Colleague can explain them, but reconnecting
the browser requires your interaction.

## Send, steer and stop

While **Send** is pending, Vibe64 prepares the selected assistant and waits for
delivery acknowledgement. Codex reuses an already-ready project environment;
missing resources or changed Env files still require preparation. Wait for
delivery or a reported failure before retrying the request. The same behaviour
applies on desktop and mobile; Colleague can explain a delay but cannot skip
the connection or preparation checks.
Codex, Claude and OpenCode share the project-format check before refreshing
skills and agent guidance. This check reads the format marker without scanning
application files; it does not replace the separate guidance checks.

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
cleanup before switching. An active coding turn still requires **Stop** first;
an unfinished goal requires **Cancel goal**. A reported cleanup failure keeps
the previous selection; retry after restoring the execution service.
The session's files and saved conversation remain. Switching does not resend
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

1. Select the intended project and session, then Main or the intended temporary
   conversation. Type the request and select **Send**.
2. While it works, add instructions through **Steer**. This targets the active
   conversation; selecting another project does not move an earlier request.
3. Use its **Stop** control when you want to stop coding work. Stopping speech or
   Colleague's own turn has a different effect. For Codex, **Stop** targets this
   conversation; other conversations remain available even when they share your
   Codex account. The same control applies on desktop and compact screens.
4. Wait for the actual answer and inspect its reported checks. Delivery or a
   working status is not a completed implementation.

On compact screens, reveal chat before using its composer. Failed submissions
remain visibly failed or pending; inspect the target before retrying an uncertain
write. Retry reuses the original request identity rather than starting duplicate work.
A visible authored message can confirm delivery before the original request returns;
wait for its answer instead of sending it again. This applies to Codex steering too.
Your draft, uploaded file references and failed requests stay with the same
signed-in person, project and session across a page reload. Restoring them does
not send anything. **Retry** retains the original ID and payload. In Main, when
no matching routing request is recorded, it submits that same request through the
existing server coordinator, which checks for duplicates and earlier dispatch.
If native delivery was already attempted, recovery checks its receipt instead
of repeating the work. A conflicting saved failure is checked before retrying.
While the status says **awaiting receipt**, wait for confirmation rather than
submitting another copy. That wait can include preparation, native acknowledgement
and saving the receipt. If it repeatedly takes a long time, give the operator the
project/session URL and approximate send time. The operator can compare message
delivery timings for Codex, Claude and OpenCode without reading the prompt or
credentials. Colleague can explain this status; inspecting server logs requires
the operator or a coding agent with authorized access.
Clicking twice during a pending retry does not submit again; your separate
composer draft stays intact.
**Edit** and **Cancel** remain unavailable while delivery is uncertain.
A rejected **Steer** returns to the composer; **Retry** retains its request ID
and any newer draft text. Steering arriving after a finished turn never becomes
new work automatically. Use **Cancel** or **Edit** before sending new work.
After changing the signed-in person or AI connection, resolve that change before
checking the original request; a different account cannot confirm it was not sent.
If OpenCode cannot confirm delivery, checking its status does not send the request
again. An unavailable receipt remains uncertain; inspect the conversation before
deciding what to send next. This also applies to steering instructions.
OpenCode can receive a message before Vibe64 finishes saving it. An early reply
does not confirm that the message was saved. If saving fails, keep the same
request and use **Retry** to check its receipt. Ask the operator
to restore storage if needed, or resolve the reported **Stop** failure first;
neither recovery repeats the prompt.
After OpenCode restarts, opening a conversation can take longer while its working
directory is prepared. Wait for preparation to finish before using the chat.
If preparation fails, resolve the reported error and retry; the saved conversation
is retained and preparation does not send a message. Colleague can explain the
error; an installation problem requires the workspace operator.
When Claude or OpenCode reports a model or execution failure, read the reported
conversation status and check any reply before deciding whether to send another
request. Reply text by itself does not prove that the turn completed successfully.
Unconfirmed cleanup blocks replacement work, including after failed startup.
While Claude is starting, **Stop** joins that process's existing cleanup. Its
execution is recorded once; waiting for initialization does not disable Stop.
Restore the execution service and retry **Stop**; wait for success before new
work. Do not resubmit an uncertain request as a workaround. Project **Close**
also retries pending cleanup and reports unconfirmed exit; a failed Close is
not successful cleanup.
If Codex reports lost observation, wait for it to confirm that work stopped.
A failed application-tool call can also require confirmed native cleanup.
Changing the model does not clear that responsibility; finish **Stop** before
sending more work, and inspect the retained reply or error before retrying.
If Stop cannot be confirmed, restore the connection and select **Stop** again;
the same conversation retains its cleanup responsibility. Checking or reopening
the conversation does not resend the request. A recovered reply appears in its
original chat; read it before deciding whether to repeat a message. Use **Send** when
you intend to continue. Colleague can explain the reported state; continuing or
stopping work still needs your instruction. These steps apply on desktop and
compact screens.
Changing Codex models keeps saved history. Earlier incompatible tool calls are
context, not new work. A compaction error does not undo saved file changes.
Colleague can explain the notice; retrying or changing models still needs your
instruction.
When OpenCode's shared service fails, other affected conversations can also stop.
Inspect their status and existing work before selecting **Send** again; recovery
does not automatically repeat their requests. An ordinary conversation close
keeps the shared service available to its other conversations. Colleague and
project chat share this service: closing either one leaves the other available.
If recovery has to stop the shared service, inspect both chats before retrying.
A failed OpenCode **Stop** leaves the current turn available for another **Stop**
attempt. After Stop succeeds, **Send** starts the next turn in the same conversation.
The same Stop and retry rules apply to temporary chats.
If OpenCode reports **Project guidance could not load**, its project instructions
were unavailable; this is not confirmation that your API key failed. Ask the
installation owner to check the installed Genesis runtime and project hook. Once
that prerequisite is repaired and the conversation is ready, enter a new message
in the same conversation and select **Send**. The failed message remains in its
history; its composer draft is not retained. Colleague can explain the notice,
but repairing the installed runtime requires the installation owner.
The same recovery applies on desktop and mobile.
If the underlying error is `HOST_CONTEXT_INVALID` and names an oversized host
session contribution, give the installation owner the error and byte limit.
Genesis compiler 1.8.5 accepts up to 24 KiB of that contribution without
truncation. The owner can align the installed compiler or shorten the host
guidance before you retry; Colleague can explain the recovery.
A temporary message may appear before the assistant confirms receiving it.
If it still shows **Retry**, use that control and keep the same request;
its visible bubble alone is not confirmation. An unavailable receipt stays
unconfirmed and keeps its files and any newer composer draft. Checking does not
submit another native turn. Colleague can explain the reported state; a new
request still needs your instruction.

An attachment upload refused because its session is closing identifies whether
the session is being archived or deleted when that reason is known. No file is
added. Use an open session before uploading again. Colleague can explain the
notice; it cannot override the closing check. The same rule applies on desktop
and mobile.

If Claude asks you to stop before changing its settings or instructions, select
**Stop**, wait for it to succeed, then retry the change. Its existing conversation
history is retained. Colleague can explain the error and perform a supported
change when you explicitly ask; stopping work still needs your instruction.

To change the model for an active Update merge repair, select **Stop** first and
wait for it to succeed. In that repair's composer, open **Chat mode**, then
**Choose model**. In **Custom AI**, choose a **Model** and select **Apply**.
The repair still uses **Senior**. Your selected model stays saved for that repair,
its history is retained, and Main chat's model is unchanged. Select **Send** to
continue the repair. On compact screens, reveal chat first; the controls are
the same as on desktop.

Returning to Main chat or reloading the page keeps a saved temporary conversation.
To remove it, use the **Close** control on that chat's tab. If stopping or cleanup
fails, the chat stays available; resolve the reported error and try **Close** again.
Closing removes that conversation's history and attachments after cleanup succeeds;
source edits remain. The same controls apply on desktop and compact screens.

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

For goal controls and changing models while a goal is paused, read
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

## Answer assistant questions

For numbered question fields, suggested answers and normal chat replies, read
[Answer assistant questions](coding-agent-questions.md).

For attachments, retained history and required upgrades, see
[Coding-agent history](coding-agent-history.md). For assignment requests and
watches, see [Ask Colleague to coordinate](colleague.md#ask-colleague-to-coordinate).

OpenCode Learning tools stay attached to the same saved lesson after **Send** is
accepted. Each later tool checks current lesson and account access; it cannot
retain permission to change the exercise from the earlier Send callback. If
access ends, inspect the lesson and account before sending a new request.

OpenCode keeps lesson progress and the final answer attached to the same accepted
request after **Send** returns. A prepared lesson question is shown as delivered
only when that request’s exact final answer is saved; a progress message alone
does not confirm delivery.


Typing and returning to the window do not refresh Colleague or goal status.
Their existing live connection still delivers changes and reconciles after a
reconnection. Typing indicators send one small update at most every five seconds
while you type, containing no draft text. They expire within ten seconds of the
last update; leaving the input sends no extra request.

Prompt suggestions wait for five seconds without draft changes, and start no
more than once every thirty seconds in the current view. Refocusing does not
regenerate dismissed suggestions. Changing the draft can request new suggestions
after those limits; unchanged input does not poll. You can keep writing and send
without waiting for suggestions.

An unconfirmed message shows small red error text and **Retry** inside
its own bubble. The notice belongs to
those exact words; it does not describe the previous assistant reply. The layout
is the same on desktop and phones.

If **Retry** reports that delivery is still unknown, the old message
remains visible. Once the conversation is ready, you can type and **Send** a
different message. The uncertain message is not resent, and its same words remain
blocked until its delivery is resolved. Active or unresolved server work still
blocks continuation. Checking again reports the latest result rather than keeping
an earlier connection error. Colleague can explain recovery; sending a new message
or checking delivery remains your explicit action.
