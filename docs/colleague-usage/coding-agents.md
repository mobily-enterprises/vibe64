# Direct coding agents and follow assignments

Use Main chat for ongoing work in a session. Temporary conversations give another
conversation access to that same session's source; a different session has its
own worktree and does not see unsaved edits automatically.
Main chat remains available for Codex, Claude and OpenCode when Colleague is not
enabled. Open the intended project and session directly; Colleague is not a
prerequisite for **Send**, **Steer** or **Stop**.

Main and temporary chats use your current Studio login. If that login expires,
sign in again and reopen the intended chat before retrying. Check any uncertain
delivery first; signing in does not submit the message again. These steps are
the same on desktop and mobile.
After a reload, history and live updates reconnect to the project and session
shown in that chat.

## Send, steer and stop

1. Select the intended project and session, then Main or the intended temporary
   conversation. Type the request and select **Send**.
2. While it works, add instructions through **Steer**. This targets the active
   conversation; selecting another project does not move an earlier request.
3. Use its **Stop** control when you want to stop coding work. Stopping speech or
   Colleague's own turn has a different effect.
4. Wait for the actual answer and inspect its reported checks. Delivery or a
   working status is not a completed implementation.

On compact screens, reveal chat before using its composer. Failed submissions
remain visibly failed or pending; inspect the target before retrying an uncertain
write. Retry reuses the original request identity rather than starting duplicate work.
A visible authored message can confirm delivery before the original request returns;
wait for its answer instead of sending it again. This applies to Codex steering too.
Your draft, uploaded file references and failed requests stay with the same
signed-in person, project and session across a page reload. Restoring them does
not send anything. Review an unconfirmed request before using **Retry**; when
**Check delivery** is shown, it checks the existing request without resending it.
If a rejected **Steer** returns to the composer, **Retry** keeps its original
request ID and leaves any newer text you appended in the composer.
If OpenCode cannot confirm delivery, checking its status does not send the request
again. An unavailable receipt remains uncertain; inspect the conversation before
deciding what to send next. This also applies to steering instructions.
After OpenCode restarts, opening a conversation can take longer while its working
directory is prepared. Wait for preparation to finish before using the chat.
If preparation fails, resolve the reported error and retry; the saved conversation
is retained and preparation does not send a message. Colleague can explain the
error; an installation problem requires the workspace operator.
When Claude or OpenCode reports a model or execution failure, read the reported
conversation status and check any reply before deciding whether to send another
request. Reply text by itself does not prove that the turn completed successfully.
If cleanup cannot be confirmed, the conversation reports the problem before
starting replacement work. Restore the execution service and use **Stop** again.
Wait for Stop to succeed before starting replacement work; do not resubmit an
uncertain request to work around that failure.
This also applies when startup failed before a reply appeared. Closing the
project retries its pending cleanup and reports a failure if exit is still
unconfirmed; do not treat a failed Close as successful cleanup.
If Codex reports lost observation, wait for it to confirm that work stopped.
If Stop cannot be confirmed, restore the connection and select **Stop** again;
the same conversation retains its cleanup responsibility. Checking or reopening
the conversation does not resend the request. A recovered reply appears in its
original chat; read it before deciding whether to repeat a message. Use **Send** when
you intend to continue. Colleague can explain the reported state; continuing or
stopping work still needs your instruction. These steps apply on desktop and
compact screens.
When OpenCode's shared service fails, other affected conversations can also stop.
Inspect their status and existing work before selecting **Send** again; recovery
does not automatically repeat their requests. An ordinary conversation close
keeps the shared service available to its other conversations. Colleague and
project chat share this service: closing either one leaves the other available.
If recovery has to stop the shared service, inspect both chats before retrying.
A failed OpenCode **Stop** leaves the current turn available for another **Stop**
attempt. After Stop succeeds, **Send** starts the next turn in the same conversation.
The same Stop and retry rules apply to temporary chats.
A temporary message may appear before the assistant confirms receiving it.
If it still shows **Check delivery**, use that control and keep the same request;
its visible bubble alone is not confirmation. An unavailable receipt stays
unconfirmed and keeps its files and any newer composer draft. Checking does not
submit another native turn. Colleague can explain the reported state; a new
request still needs your instruction.

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

If OpenCode reports that its installed version is unsupported, ask the workspace
operator to repair the runtime before retrying. Repeating the message cannot
change the installed version. Colleague can explain that startup error; repairing
the host installation requires the operator. This applies on desktop and mobile.

If OpenCode produces reasoning without a final answer, it makes one automatic
attempt to obtain that answer. Wait for the result before sending again. If it
still reports that no final response was produced, inspect the existing work
before retrying; the original request and its reasoning remain in the chat.
Progress summaries describe the work in progress; they do not mean the final
answer is ready. They remain attached to the same conversation after reconnecting.

An existing goal keeps its own assistant connection. Its status, **Pause goal**
and **Cancel goal** do not move to another engine when Main's chat selection changes.
Goal status updates as the assistant reports changes and when the chat reconnects
or regains focus. Claude also refreshes goal status when its reply completes.
If a goal command shows **Check delivery**, use it before retrying;
reconnecting does not resend the command. These controls work the same on desktop
and mobile.

OpenCode does not provide native goal controls. Its chat and live updates remain
available without a goal; choose a goal-capable assistant when you need to create
one.

For a Claude goal, **Pause goal** stops the current work and keeps the goal.
**Resume goal** continues it in the same conversation. **Cancel goal** stops the
work and clears the goal. If the goal changed while you were looking at it,
refresh its status before trying the action again. If a model change or context
renewal asks you to deliver the conversation briefing first, send an ordinary
chat message before starting or resuming the goal.
**Stop** remains available while Claude is waiting to acknowledge a goal command.

For a Codex goal, **Pause goal** prevents further automatic turns and lets current
work continue. **Cancel goal** clears an unfinished goal without interrupting the
current turn; use **Stop** to stop that work. If cancellation fails, the goal stays
available for retry. Refresh a goal that changed before using its controls again.
If its status is unavailable, wait for the assistant connection and refresh.
An unavailable status does not mean the goal was cleared.
Open **Goal** to find these controls. For a long objective, use **View full goal**
to read it, then **Close** to return to the controls. This works on desktop and mobile.

If Codex reports that it could not load its model catalogue, ask the workspace
operator to check the Codex installation and connection, then restart the
assistant service. Colleague can explain the error but cannot perform that host
operation. This recovery is the same on desktop and mobile.

## Answer assistant questions

When a completed reply contains numbered questions, Main chat can show one field
per question. Fill every field, choosing an offered answer or **I am not sure**
where available. Add optional context in the composer, then select **Send**.
Your answers become one ordinary chat message. Selecting a suggested-answer chip
also waits for **Send**; it does not send by itself.

Use **Answer normally instead** to hide the numbered fields and keep your draft.
The form hides when you submit, so you can type a new thought while delivery is
pending. If delivery needs attention, use the existing retry or delivery-check
control; the earlier reply keeps its captured answers. A different question
starts with empty fields.

On compact screens, reveal chat to see the fields above its composer. The same
answer and Send steps apply on desktop. These fields do not answer a native
terminal permission prompt. Colleague can explain the choices or send an answer
you explicitly authorize; decisions that require your interaction remain yours.

## Attachments and saved history

Add files through the composer before selecting **Send** or **Steer**. Images
use the selected agent's image input; other files remain available to its file
tools. Changing a native binding does not grant access to another conversation's
files. Keep the same request when checking uncertain delivery.

Archived native history is preserved before cleanup. Cleanup uses the saved
conversation's agent and storage location; switching the current chat's agent does
not change that target. Busy conversations, a changed native storage directory,
incomplete exports or interrupted preservation prevent
deletion. Let active work finish;
ask the workspace operator to retry native-history cleanup after resolving the
reported error. These rules apply on desktop and mobile. Colleague can explain
the error; host storage repair and cleanup require the operator.

## History needs an upgrade

If opening a chat reports that it needs the offline state upgrade, ask the
workspace operator to complete the application update before using **Send**.
Closing the tab or repeating a message cannot perform this upgrade. The operator
must stop the services and run the candidate release's state-upgrade command;
Colleague can explain the error but cannot perform that host operation. The same
recovery applies on desktop and mobile. Existing replies, attachments, attribution
and undone-turn receipts are retained; the upgrade does not resend messages.

## Ask Colleague to coordinate

For example: “Get the agent to implement password reset. Discuss its plan, let
it finish, arrange a review, and bring it back ready for my testing. You have eight
turns.” Colleague retains the original criteria, exact session and turn allowance.
It sends through the normal coding-agent operations, waits through code-driven
watches, and creates a reviewer in the same session after implementation settles.
The person does not have to choose Senior or Junior unless they have a preference.

Colleague can ask routine questions and request corrections within that assignment.
Consequential product decisions, expanded scope and extra turns need the person.
“Ready for testing” requires evidence against the original criteria and a review;
two agents agreeing that they are done is not sufficient.

Independent assignments can span projects and sessions. Explicitly tell Colleague
which assignments may exchange relevant findings; that permission does not merge
their source, make permission transitive or enlarge their budgets. Cancellation
of follow-through does not itself stop the coding agent. Request that stop separately.

You can also ask it simply to watch a conversation and tell you when the agent
answers. Such a watch authorizes reporting only, not sending further work.
