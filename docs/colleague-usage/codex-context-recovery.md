# Continue a long Codex conversation after a model switch

Use this guide when an Auto handoff or a model change reports a context limit,
or the chat shows **Compacting conversation context…**.

That status means Codex is summarizing its working context. Wait for it to
finish; starting compaction does not mean the summary has completed. The time
varies with the model and request. A quick compaction is not itself a failure.
Use **Stop** if you want to interrupt the current work. Interrupted compaction
must not be described as a successful summary.

If the turn fails, read its error before sending another instruction. Saved
conversation history and existing file edits remain available. A context
rejection does not mean earlier commands in the turn were undone, and Vibe64
does not automatically replay the whole turn.

To return to the previous model, open the chat mode menu, choose **Custom**,
select **Codex** under **Orchestrator**, choose the previous **Model** and
**Thinking** setting, then **Apply**. Wait for current work to stop before
changing providers. Inspect the completed work and ask the model to continue
only what remains. The same controls apply on desktop and mobile; open the
mode menu beside the composer on either layout.

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

Verified against `Vibe64ChatModeControls.vue`, `Vibe64SessionAssistantMenu.vue`,
`Vibe64SessionRenewalDialog.vue`, and the session/terminal action contracts.
