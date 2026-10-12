# Colleague upgrade recovery

After an application upgrade, an older Colleague history may require maintenance
before it can open. The workspace operator performs this maintenance; Colleague
cannot perform it through chat.

If the application reports that its state upgrade cannot finish, retain the error
and ask the workspace operator to inspect the original conversation and operation
receipts. Do not delete the conversation, start fresh, or resend the old request
to bypass the upgrade error.

The operator uses the candidate release's upgrade command with the service and
all other writers stopped. A stale completed operation marker may require the
explicit receipt repair before the ordinary upgrade can finish. That repair
preserves the complete operation receipt and the conversation history. Native
continuity checks still run afterward: the completed marker alone does not prove
a native request completed. Unfinished or uncertain work still blocks activation.

After successful maintenance and activation, reopen Colleague through its usual
control. Written messages remain available, and the old request is not repeated.
If the error persists, provide its exact text to the operator; do not retry the
old action to manufacture a completion receipt.

The same recovery applies on desktop and mobile. Colleague can explain the error
and guide you to the available application controls, but this maintenance requires
the operator's interaction and cannot be executed through Colleague actions.

An older interactive chat may also use a native input format from before the
application recorded its autonomous flag. The operator can apply the separate
qualified historical correction after checking the exact original native input,
completed answer and account/scope custody. It preserves the chat and its native
identity. A missing flag by itself is not permission to resume or resend anything;
unsupported or uncertain native evidence still prevents activation.

Current chat formats continue through their original migration; the historical
correction leaves them unchanged. A continuity error still requires the operator
to inspect its exact evidence before activation.
