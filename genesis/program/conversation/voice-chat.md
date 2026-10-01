# Voice conversation bindings

Vibe64 connects Colleague and a project's Main agent to JSKIT's reusable voice
runtime while retaining its own identity, authorization and conversation history.

## Sources

- `packages/vibe64-voice/src/client/Vibe64VoiceHost.vue`
- `packages/vibe64-voice/src/client/Vibe64ProjectVoiceLauncher.vue`
- `packages/vibe64-voice/src/client/projectVoiceBinding.js`
- `packages/vibe64-voice/src/server/Vibe64VoiceProvider.js`
- `src/composables/useVibe64ConversationRuntime.js`
- `src/composables/useVibe64AgentSettings.js`
- `src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue`
- `packages/vibe64-colleague/src/client/Vibe64Colleague.vue`
- `src/App.vue`

## Public contract

An application root mounts one Vibe64VoiceHost. It consumes JSKIT's controller,
modal, audio lifecycle and speech proxy; it creates no parallel speech machinery.
The optional host preferences supply name/artwork and one-off talking/review
choices. Installed service voices are advertised to the modal and selected there.
The Main conversation's headset launcher sits immediately before Send in the
composer's delivery controls. It opens the same host for that project agent;
the session header has no voice launcher.

A project binding retains its actor/project/session runtime independently of the
mounted text view. Text and voice share readers, access, settings, Send/Steer and
canonical message receipts. A recording captures its destination and message ID;
navigation cannot redirect it. The binding projects user and assistant messages
and streamed answer text, excluding reasoning/tool events. Stable answer identity
prevents the saved replacement from being narrated twice. Available state becomes
false on access, account or archive changes; the voice controller releases it.
Voice retains no independent chat history and never changes the typed draft.
JSKIT's hands-free Pause finalizes the current utterance before muting, including
the microphone's buffered tail. It submits through this same binding, or retains
the words for review when configured. Resuming uses a fresh recording identity.

Colleague supplies its existing per-user state and authorized submission/cancel
operations, with the request's captured UI focus. The root controller serializes
target switches, finishes capture/playback cleanup and requires explicit disposition
of unfinished words. Reopening the same target reveals its existing session.
Minimizing or navigating does not switch targets. Stop speaking and Stop agent work
have separate owners. Page disposal/sign-out releases retained state.

The public server proxy uses VIBE64_VOICE_ENDPOINT and
VIBE64_VOICE_ACCESS_TOKEN_FILE; both stay server-side. A trusted browser origin
and fresh target authorization are required before opening the upstream speech
connection. Project routes resolve request context and require a successful exact
session inspection; Colleague uses its ordinary authenticated state action without
a project. An unavailable service fails voice without adding inference privileges.
JSKIT bounds frames, queues and connection recovery. The host owns speech-service
provisioning and credentials; Vibe64 does not download models on a browser request.
