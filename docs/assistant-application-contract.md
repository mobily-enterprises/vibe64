# Assistant application contract

Vibe64 uses the published `@jskit-ai/assistant-core` package for conversation
presentation, transcript policy, Codex transport/event handling and detached-turn
watching, and OpenCode HTTP/SSE transport. The package has no Vibe64 dependency.
Its guide **Embeddable assistant conversations** specifies the generic contract;
its `examples/conversation` directory is a runnable independent consumer.

## Frontend ownership

| Surface | Shared element | Vibe64-owned adapter behavior |
| --- | --- | --- |
| Main chat | `Vibe64ConversationLog` embeds `AssistantConversationElement`; the composer uses shared input/actions. | Session selection, optimistic delivery/retry, attachments, source links, integration consent, model permissions, hints, Save and usage controls. |
| Temporary AI | `Vibe64EphemeralConversationMessages` maps flat messages into the same element. | Per-task retained drafts/uploads/settings, repair status/actions, stop/close and exact cleanup. |
| Database copilot | `Vibe64DatabaseWorkspace` supplies a conversation adapter directly. | Table context, SQL actions, owner access, request errors and server-owned configuration. |

The UI's adapter is `{ conversation, composer?, delivery?, actions }`. Conversation state
contains the ordered turn model and loading/pagination fields. Composer state
contains the draft and send/stop availability. Actions call the existing
application operations; the component does not own HTTP, permissions or storage.
Configuration is hidden for database copilot and supplied by its server. Main
and temporary chat retain their authorized Vibe64 settings controls in slots.

Main and temporary chat use JSKIT's `createAssistantMessageDelivery` to insert
submitted messages immediately and retain failed entries with Resend/Edit/Cancel.
The controller owns pending state and matching canonical receipts; Vibe64 owns
transport, admission, stable request IDs, repair context and conversation lifetime.
Main chat continues to settle from its authoritative realtime receipt. Temporary
chat overlays pending entries through `adapter.delivery` before saves, creation
or turn-start requests finish. Retries preserve the original request and newer
drafts/uploads. Only accepted attachments are cleared. Other JSKIT applications
can use the same controller and the element's default failure actions.

User-facing temporary chats use main chat's capabilities, tools, project access,
command runtime and write coordination in both providers. They have no separate
permission flags or modes. Closing them preserves project edits and removes only
their conversation and uploads; their messages never enter main History. Internal
helpers retain their bounded execution profiles. Update repair requests a
structured response independently of execution permissions.

The app-owned `Vibe64AutopilotPromptTextarea` retains attachment acquisition,
upload leases, preview capture, paste/drop handling and draft references. It
passes presentation and keyboard/resizing behavior to `AssistantPromptInput`.
The component's exposed attachment methods remain the application boundary.

## Host companions

A containing application can provide a `shallowRef(null)` under
`VIBE64_ASSISTANT_HOST_KEY`, exported by `src/lib/vibe64AssistantHost.js`.
The selected active, unarchived main chat publishes its layer there and removes
it when it loses ownership. Retained inactive sessions cannot publish it.

| Layer member | Meaning |
| --- | --- |
| `sessionId` | Current application conversation/session identity. |
| `turns`, `loading` | The same reactive history and loading state displayed by main chat. |
| `turnActive`, `submitting` | Native active-turn and composer-delivery state. |
| `toolsTarget` | Vue-owned DOM target for a companion control. |
| `conversationTarget` | Vue-owned conversation element for positioning. |
| `submitText(text, { sendImmediately, signal })` | Insert into the canonical draft and optionally send/steer. Returns `draft`, `send`, or `steer`; rejects on unavailable or changed ownership. |

An existing draft is preserved and appended to, and the combined draft stays
for review. The companion must abort its signal when selection, visibility or
ownership changes. This includes leaving and returning to the same retained
session. The shared submission helper rechecks the draft, identity and
availability before calling Vibe64's normal send action. DOM selectors and
synthetic input/button events are not part of the contract.

Live messages in `turns` carry `status: "inProgress"`; their containing turn is
pending. Final-answer speech and reply actions must wait for completion. JSKIT
merges live snapshots with saved history by message identity, so the final saved
reply replaces the partial text. Vibe64 owns admission, transport, reconnect reads
and persistence; JSKIT owns accumulation and transcript presentation.

## Backend and storage

`createConversationTranscript({ storage, clock })` owns duplicate message
admission, turn grouping, history pagination and replacement of the final answer.
Vibe64's session store adapts its existing filesystem into the package's
`read(scope, callback)` and `write(scope, callback)` contract. The callbacks use
ordered turn IDs, turn reads, duplicate lookup, message append and final-answer
replacement operations. Reads retain the session readability checks; writes
retain `mutateSession` and its process-safe session locks.

The app retains six-digit turn directories and timestamped Markdown message
files, attachment descriptors, actor metadata and integration decisions. There
is no migration, parallel durable transcript, or change to archive ownership.
The main history remains durable. Temporary provider conversations, uploads and
client history retain their existing transient lifecycle. Database copilot
history stays in the current database workspace.

Other applications can supply different storage without adopting the Vibe64
directory format. The package includes transient memory storage and reusable
storage contract checks. They must also test their own authentication,
transactions, failure/reopen behavior, retention and attachment cleanup.

Vibe64 owns provider processes, account/environment selection, tool and resource
permissions, stable application turn identity, execution-profile admission,
delivery reconciliation, cancellation, context preparation and Git checkpoints.
The reusable provider clients and watcher do not grant those capabilities.
OpenCode's attachment-directory permission option is explicitly enabled by the
Vibe64 process owner after the existing attachment admission resolves files.

Vibe64 publishes each completed Codex assistant item immediately, including
answers to steering questions during an active goal. It derives the message ID
from the native thread, turn and item IDs. Replay uses durable message-ID lookup;
a correction updates that item's original row. Distinct items remain separate
even when their text matches. Native history recovery and terminal-origin replies
use the same writer and realtime patch. The application retains the outer run,
goal and write ownership until execution actually settles. JSKIT renders the
published replies without inferring execution completion from them.

## Observation and delivery state

Vibe64 owns observation and cancellation for both Codex and OpenCode. The
published JSKIT Codex client reports unexpected disconnects through
`onDisconnect(error)`; it never treats a disconnected socket as native stop
proof. Vibe64 pauses/interrupts through the control channel or uses its existing
runtime owner and verifies the result. OpenCode's event iterator is observed
before prompt admission; unexpected EOF is a failure, not turn completion.
Persistence and event-handler failures use the same cancellation owner.

`turn.status === "observation_lost"` describes suspension. If `turn.active` is
still true, cancellation has not been verified: keep Stop available and prevent
new work. Once inactive, keep the draft editable and allow explicit Send. An
available paused Codex goal can be explicitly resumed with its unchanged native
identity. Background readiness checks never resume suspended work. A process
fallback can affect other sessions sharing that process. The provider controller
retains ownership when a stop cannot be proved.

The main native thread belongs to the controller before initial connection or
observer attachment. Shared-runtime cancellation includes providers that own
only temporary conversations. Stop confirmation must be saved before releasing
its owner or publishing an inactive state. If history recovery fails, keep the
stopped state and reject continuation until the read succeeds; recovery itself
must never resume native work.

The adapter changes send/stop availability independently of typing availability.
It must not remount or clear the composer on status changes. JSKIT updates from
reactive state; Vibe64 clears only the accepted portion of a submitted draft and
can settle a pending HTTP send/stop from its authoritative realtime receipt.

## Verification boundary

Focused tests cover storage/archives, provider transport and detached temporary
turns, shared rendering/scroll behavior, and companion ownership/cancellation.
Real provider accounts, speech devices and deployed-session workflows require
the corresponding runtime resources. Passing focused tests is not a claim that
every product flow has been exercised. Broad verification follows the repository's
explicit approval rule.
