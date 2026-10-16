# Recovering an unconfirmed message

When a message says **Delivery is uncertain**, choose **Retry** to check its
original receipt. Do not copy and send the same message again: it may already
have reached the assistant. Keep the original text and attachments while its
receipt is checked.

A historical Claude pre-write rejection can leave that receipt uncertain even
though the native send was refused. An operator can apply the numbered stopped
workspace repair after proving the original rejection and checking native history.
The repair sends nothing and preserves the conversation. Once it is applied,
the failed message's **Retry** action can submit the retained request normally.
The same controls apply on desktop and mobile.
When **Retry** starts another attempt, its bubble immediately shows **Pending**
and hides the previous failure controls while it is sending. If that attempt
fails or its receipt becomes uncertain, the corresponding recovery controls
return with its current delivery state.

Colleague can explain these steps and offer supported message actions. Server
maintenance requires an operator; Colleague must not invent a receipt, clear
unknown delivery or claim a failed request was delivered.

## When a turn finishes while you send

If you send a steering message just as Claude or Codex finishes, the queue can
submit those same words and attachments as the next ordinary request. This happens
only when the server confirms the steer was rejected before admission. It retains
the same message identity and tries ordinary Send once. A timeout or uncertain
receipt is still checked rather than resent. If ordinary Send fails, **Retry**
keeps the request as Send instead of targeting the finished turn again.
