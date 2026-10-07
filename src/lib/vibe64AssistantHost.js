export const VIBE64_ASSISTANT_HOST_KEY = Symbol("vibe64.assistant.host");

// The selected session publishes its real conversation selection owner here.
// Colleague requests navigation through it; it never drives DOM controls.
export const VIBE64_COLLEAGUE_VIEW_KEY = Symbol("vibe64.colleague.view");
export const VIBE64_COLLEAGUE_PREVIEW_KEY = Symbol("vibe64.colleague.preview");
export const VIBE64_COLLEAGUE_INTEGRATIONS_KEY = Symbol("vibe64.colleague.integrations");
export const VIBE64_COLLEAGUE_DATABASE_KEY = Symbol("vibe64.colleague.database");
export const VIBE64_COLLEAGUE_PLAN_KEY = Symbol("vibe64.colleague.plan");
export const VIBE64_COLLEAGUE_LAYOUT_KEY = Symbol("vibe64.colleague.layout");

// The host keeps Colleague alive while routed headers supply its mobile launcher location.
export const VIBE64_COLLEAGUE_LAUNCHER_KEY = Symbol("vibe64.colleague.launcher");

// An optional workspace conversation contributed by the composing host.
export const VIBE64_HOST_CONVERSATION_KEY = Symbol("vibe64.host.conversation");

// Optional reactive host identity for actor-specific AI response caches.
// null means signed out; standalone editors use their local identity.
export const VIBE64_ASSISTANT_VIEWER_KEY = Symbol("vibe64.assistant.viewer");

// Native application controls capture learner gestures in the current Colleague
// connection. Programmatic navigation and focus publication do not use this owner.
export const VIBE64_TRAINING_LEARNER_GESTURE_KEY = Symbol("vibe64.training.learner-gesture");
