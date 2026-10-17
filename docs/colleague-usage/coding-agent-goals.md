# Goals and model changes

In the standalone local editor, open a session, choose a connected assistant,
and use **Send message** and **Set goal** in the same chat. These controls use
the selected local project's access checks and do not require a hosted login.
After **Start goal** is accepted, the goal menu closes. A failed or uncertain
request leaves the menu and objective available for recovery; switching sessions
keeps the new session's draft independent.
Long objectives scroll inside the input instead of pushing **Start goal** out of
the panel. On short screens, scroll the goal panel to reach remaining controls.

After a goal completes, starting a goal with another selected assistant replaces
the old goal selection only when the new command is accepted. A status refresh
does not reactivate the completed goal.

After you change or reconnect an AI account in **AI Accounts**, an unfinished
goal keeps its model, role and conversation. Once the connection is ready, send
your next message or choose **Goal** → **Resume goal** using the current account.
A failed message that was never delivered can use **Retry**. You do not need to
cancel the goal. Access to its selected model is still required; an account change
during a pending delivery may require cancelling that request and sending it again.
These steps apply on desktop and mobile. Account sign-in and credential entry
remain your actions; Colleague can explain the recovery and offer supported help.

An unfinished goal stays with its current orchestrator. Open **Chat mode** while
it is running or paused and choose **Senior**, **Junior**, or **Custom**. A model
or direct-mode change within the same orchestrator applies to the next turn,
including automatic goal continuations. The current turn keeps its settings;
the goal keeps its objective, budget and progress. You do not need **Pause goal**,
**Cancel goal** or a reload to save settings.
Choosing another **Orchestrator** or **Auto** saves the preference for after the
goal finishes; it does not transfer or cancel the current goal. These steps apply
on desktop and mobile, including goals created by the assistant. Colleague can
explain or offer a supported change and needs your request before performing it.

When changing a Codex model provider during a goal, the current turn finishes
before the same conversation continues with the new provider. If that change
cannot be applied, the goal stays paused. Check the selected model and account,
save the selection again, then choose **Resume goal**. An operator can inspect
the settings failure log if the problem continues; Colleague can explain these
recovery steps.

Temporary-chat settings also remain editable while work is running or a goal is
paused. If goal status is temporarily unavailable, saving preferences does not
change that unobserved goal. Reconnect before resuming it.

Goal status updates as the assistant reports changes and when the chat reconnects.
Claude also refreshes goal status when its reply completes. Returning focus to
the browser alone does not request another goal read. Background status updates
keep known goal controls available. After the chat's native conversation changes,
**Loading goal…** appears until that conversation's goal is known; **Resume goal**
is not offered based on the previous conversation. A failed read shows
**Goal unavailable**. Wait for reconnection and use the offered retry control;
unavailable status does not mean the goal was cleared. A pending goal command
temporarily disables other goal commands and names that action; it does not mean
the coding turn has stopped.
If Claude fails while preparing a goal command, close the goal popup and choose
**Retry** on the failed command in the conversation. A confirmed failure before
delivery keeps the previous goal and permits that same command to be retried;
it does not leave a new goal waiting to resume after restart. If delivery is
uncertain, use the offered delivery check before resending. Reconnecting alone
does not resend the command. These controls work the same on desktop and mobile.

OpenCode does not provide native goal controls. Its chat and live updates remain
available without a goal; choose a goal-capable assistant when you need to create
one.

For a Claude goal, **Pause goal** stops the current work and keeps the goal.
If Claude's native checker reports that the goal is impossible, or ends a turn
after repeatedly preventing it from stopping, the goal shows **blocked**, with
the native explanation. The
unfinished objective remains available. A server restart does not automatically
resume that blocked goal. Resolve the reported prerequisite, then open **Goal**
and choose **Resume goal**; use **Cancel goal** to clear it instead. These controls
work on desktop and mobile. Colleague can explain the reason and recovery steps.
Claude in Main can also report a concrete external blocker through the structured
Block action. It retains a short reason and the objective, stops continuation,
and shows **Goal · blocked** without repeatedly asking Claude to continue.
Ordinary messages and reconnecting do not resume that goal. Supply the missing
input or resolve the prerequisite, then choose **Goal** → **Resume goal**.
Running background agents or checks are work in progress, not an external blocker.
This works directly after **Start goal** or **Resume goal**, without a separate
chat message. Goal commands retain the same current-access checks as ordinary
chat: the signed-in session when hosted, or the selected local editor project
when standalone. The model's structured action changes status; merely saying
“blocked” does not.

You can also ask Claude in Main chat to pause, including after a safe checkpoint.
You can send that request as a new message or steer it into the running turn.
After draining its work, Claude must invoke the application's structured Pause
action. That uses the same goal control and records stopped continuation intent;
a server restart must not resume it. An assistant reply saying “paused” alone is
not confirmation: check that the goal control shows **paused**. If it does not,
use **Pause goal**. Temporary chats, child agents and Colleague cannot invoke
Main's self-pause action; Colleague can explain these steps.
When Claude invokes Pause or Block itself, its successful action response is
delivered before its process is stopped. No further application actions are
accepted during that handoff. If Claude does not acknowledge the response within
30 seconds, its process is stopped and the acknowledgement timeout is reported;
the paused or blocked goal remains saved. **Pause goal** and **Stop** remain
available during that wait. Use **Resume goal** when you want work to continue.
You can choose **Set goal** and **Start goal** while Claude is working. The goal
uses the same conversation's steering path, and **Goal** shows it after Claude
acknowledges the command. You do not need to stop the current work first.
On Claude versions supporting targeted **Send now**, setting or resuming a goal
while work is active preserves its background agents and background tasks.
Foreground work may be interrupted so Claude can read the new instruction.
Older Claude versions retain their previous interruption behavior. **Stop** and
**Pause goal** still stop work; use those controls when cancellation is intended.
When a background task finishes, Claude stays working while it reads and handles
the result. Its goal controls remain available during that follow-up, including
a requested Pause after the worker's safe checkpoint. The worker finishing alone
does not mean the main assistant has finished. You can set the next goal after
the turn finishes as well as while it is working.
If the previous reply is still saving, the goal waits for that save before it is sent;
a failed save keeps the goal unsent and reports the storage error.
The goal dialog closes after the command succeeds. While acknowledgement is
pending, or if delivery fails or remains uncertain, it stays open with your
objective intact. Switching chats prevents a late reply from closing the new
chat's goal dialog.
If Claude rejects the goal condition before sending it, the attempt is failed,
not delivery-uncertain. Close the goal popover, choose **Cancel** beside that
failed attempt, then reopen **Goal** and enter the corrected objective. A word
such as `clear` is a command, not a goal condition. Cancelling this failed attempt
does not clear the previous goal or stop newer work. A genuinely uncertain send
still needs **Retry** to check its original delivery receipt first.
An existing unfinished goal must be cancelled before setting a different one.
**Resume goal** continues it in the same conversation. **Cancel goal** stops the
work and clears the goal, including a blocked goal that Claude has already
removed from its running process. After successful cancellation, **Set goal**
becomes available and reopening the chat does not restore the cancelled goal.
The native confirmation stays out of ordinary chat. Colleague can explain these
steps; use the same goal control on desktop and mobile.
If the goal changed while you were looking at it,
refresh its status before trying the action again. If a model change or context
renewal asks you to deliver the conversation briefing first, send an ordinary
chat message before starting or resuming the goal.
**Stop** remains available while Claude is waiting to acknowledge a goal command.
If Claude cannot confirm interruption, the error explains that the new instruction
was not sent. Reconnect and retry it after the previous process has stopped. An
unconfirmed process stop still requires recovery before a new attempt.
Use the goal control to inspect the objective and its current state. Delivered
Claude goal commands and native management confirmations stay out of ordinary
chat, including earlier generated **Goal set:** and **Goal cleared:** records
when you reopen it. New confirmations such as **No goal set** are also omitted;
command errors remain visible. Older confirmations whose command origin was not
saved may still appear until the operator applies the historical repair during
a stopped-service update. If the original native evidence is unavailable, those
older records stay visible; reporting the affected conversation is useful. Actual assistant work
and explanations remain visible.
Failed, pending or uncertain goal instructions keep their recovery controls and
show your objective without internal role instructions. Nothing is deleted from
native history, and quoted command examples remain readable.

For a Codex goal, **Pause goal** stops automatic scheduling and the current
conversation turn while preserving the goal. To use a different model sooner,
choose **Pause goal**, wait for the turn to stop, change the model in **Chat mode**,
then choose **Resume goal**. The same sequence works for Claude.
If interruption cannot be confirmed, resolve the reported stop failure before
resuming; a paused goal alone does not confirm that the current turn stopped.
**Cancel goal** clears an unfinished goal without interrupting the
current turn; use **Stop** to stop that work. If cancellation fails, the goal stays
available for retry. Refresh a goal that changed before using its controls again.
If its status is unavailable, wait for the assistant connection and refresh.
An unavailable status does not mean the goal was cleared.
Open **Goal** to find these controls. For a long objective, use **View full goal**
to read it, then **Close** to return to the controls. This works on desktop and mobile.

Claude and Codex use the same **Goal** control and status light. An active goal
has a red light; it blinks only while the conversation reports work in progress
and becomes steady between turns. Paused goals use a steady orange light.
The control shows native **Running time** when available. Claude currently supplies
only creation and status timestamps, so its timer is labelled **Elapsed since
goal started (including pauses)**; this is not measured active runtime. On narrow
panes, open **Goal** to see the timer. Pause, Resume and Cancel appear before long
objectives or blocker explanations, so recovery does not require scrolling
through the explanation.

Failed Main-chat messages offer **Retry** and **Cancel** on desktop and mobile.
**Retry** checks an uncertain attempt's original message ID first. If it was
already delivered, the failure controls disappear without another send.
**Cancel** removes an old local failed attempt immediately without stopping a
newer goal or deleting delivered conversation history. For a request still
owned by the current route, the bubble hides while cancellation is checked; it
returns if delivery remains unknown or cancellation fails. Colleague can explain
these controls; the person presses them in Main chat.

New goals pass exactly your objective to the native goal evaluator. Model and
role selection still use **Chat mode**; internal role instructions are not part
of the goal's completion condition. Starting a goal while Claude is busy keeps
its current process and instructions. An older goal retains its original native
condition when resumed; cancel it and set your intended plain objective again
if it was created with internal role instructions.

If Claude finishes its previous turn while **Set goal** or **Resume goal** is
preparing, Vibe64 retries that same goal command once only when the provider proves
it was not sent. No second click is needed for that race. A repeated failure or
uncertain delivery stays visible; check its receipt before trying again.

After Claude acknowledges **Set goal** or **Resume goal**, Vibe64 waits briefly
for the native goal record linked to that exact command before saving its restart
identity. It does not wait for the work to finish. If this record is still missing
after 30 seconds, the control reports that the command was accepted but its goal
attachment is pending. Check the original receipt; do not resend it blindly.

A Main-chat goal started or explicitly resumed after this release retains your
request to keep working across server restarts, including an unexpected server
exit. Vibe64 verifies the previous process has stopped, rechecks your current
project and AI access, then resumes the same native goal. In a hosted workspace,
that access check uses your current workspace account; recovery does
not need a browser tab or the original browser login cookie. If workspace preparation
is already starting, recovery waits up to one minute for that operation's lock;
it does not send a second goal command. A timeout stays visible on the goal control.
**Pause goal**,
**Cancel goal**, and **Stop** prevent that automatic continuation. A completed
or cleared goal is not restarted. Existing goals are not guessed from their
old paused status: choose **Resume goal** once to enroll the intended goal.

If the account changed, cleanup cannot be verified, or an interrupted goal
command has uncertain delivery, recovery stays stopped. Check the original
receipt and current account, then use **Resume goal**; an uncertain command is
never replaced with a blind send. After a crash, an accepted Claude command can
be recovered only when its saved native attachment identifies that exact command.
A different goal with the same text is insufficient; missing proof requires
explicit confirmation.
A copied development workspace never inherits permission to run its parent's
goals. Restart continuation applies to supported Main native goals; temporary
logical and scoped conversations do not expose native goal controls or receipts.
Colleague can explain these controls and offer the supported action, but needs
your request before changing a goal.


A paused Claude goal stays paused while you send ordinary messages in the same
chat, including after reloading or restarting the application. The objective
stays available in the goal control. Choose **Resume goal** to continue it;
**Cancel goal** removes it. If Claude cannot confirm that its checker has been
suspended, the next message is not sent and the error remains available for
recovery. Do not treat that error as a delivered message.
