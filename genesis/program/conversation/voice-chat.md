# Voice conversation bindings

Vibe64 connects Colleague and a project's Main agent to JSKIT's reusable voice
runtime while retaining its own identity, authorization and conversation history.

## Sources

- `packages/vibe64-voice/src/client/Vibe64VoiceHost.vue`
- `packages/vibe64-voice/src/client/Vibe64ProjectVoiceLauncher.vue`
- `packages/vibe64-voice/src/client/projectVoiceBinding.js`
- `packages/vibe64-voice/src/server/Vibe64VoiceProvider.js`
- `src/composables/useVibe64ConversationRuntime.js`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64AgentSettings.js`
- `src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue`
- `packages/vibe64-colleague/src/client/Vibe64Colleague.vue`
- `src/App.vue`
- `packages/vibe64-training/src/client/useTrainingMainPresentation.js`

## Public contract

An application root mounts one Vibe64VoiceHost. It consumes JSKIT's controller,
modal, audio lifecycle and speech proxy; it creates no parallel speech machinery.
The optional host preferences supply artwork, a saved voice ID and an explicit
boolean readAloud choice; Main defaults true and generic/Colleague defaults false
when absent. A saved explicit boolean wins over the binding default. The binding
supplies its label. A host may replace the settings slot with its own authorized
preference control. Reactive voice changes reach subsequent replies through the
JSKIT binding without replacing the conversation.
Historical host talking/review preferences are not passed to the runtime.
Installed service voices are advertised to the modal and selected there.
The root emits read-aloud-change only for an explicit speaker preference change,
and forwards playback observations with their captured canonical conversation
and output IDs. It also forwards the binding's observers without retargeting
events to the current screen. Hydration and navigation emit no preference change.
Preference persistence belongs to the composing host. Each explicit speaker
callback includes its original target and the actor key captured when opened;
the binding's callback is also forwarded. Later actor changes cannot retarget
that observation, and remote hydration emits no write.
The same host's read-only readAloudFor and readAloudChangePendingFor operations
serve Main's idle speaker and opening defaults. A pending per-target resource save
fences only speaker preference changes before the local toggle; capture, text
admission and playback retain their original owners. The live wrapped binding
supplies this same pending fact to the shared speaker control.
Main opens that same host through the microphone or speaker beneath its face.
The composer and session header have no separate voice launcher.

A project binding retains its actor/project/session runtime independently of the
mounted text view. Text and voice share readers, access, settings, Send/Steer and
canonical message receipts. A recording captures its destination and message ID;
navigation cannot redirect it. The binding projects user and assistant messages
and streamed answer text, excluding reasoning/tool events. Stable answer identity
prevents the saved replacement from being narrated twice. Available state becomes
false on access, account or archive changes; the voice controller releases it.
Main additionally supplies an opt-in live narration contract: canonical turns,
the actual conversation-log loading fact, exact native active-turn fact, and
eligibility from the current mounted accessible view and document visibility.
Avatar collapse is presentation only. Its original optional thinking/interim
flags default false and its thinking-sound flag defaults true. The root overlays
only explicit coding-profile booleans through a live getter. JSKIT reuses the
original tracker, 700ms interim settle and 20s thinking timer in its existing
speech queue; the application adds no narrator, timer or audio owner. Bindings
without this opt-in retain their original Colleague answer behavior.
That opt-in also selects Main's original document-hidden boundary at the shared
voice owner. New hidden canonical outputs are consumed without replay; a visible
stream first finalized hidden gets its original interrupted output receipt.
Already queued completed audio may drain without capture. Tab hide retires
startup/current capture through the existing owner, retaining earlier pending
delivery and the typed draft; visible return alone cannot restart recording.
Document visibility is separate from avatar collapse and mounted-body eligibility.
Voice retains no independent chat history and never changes the typed draft.
Learning Main exposes its bounded delivered-question reference from the same
conversation snapshot. Typed answers capture the current reference through
original prepareMessage; a recording captures its reference at start through
the original project binding. Explicit absence stays local and omits the wire
field, so earlier speech cannot adopt a later question. Retry uses the original
saved request. Working requests keep their original data mapping. This carries
association only: native admission, fresh actor/pin checks and assessment stay
with the existing Main and Training owners.

JSKIT's hands-free Pause stops new microphone input immediately while retaining
the buffered tail for its original final flush. A matching stale endpoint rejection
releases only that rejected commit; pending admission retains its existing ordering
before finalizing the newer recording. It submits through this same binding. Explicit
avatar-hold recordings and interrupted submissions retain words for review.
Explicit resume keeps an unfinished continuous capture open. Once it finishes,
new capture gets its own recording identity.

Colleague supplies its existing per-user state and authorized submission/cancel
operations, with the request's captured UI focus. The root controller serializes
target switches, finishes capture/playback cleanup and requires explicit disposition
of unfinished words. Reopening the same target reveals its existing session.
Minimizing or navigating does not switch targets. Stop speaking and Stop agent work
have separate owners. Page disposal/sign-out releases retained state.

Colleague supplies a live adapter and retains its original setConversationTarget
facility for the root's target-switch presentation. Its binding now requests
inline presentation: the application owns a mounted right-hand 380px Vuetify
navigation drawer, whose native layout registration reserves workspace space
below the app bar without a scrim. On phones the existing fullscreen
ConversationDialog is the frame. The original single aside Teleport selects the
desktop or phone panel, while a root target-switch panel retains priority.
Minimize, reopen and responsive changes keep that body and its runtime mounted;
Close keeps the original explicit voice-end/discard operation. No Online layout
state or second voice controller is added: both frames share the host's v-app.
Its core transcript, custom composer, model picker, watches and assignments keep their original owners;
the extracted JSKIT VoiceConversationControls mounts once beside that composer
and teleports its buttons into the optional avatar overlay outside the toolbar. Startup, one-off admission/review and push-to-talk capture gate typed
Send, while the draft remains editable. Live hands-free leaves typed composition
and submission to the original conversation owner even while voice is pending,
sending or edited in its separate bubble. The original unsent-speech guard still
protects target switching. Main forwards the existing transcript observer into its
original shared temporary-message projection, so recognized words remain
visible while an earlier request awaits admission. Main enables deferWhileWorking
on the original shared conversation binding. Its steering predicate requires the
canonical steering capability as well as the original native turn and connection
checks. Busy nonsteerable Main requests retain their IDs, text and application data
through the shared delivery owner, which waits for canonical readiness and sends
followers in order. Main's application facade also exposes the original canSubmit
and queueWhileSending refs. Its existing typed composer uses those refs and the
same canonical steering predicate for admission and Send/Steer presentation,
retaining its native readiness, routing, attachment, access and repository gates.
Native Stop remains available for queued nonsteerable followers; native in-flight
steering retains its existing Stop exclusion. Failed or uncertain authored
requests retain their original intent. The combined path has no Talk/Text tabs.
Failed voice setup leaves the original typed body available. Main keeps its
original transcript, integration presentation and richer application composer,
adding the same host-supplied avatar through its existing core renderer. Its
voice controls remain beneath the face, outside its original composer. The root
exposes its existing artwork and settings slots as rendering facilities; it still owns the single
controller. Main's live presentation getter selects inline only while the exact
original view is mounted and visible. That view renders the same shared voice
host in flow; the root suppresses its duplicate dialog. When the view is absent,
the retained binding returns to the existing dialog/caption fallback.

The avatar overlay starts visible. Showing or hiding it changes only
presentation, never conversation identity, admission or microphone/speaker state.
There is no size menu: the collapsed top-right anonymous icon (**Show avatar**)
expands the face and is the collapsed row's only action. Passive Listening and
Speaking icons independently project the current session's actual unmuted
listening and audio-playing refs; they add no handlers or capture/playback state.
The fourth round control, a minus after the settings cog,
collapses it, with accessible label **Minimise avatar**; no separate text row.
The microphone, speaker, personal-settings cog and minimise form a compact row below
the face; their 32px circles have targets 40px wide and 44px tall, leaving 8px
between visible circles with no gap between targets. Hidden Show retains 44px.
Main and Colleague omit the manual chat reload control using their existing
presentation contract, retaining canonical subscription/reconnect behavior.
Text scrolls behind the face itself; the surrounding overlay is transparent. Voice
tools use the existing gesture owner. Status/error feedback uses its existing
control instance and a local composer target outside the overlay. Unsent speech
review stays in the original transcript bubble: the existing pencil opens the
original auto-growing review textarea there, and the existing ×/pencil row also
holds the pending review's Send. Automatic admission hides that manual Send using
the original voice fallback condition: reviewBeforeSend or not currently sending.
The typed composer remains unchanged.
Main's preview handler gates actions with its application facade's `available`
ref, which already includes current identity, archived-session and access policy.
That facade does not expose the shared runtime's raw `current` ref.

beginTranscriptEdit keeps the exact message ID and captured destination before
capture-only cancellation; its original pending-clear watcher resumes hands-free
when those words are resolved. Empty edits remain visible and cannot be sent.
An exact failed delivery is displayed in that same bubble with its original
status and error. Explicit Edit cancels only that known failed local delivery
through the original delivery owner before the next Send authors fresh text and
intent; plain Retry preserves the original payload. X cancels that failed local
entry only after identity-fenced voice discard succeeds. Uncertain, accepted or
sending entries cannot be cancelled by these actions. A matching canonical user
with receipt:false is unadmitted: it neither clears speech nor acknowledges a
speech invitation. Accepted readback remains the original acknowledgement owner.
The Public host directly projects the existing pending transcript and current
recording as at most two previewMessages, deduplicated by exact ID; the singular
previewMessage contract remains available. This is presentation, not a second
queue or transcript store. Core matches a descriptor to each existing failed or
synthetic preview row. The newer capture stays visible/discardable; its Edit is
disabled while the earlier transcript occupies the existing pending editor.
The original canTakeTranscript guard admits each exact identity. Editing retained
speech pauses a newer recording through the original mute owner, preserving its
words, ID, focus and endpoint. Transient editPausedCaptureId on that pending
record owns only this pause. Explicit microphone changes retire ownership; pending
clear/capture cancellation releases it only for the matching live recording.
The existing endpoint watcher then handles newer speech, without a new loop.
Playback, controller lifetime and canonical receipt reconciliation stay on their
original owners. Collapsing retains capture and playback; expand the face to use
the original voice controls.

## Combined-body ownership adaptation and original evidence

The original root controller and Colleague binding remain in Vibe64VoiceHost.vue
and Vibe64Colleague.vue. The application frame selects the desktop or phone
presentation target; the original shared host body slot is retained for target
switches. The aside, adapter and voice session are not rebuilt when it moves.
The root preserves live adapter/state/access getters; the binding's equality ID
is unchanged and its logical conversationId uses the original runtime identity.
Main's logical ID uses the existing mainConversationId operation, with no new
history, admission or composer implementation. Temporary, Database and System
Repair keep their original presentations and receive no voice launcher.

Original evidence is tests/server/vibe64ColleagueClient.unit.test.js (focus and
admission identity, model choice, delayed admission, provisional/live reply
reconciliation and launcher gestures), tests/client/useVibe64ConversationRuntime.vitest.js
(retained target, shared receipts, actor/access/archive fences and scoped cancel),
and tests/server/vibe64Voice.unit.test.js (authorization and native proxy order).
The hosted original colleagueVoiceBrowser.integration.test.js retains its
one-socket, draft, target-switch, review, minimized playback and cleanup guarantees
when its old mode navigation is adapted by the host.

The public server proxy uses VIBE64_VOICE_ENDPOINT and
VIBE64_VOICE_ACCESS_TOKEN_FILE; both stay server-side. A trusted browser origin
and fresh target authorization are required before opening the upstream speech
connection. Project routes resolve request context and require a successful exact
session inspection; Colleague uses its ordinary authenticated state action without
a project. The read-only `/api/vibe64/voice/voices` route uses that same state
authorization and JSKIT's authenticated service catalogue reader without opening
an audio connection. An unavailable service fails voice without adding inference privileges.
JSKIT bounds frames, queues and connection recovery. The host owns speech-service
provisioning and credentials; Vibe64 does not download models on a browser request.

JSKIT owns the caption scrolling: each whole card accepts wheel, touch and
keyboard scrolling. Automatic following pauses when the reader scrolls up;
returning to the bottom resumes it. Card height is bounded inside the fixed dialog.

The microphone remains available for hands-free restart during pending delivery.
JSKIT preserves the prior pending transcript and newer original recording owner;
busy Pause or hold release finalizes newer words after the previous admission.
The idle launcher's microphone icon reflects actual capture, rather than readiness.

### Candidate Learning Main presentation speech preparation

Only a Learning Main binding supplies prepareVoice. Before the existing controller
activates, retains or creates a new voice target, the same Vibe64VoiceHost callback
awaits that captured binding's authoritative original conversation snapshot. It
uses the original reader's reload only when no snapshot exists and refuses a
changed or unavailable target. Default bindings still return their original socket
URL directly. Availability is not used as a loading flag and the application adds
no voice queue, history cache, seen ledger or generic controller state.

The original controller already awaits connection preparation before releasing
its previous target. Actual deferred first-snapshot ordering, old microphone
ownership and silent initial-history priming must be proved in the original
mounted Main consumer/controller test. Late older-page history behavior remains
an open acceptance gate; this candidate does not infer deletion from page absence
or promise safe tombstone reset on a fresh attachment.

Learning Main cue ownership also projects the original optional-narration
eligibility flag for its unconfirmed or retired originating request. Raw turns,
loading and saved thinking/interim preferences remain unchanged; the existing
voice tracker consumes activity silently without resetting its identities.
Working and Colleague keep their original narration projection.
