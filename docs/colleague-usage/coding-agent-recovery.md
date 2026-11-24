# Recover coding-agent connections and delivery

Use these steps for Main chat, temporary chats and AI tasks' Chat. Keep the original request
and inspect its delivery before retrying. For ordinary controls, see
[Coding agents](coding-agents.md).

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

## When a turn is interrupted

When Vibe64 crashes, restarts, is updated or moved while the AI is working, or
the AI's engine stops or its connection is lost, the chat's history says so in
red where the turn stopped: what happened and when (on your own clock), then
whether Vibe64 resumed the turn or why not. The entry stays after a reload and
every member of the session sees it. A crash names its cause, for example
**Vibe64 crashed at 12:18: read ECONNRESET.**

Vibe64 then resumes the turn by itself, once, in the same conversation with the
same AI session, in Main chat, temporary chats and AI tasks, as the person who
sent it. It does not wait for anyone to open the chat. Its message to the AI
starts with a short Vibe64 note saying what interrupted it, and asks the AI to
check the state of what it was doing (files, Git, commands it started) before
repeating any step. The second line reads **Resumed after Vibe64 restarted at
12:18.** (or after the update, the engine stopping, the lost connection). After
a lost connection or an overloaded AI service it waits about 30 seconds first,
and the chat says **Vibe64 resumes this turn shortly**: choose **Continue** to
resume it now or **Cancel** to leave it. A message that may have reached the AI
is never sent twice: when Vibe64 cannot confirm it arrived, the entry says so and
**Retry** checks its receipt.

If the same turn is interrupted again within 10 minutes of being resumed, Vibe64
stops instead of resuming it in a loop: the entry reads **Not resumed: stopped:
Vibe64 restarted twice while it ran.** and **Continue** tries again. A turn you
stopped, or one that had finished, is never resumed. When the AI account needs
signing in again, the entry says so: sign in in **AI Accounts**, then choose
**Continue**. At a usage limit, choose **Continue** or send a message once the
limit resets. A goal resumes the same way, under the same 10-minute rule (see
[Coding agent goals](coding-agent-goals.md)). In Main chat a Codex turn may also
read **Codex was interrupted by a Vibe64 restart before it could finish**; the
red entry after it says what Vibe64 did. While a resumed turn runs, Save and
Update wait for the AI as for any other turn; once a turn has stopped, nothing
shows it as still working. Colleague can explain an entry and use **Continue**
for you when you ask.

For an operator investigation, each start of Vibe64 logs its recovery as
warnings, which production keeps: `vibe64.turn_resume.recovery_started` and
`vibe64.agent_goal.recovery_started` with the projects checked, one
`recovery_outcome` line per turn or goal (resumed, stopped by the 10-minute
rule, or skipped and why), `vibe64.turn_resume.resumed`,
`vibe64.turn_resume.stopped_by_loop_rule` or `vibe64.turn_resume.skipped` for
each Main and temporary chat turn, and `recovery_finished` with the totals. A
crash's record counts the turns it interrupted that Vibe64 resumed.

## Other recovery
A turn that finishes while Vibe64 is stopping keeps its reply, and its recovery
snapshot is likewise saved once Vibe64 runs again. When the AI's own saved
history holds that reply, the turn reads as finished: it is not resumed and gets
no red entry. A Claude or OpenCode turn whose reply is not in that history reads
as interrupted by the restart and is resumed as above; a Claude turn shows
**Claude was interrupted when Vibe64 disconnected.**
When Claude or OpenCode reports a model or execution failure, read the reported
conversation status and check any reply before deciding whether to send another
request. Reply text by itself does not prove that the turn completed successfully.
If the conversation reports **Claude stopped unexpectedly**, its Claude process
ended without anyone stopping it, and its subagents' running commands were
cancelled. The message names the recorded cause: **process/thread limit
reached** means the server refused Claude more processes or threads, while a
signal or exit code is reported otherwise. The saved conversation is retained.
Send a message, or **Resume goal** for a goal, to continue; repeated stops with a
limit cause require the workspace operator. Colleague can explain the reported
cause; changing limits is an operator task.
Unconfirmed cleanup blocks replacement work, including after failed startup.
While Claude is starting, **Stop** joins that process's existing cleanup. Its
execution is recorded once; waiting for initialization does not disable Stop.
Restore the execution service and retry **Stop**; wait for success before new
work. Do not resubmit an uncertain request as a workaround. Project **Close**
also retries pending cleanup and reports unconfirmed exit; a failed Close is
not successful cleanup.

If chat reports **Claude Code account status could not be checked**, read the
reported cause. A permission, startup or timeout failure does not mean you signed
out. Ask the workspace operator to repair the Claude installation or execution
service, then refresh readiness in **AI Accounts** and retry the original request.
Colleague can explain and recheck readiness; installation repair requires the
operator. Only an actual signed-out status asks you to sign in again.
Reconnecting cancels older model-list and usage checks. If one reports that it
was cancelled for reconnection, refresh after reconnection completes.
While Claude is working, automatic status checks keep its current instructions.
Changed project guidance applies when it is idle; checking status does not require
stopping a turn. If a connection error remains after the operator repairs it,
select **Retry connection**, then check delivery before retrying your message.
Colleague can explain this recovery on desktop and mobile.

Claude can continue automatically when a background task reports back. The
working indicator and **Stop** remain available for that work, even after an
earlier answer. Sending guidance while only background work remains starts the
next native instruction without waiting for the finished main reply to stop.
These controls behave the same on desktop and mobile. Colleague can explain the
state and perform supported Stop or Send actions when you ask.
If Claude disconnects and cleanup cannot yet be confirmed, the chat shows
**Assistant stop not yet confirmed** instead of claiming it is working.
Restore the execution service and retry **Stop**. An unexpected parent-process
exit is detected even if a child still holds the output connection open.

The first send after a restart can remain **Pending** while Claude starts.
Startup improvements do not eliminate provider initialization time.
Wait for delivery to settle; if the request becomes uncertain,
use its existing **Retry** receipt check instead of submitting another copy.

For an operator investigation, retain the request time and session identity.
Server events named `vibe64.claude.startup` report startup stages and failures;
`vibe64.claude.lifecycle` reports activity, task counts and steering results.
They correlate conversation, turn and execution IDs without recording prompts,
responses or task descriptions. Startup failure diagnostics retain bounded,
redacted native stderr. Colleague does not have raw server-log access.
The session's own [timeline](session-timeline.md) (`npx vibe64 timeline <session id>`)
lists its turns, cancels and stops with their reasons, engine processes and
browser connections in order, without message text.

For interrupted renewal, an accepted prompt is not repeated automatically.
Recovery requires a confirmed completed turn; partial text alone is insufficient.
If completion cannot be confirmed, use the reported manual handover recovery.
Claude tool progress remains commentary even when its text and tool call arrive
separately; the final answer is saved when its message completes.

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
The same Stop and retry rules apply to temporary chats and in an AI task's Chat.
Genesis failing or not answering does not stop OpenCode: the project's Genesis
hook adds nothing, and the conversation goes on with Vibe64's own guidance.
If OpenCode still reports **Project guidance could not load**, its project instructions
were unavailable; this is not confirmation that your API key failed. Ask the
installation owner to check the installed Genesis runtime and project hook. Once
that prerequisite is repaired and the conversation is ready, enter a new message
in the same conversation and select **Send**. The failed message remains in its
history; its composer draft is not retained. Colleague can explain the notice,
but repairing the installed runtime requires the installation owner.
The same recovery applies on desktop and mobile.
Genesis never fails a conversation for an oversized host session
contribution: from the release after 1.10.27 it takes up to 32 KiB, and cuts a
larger one after its last whole line that fits, keeping its own project
guidance whole. The editor's log then names the size
(`vibe64.agent_guidance.host_guidance_cut`); give that line to the
installation owner, who shortens the host guidance. Colleague can explain it.
A message in a temporary chat or an AI task's Chat may appear before the assistant confirms receiving it.
If it still shows **Retry**, use that control and keep the same request;
its visible bubble alone is not confirmation. An unavailable receipt stays
unconfirmed and keeps its files and any newer composer draft. Checking does not
submit another native turn. Colleague can explain the reported state; a new
request still needs your instruction.


## Command access after a connection change

If command access reports **Managed assistant control health could not be verified**,
retry the assistant connection. A slow check retains existing command credentials;
it does not replace the listener merely because the check timed out. No rejected
command is automatically repeated.

If an assistant reports **Vibe64 session command identity is invalid**, reconnect
the affected assistant before retrying its command. When only a child agent is
blocked, ask its parent to replace that child with a handover of its unfinished
work. Keep the original files and saved conversation. Repeating the same rejected
command does not refresh that child's credentials. Colleague can explain the
error; it cannot replace coding-agent credentials or disable their checks.
