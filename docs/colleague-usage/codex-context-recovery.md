# Continue a long Codex conversation after a model switch

Use this guide when an Auto handoff or a model change reports a context limit,
or the chat shows **Compacting conversation context…**.

That status means Codex is summarizing its working context. Wait for it to
finish; starting compaction does not mean the summary has completed. The time
varies with the model and request. A quick compaction is not itself a failure.
Current application instructions are restored automatically when context is
rebuilt; you do not need to paste them into the chat. If reconnecting reports
that a native terminal retained earlier assistant settings, close that terminal
and use **Resume**. Existing replies and files are preserved.
Use **Stop** if you want to interrupt the current work. Interrupted compaction
must not be described as a successful summary.

If the turn fails, read its error before sending another instruction. Saved
conversation history and existing file edits remain available. A context
rejection does not mean earlier commands in the turn were undone, and Vibe64
does not automatically replay the whole turn.

If observation is lost, wait for the reported stop to finish before using
**Send** or **Resume**. Reconnecting alone does not resend the interrupted
instruction or resume its goal. A failed stop remains visible until it can be
verified; inspect the session status before retrying.
After cleanup is confirmed, a connection check can reconnect an idle conversation
without sending another message. Continuing an interrupted goal still requires
explicit **Resume**.

Main chat and Colleague can share the same Codex service. If recovery has to stop
that service, other conversations using it may be interrupted too. Review each
affected conversation before continuing; recovery does not resend either request.

Conversation Undo is unavailable. Review earlier messages in History and send a
correction as a new message. Colleague can inspect the conversation and help with
that correction; it cannot remove the previous exchange.
If an unfinished Undo from a previous release blocks the conversation, contact
the workspace operator. The operation must be completed with the previous
release before upgrading. Colleague can explain the error, but cannot erase the
saved boundary or resume the removed operation.

To return to the previous model, open the chat mode menu, choose **Custom**,
select **Codex** under **Orchestrator**, choose the previous **Model** and
**Thinking** setting, then **Apply**. Wait for current work to stop before
changing providers. Inspect the completed work and ask the model to continue
only what remains. The same controls apply on desktop and mobile; open the
mode menu beside the composer on either layout.

Codex keeps its normal file-editing tools when switching between GPT, DeepSeek
and GLM. Choose the model through these controls; no extra instruction in each
message is needed to enable its tools or context window. Each provider still
requires its own connection in **AI Accounts**.

When supported, switching from a compacted GPT conversation to DeepSeek or GLM
recovers readable earlier messages automatically. You do not need to paste a
second copy. Saved native history stays intact; unsupported recovery produces
the error described below instead of silently omitting earlier work.

Switching from OpenCode or Claude to Codex prepares the new conversation for
model routing before opening it. Earlier replies keep their original AI labels;
check the current chat mode control for the assistant that will receive **Send**.
Changing the selection does not send a message.

If an already-created conversation reports that it is stored in a **separate
provider home**, retrying the message cannot repair its storage. Open **Session
actions → Renew session** and follow the reviewed handover flow. Save or discard
source changes first. Renewal keeps the old session until the handover reaches
the new conversation. Do not delete the guest or its account connections to fix
this error. Colleague can explain these steps and offer to prepare a renewal;
confirmation remains a separate operation after the handover is reviewed.

If renewal reports that its newly started thread cannot be read, retry the same
renewal after the connection recovers. The saved thread is reused; retrying does
not silently create another one. If the error reports multiple possible threads
or a mismatched identity, stop and contact the workspace operator. Colleague can
explain that error and inspect the session status, but cannot choose an unknown
thread or bypass the saved renewal identity. If the old thread is unreadable,
write or edit the handover manually in the renewal dialog before confirming.

OpenCode renewal also keeps the admitted handover and native conversation when
recovery needs **Retry**. Retry the same renewal; do not send another handover or
create another replacement. Cleanup stops any remaining progress-summary helper
before renewal continues. An unconfirmed helper deletion leaves the renewal
retryable and retains its cleanup record. A delivered handover whose structured
acknowledgement failed retains that delivery error; it is not reported as a valid
acknowledgement. Colleague can inspect and explain the saved renewal state and,
after your request, retry that same operation under its normal permissions.

If Codex reports that an expected editing tool is unavailable, stop the work
and review any edits already made before continuing. Report the model and the
error to the workspace operator, who can check the installed Codex version and
restart its assistant service. Restarting the service loads its current model
catalogue; opening another browser tab does not do that. Do not renew or delete
the conversation merely to fix missing tools. Colleague can help identify the
selected model and explain this recovery, but has no service-restart action.

After a GPT-to-Junior handoff, Codex retains readable messages from its helper
agents as historical context. OpenAI-only encrypted parts are explicitly marked
as unavailable to the selected provider; the saved originals remain intact.
If an error reports an unsupported saved item after an upgrade, report it to
the operator before renewing: an adapter update may let the same conversation
continue. Repeatedly sending the same prompt will not fix an unsupported item.

When the error says the saved history cannot be recovered safely, use the
previous model or **Renew session**. Review the renewal handover and its scope
before confirming; renewal is a separate action, not a retry of the failed turn.
A long lifetime transcript is not itself a reason to renew: recovery uses the
latest readable summary when one exists. Oversized effective requests or
unsupported history can still fail. No model switch guarantees unlimited context.

Colleague can offer to inspect the session status and saved conversation, read
the working plan, change the assistant selection, or help prepare a renewal
through its existing session actions. Perform changes only after the person's
request or acceptance, with the normal permissions and renewal confirmation.
Do not claim that compaction succeeded from its start status, replay uncertain
work, or inspect raw native files through shell access. The person can also
perform the model choice and renewal review in the visible controls above.

Verified against `Vibe64AutopilotView.vue`, `Vibe64ChatModeControls.vue`, `Vibe64SessionAssistantMenu.vue`,
`Vibe64SessionRenewalDialog.vue`, and the session/terminal action contracts.
