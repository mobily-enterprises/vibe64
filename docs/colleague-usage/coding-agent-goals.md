# Goals and model changes

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
If a goal command shows **Retry**, use it before retrying;
reconnecting does not resend the command. These controls work the same on desktop
and mobile.

OpenCode does not provide native goal controls. Its chat and live updates remain
available without a goal; choose a goal-capable assistant when you need to create
one.

For a Claude goal, **Pause goal** stops the current work and keeps the goal.
You can choose **Set goal** and **Start goal** while Claude is working. The goal
uses the same conversation's steering path, and **Goal** shows it after Claude
acknowledges the command. You do not need to stop the current work first.
Internal task notifications do not keep a finished Claude turn artificially busy.
You can set the next goal after the turn finishes as well as while it is working.
The goal dialog closes after the command succeeds. While acknowledgement is
pending, or if delivery fails or remains uncertain, it stays open with your
objective intact. Switching chats prevents a late reply from closing the new
chat's goal dialog.
An existing unfinished goal must be cancelled before setting a different one.
**Resume goal** continues it in the same conversation. **Cancel goal** stops the
work and clears the goal. If the goal changed while you were looking at it,
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
when you reopen it. Actual assistant work and explanations remain visible.
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
