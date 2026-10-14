# Recover coding-agent connections and delivery

Use these steps for Main and temporary conversations. Keep the original request
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
