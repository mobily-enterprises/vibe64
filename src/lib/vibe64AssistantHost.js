export const VIBE64_ASSISTANT_HOST_KEY = Symbol("vibe64.assistant.host");

// The selected session publishes its real conversation selection owner here.
// Colleague requests navigation through it; it never drives DOM controls.
export const VIBE64_COLLEAGUE_VIEW_KEY = Symbol("vibe64.colleague.view");

// An optional workspace conversation contributed by the composing host.
export const VIBE64_HOST_CONVERSATION_KEY = Symbol("vibe64.host.conversation");

// Optional reactive host identity for actor-specific AI response caches.
// null means signed out; standalone editors use their local identity.
export const VIBE64_ASSISTANT_VIEWER_KEY = Symbol("vibe64.assistant.viewer");
