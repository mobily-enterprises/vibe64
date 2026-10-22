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

A message that fails before it reaches the assistant shows its error at once
and is marked **failed**, not uncertain, for example when the assistant's memory
is too full. Fix the cause and choose **Retry**; nothing was sent.

The assistant is shown as working (the animated indicator and the **Assistant
working** dot on a temporary chat tab) only while its turn is actually
running. Sending, choosing a recipient, connecting and an unconfirmed delivery
have their own labels and never show the assistant as working. **Stop** stays
available while a request is being routed or sent.

Accepted messages appear in timestamp order with the conversation, even while
their saved history is loading. Pending, failed and uncertain messages retain
their queue position and recovery controls. Loading older history replaces the
matching local copy rather than showing the same message twice.

Colleague can explain these steps and offer supported message actions. Server
maintenance requires an operator; Colleague must not invent a receipt, clear
unknown delivery or claim a failed request was delivered.

## When a turn finishes while you send

Sending a new instruction while Claude works never interrupts it. Claude queues
the message, lets the running command finish (for example a long deploy or test
run), then reads your instruction before continuing. Background agents and
background tasks also continue. A short question such as "status?" therefore
gets its answer once the current command completes, not immediately. This also
applies to **Set goal** and **Resume goal** during active work. Use **Stop** when
you want to cancel the current work. These controls work on desktop and mobile.

If you send a steering message just as Claude or Codex finishes, the queue can
submit those same words and attachments as the next ordinary request. This happens
only when the server confirms the steer was rejected before admission. It retains
the same message identity and tries ordinary Send once. A timeout or uncertain
receipt is still checked rather than resent. If ordinary Send fails, **Retry**
keeps the request as Send instead of targeting the finished turn again.

This recovery applies to project chats and temporary conversations such as
**Fix it with AI**. A completed turn allows the one ordinary-send retry; stopped,
failed or unverified turns do not silently restart through this recovery.
