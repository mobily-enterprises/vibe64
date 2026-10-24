# Goals and model changes

Claude cannot create a goal through its application tools. When you ask it to
create one, it explains the UI steps and can draft the objective for you:
choose **Set goal**, enter the objective, then choose **Start goal**.
For an existing unfinished goal, use **Resume goal** to continue it or
**Cancel goal** before setting a different one. These steps apply on desktop
and mobile; an objective written in chat alone does not create a goal.

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

Open **Chat mode** while a goal is running or paused and choose **Senior**,
**Junior**, or **Custom**. A model or direct-mode change within the same tool
applies to the next turn, including automatic goal continuations. The current
turn keeps its settings; the goal keeps its objective, budget and progress. You
do not need **Pause goal**, **Cancel goal** or a reload to save settings.
Choosing **Auto** or a Custom model in another tool in **Chat mode** applies after
the goal finishes.

When the workspace owner saves a different tool or model for **Senior** or
**Junior** in **AI setup** (or **Model setups**), an unfinished goal started on
the previous main AI is cancelled the next time it would continue, as **Cancel
goal** would: when its current turn ends, when you choose **Resume goal**, or
after a server restart. This includes goals in projects that were not open when
the setup changed. The chat shows **Goal cancelled because the main AI changed in
AI setup**; the conversation, files and work done so far are kept. To continue,
choose **Goal** → **Set goal** again; it runs on the new main AI. A goal on a
**Custom** model is not cancelled, and neither a thinking-level-only change, a
Router or helper change, nor the first AI setup cancels goals. If the goal cannot
be cancelled (for example its AI is unreachable), the failure is recorded in the
operational log; choose **Goal** → **Cancel goal**. These steps apply on desktop
and mobile. Colleague can explain this and change the AI setup on your request;
it warns first that unfinished goals will be cancelled.

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
does not resend the command. When the delivery check confirms the goal command
was accepted, its old error disappears without starting another goal. These
controls work the same on desktop and mobile.

OpenCode does not provide native goal controls. Its chat and live updates remain
available without a goal; choose a goal-capable assistant when you need to create
one.

To pause, resume or clear a Claude or Codex goal, see [Pause and resume a goal](coding-agent-goal-pause.md).

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
Colleague can read a session's current goal (its objective and whether it is
active, paused, blocked or complete) and explain these controls. It cannot set,
pause, resume or cancel a goal itself: it tells you which **Goal** control to
use and can draft an objective for **Set goal**.

A paused Claude goal stays paused while you send ordinary messages in the same
chat, including after reloading or restarting the application. The objective
stays available in the goal control. Choose **Resume goal** to continue it;
**Cancel goal** removes it. If Claude cannot confirm that its checker has been
suspended, the next message is not sent and the error remains available for
recovery. Do not treat that error as a delivered message.
