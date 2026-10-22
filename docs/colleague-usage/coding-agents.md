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
Connection and chat-update warnings use a compact full-width row above the
avatar: the recovery button is on the left and the explanation is on the right.
Text wraps on phones without moving the row below the avatar. The avatar stays
over the conversation below the warning; its size does not push history down.
Your avatar preference, loaded messages and draft stay intact. **Reloading…**
is disabled while reconnection is pending. Scroll chat if a short phone view
cannot fit the warning and composer together.

Status and recovery panels use a pale blue background with dark text in the
light theme, and a blue tinted background with light text in the dark theme.
This applies to connection and test-approval notices, session renewal messages,
and session information. Disabled notice controls remain readable.
A **Retry connection** or **Reconnect** notice uses these same colours. **Retry connection** remains visible but
unavailable while Vibe64 is checking the connection; your draft is kept. In the
dark theme the notice uses the theme's contrasting text. Desktop and phone show
the same status and recovery controls; Colleague can explain them, but reconnecting
the browser requires your interaction.
The selected chat checks its assistant connection while session details refresh.
A slow or failed details refresh keeps its own loading/error notice and does not
turn a verified assistant connection into a connection failure. Hidden idle chats
refresh their details without starting a provider until you select them.

If an OpenCode readiness check times out, wait for **Retry connection** to become
available and try it again. That timeout leaves the shared server and other chats
running; it does not mean your submitted work stopped. Inspect the retained reply
before resending. The same recovery applies on desktop and phone; Colleague can
explain it, while the browser reconnection requires your interaction.

## Exact Vibe64 contracts for coding agents

When a coding agent writes or repairs a Vibe64-owned project declaration, such as
the `## Workspace setup` or `## Outputs` section of `genesis/stack.md`, a Preview
identity adapter or an integration setup command, it reads the exact contract
with `vibe64-helper spec <name>`. `vibe64-helper spec` lists every contract.
These specs are part of the installed Vibe64 release, so the agent does not need
Vibe64's source. A Stack error ends with the spec to read, for example
`Exact grammar: vibe64-helper spec outputs.`

Colleague does not run this command. To get a contract applied, ask the coding
agent in Main chat; Colleague can explain which contract applies and offer to
send that request. Desktop and mobile behave the same.

## Send, steer and stop

A message that a lesson's **Do it for me** sent for you (in a practice
project's Main chat) is your message like any other and shows a small **Sent
by the lesson** chip under it.

While **Send** is pending, Vibe64 prepares the selected assistant and waits for
delivery acknowledgement. Codex reuses an already-ready project environment;
missing resources or changed Env files still require preparation. Wait for
delivery or a reported failure before retrying the request. The same behaviour
applies on desktop and mobile; Colleague can explain a delay but cannot skip
the connection or preparation checks.
While the first request is starting, you can submit a follow-up in a connected
Codex or Claude chat. It appears as **Pending** while the delivery queue waits
for the current submission. The queued bubble stays after that submission even
if preparation delays the earlier message's recorded time. Pending is not a
delivery acknowledgement. A lost
connection or an unconfirmed stop can still prevent Send; resolve that notice
before submitting more work. Desktop and mobile use the same queue.
The current submission's routing status does not disable additional **Pending**
messages in that queue. A genuinely uncertain delivery still needs its receipt
checked before more work is submitted.
**Stop** also cancels follow-ups still waiting locally to be sent. **Send** stays
unavailable while Stop is being confirmed. Already dispatched requests retain
their delivery status; inspect them before deciding whether to send again.

Codex, Claude and OpenCode share the project-format check before refreshing
skills and agent guidance. This check reads the format marker without scanning
application files; it does not replace the separate guidance checks.

When an assistant cannot start, stops by itself or reports a failure, see [When a coding agent fails or stops](coding-agent-failures.md).

1. Select the intended project and session, then Main or the intended temporary
   conversation. Type the request and select **Send**.
2. While it works, add instructions through **Steer**. This targets the active
   conversation; selecting another project does not move an earlier request.
   Steering never stops running work: Claude reads the instruction after its
   current command (such as a deploy) finishes, and Codex adds it to the active
   turn. Use **Stop** when you want to cancel.
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
delivery timings for Codex, Claude and OpenCode, including the routing and
message-preparation phases before native delivery, without reading the prompt or
credentials. Colleague can explain this status; inspecting server logs requires
the operator or a coding agent with authorized access.
Clicking twice during a pending retry does not submit again; your separate
composer draft stays intact.
**Edit** and **Cancel** remain unavailable while delivery is uncertain.
If a turn finishes successfully just before **Steer** arrives, Vibe64 sends that
same message as a new request after confirming it was not delivered. You do not
need to send it again. This applies to Codex and Claude on desktop and mobile.
Stopped, cancelled, failed or unverified turns do not authorize this recovery.
Other rejected **Steer** messages return to the composer; **Retry** retains the
request ID and any newer draft text. Use **Cancel** or **Edit** before changing
the request. Colleague can explain the status; browser recovery controls require
your interaction.
After changing the signed-in person or AI connection, resolve that change before
checking the original request; a different account cannot confirm it was not sent.
If OpenCode cannot confirm delivery, checking its status does not send the request
again. An unavailable receipt remains uncertain; inspect the conversation before
deciding what to send next. This also applies to steering instructions.
For provider startup, interruption and delivery recovery, read
[Coding-agent recovery](coding-agent-recovery.md).

An attachment upload refused because its session is closing identifies whether
the session is being archived or deleted when that reason is known. No file is
added. Use an open session before uploading again. Colleague can explain the
notice; it cannot override the closing check. The same rule applies on desktop
and mobile.

Open **Chat mode** at any point to choose **Senior**, **Junior**, an
**Orchestrator**, or **Custom** → **Apply**. Saving settings does not stop the
current turn. The next turn uses the new settings; see [Goals and model
changes](coding-agent-goals.md) for automatic continuations and an unfinished
goal's retained orchestrator. If saving fails, the control reports the error;
retry after resolving it. Colleague can explain or perform a supported selection
change when you explicitly ask.

To change the model for an active Update merge repair, open **Chat mode** in
that repair's composer, then **Choose model**. In **Custom AI**, choose a
**Model** and select **Apply**. The repair keeps **Senior**, its history and its
current turn. The next turn uses the selected model; Main chat's model is
unchanged. On compact screens, reveal chat first; the controls are the same as
on desktop.

Returning to Main chat or reloading the page keeps a saved temporary conversation.
To remove it, use the **Close** control on that chat's tab. If stopping or cleanup
fails, the chat stays available; resolve the reported error and try **Close** again.
Closing removes that conversation's history and attachments after cleanup succeeds;
source edits remain. The same controls apply on desktop and compact screens.

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

A message rejected before sending, including text beyond the input limit, stays
failed with its original error. Use **Edit** to shorten it or **Cancel** to remove
that rejected attempt. Cancel does not send the message, remove accepted history,
or bring the failed bubble back after a reload. These controls work the same in
the standalone editor and a hosted workspace. A lost delivery acknowledgement
still requires checking the exact request; it is not treated as a rejection.

If **Retry** reports that delivery is still unknown, the old message
remains visible. Once the conversation is ready, you can type and **Send** a
different message. The uncertain message is not resent, and its same words remain
blocked until its delivery is resolved. Active or unresolved server work still
blocks continuation. Checking again reports the latest result rather than keeping
an earlier connection error. Colleague can explain recovery; sending a new message
or checking delivery remains your explicit action.

Claude cold startup can wait up to 90 seconds for its initialization handshake
while managed startup probes finish. **Pending** means the message has not yet
been acknowledged. Keep the bubble in place; use its **Retry** action after a
failure rather than sending another copy. Stop and other normal controls retain
their existing deadlines.

For a slow Claude start, an operator can inspect the private startup diagnostic.
A successful start taking over five seconds records one warning with total time,
time until the managed process stream was ready, and time spent initializing
Claude afterward. This separates process launch from native initialization;
the timing record contains no prompt, credentials or native output. A warning
does not mean delivery failed: the message's acknowledgement remains authoritative.

If Claude rejects an input before writing it to the native process, its retained
request becomes retryable after delivery inspection. Use **Retry** on that exact
message. An uncertain acknowledgement still uses **Retry delivery check** first;
that action checks the existing receipt and does not submit a duplicate.

### Tables in chat

Assistant replies display Markdown tables as tables, including tables with blank
column headings. On narrow screens, scroll a wide table horizontally to read
its remaining columns. Reloading preserves the same table from saved history.
