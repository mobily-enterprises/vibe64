# Pause and resume a goal

This continues [Goals and model changes](coding-agent-goals.md) for Claude and Codex goals.

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
