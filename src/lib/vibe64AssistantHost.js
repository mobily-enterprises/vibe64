export const VIBE64_ASSISTANT_HOST_KEY = Symbol("vibe64.assistant.host");

// The selected session publishes its real conversation selection owner here.
// Colleague requests navigation through it; it never drives DOM controls.
export const VIBE64_COLLEAGUE_VIEW_KEY = Symbol("vibe64.colleague.view");
export const VIBE64_COLLEAGUE_PREVIEW_KEY = Symbol("vibe64.colleague.preview");
export const VIBE64_COLLEAGUE_INTEGRATIONS_KEY = Symbol("vibe64.colleague.integrations");
export const VIBE64_COLLEAGUE_DATABASE_KEY = Symbol("vibe64.colleague.database");
export const VIBE64_COLLEAGUE_PLAN_KEY = Symbol("vibe64.colleague.plan");
export const VIBE64_COLLEAGUE_LAYOUT_KEY = Symbol("vibe64.colleague.layout");

// The routed host publishes one acknowledged browser navigator for Colleague
// and the Learning environment.
export const VIBE64_BROWSER_NAVIGATION_KEY = Symbol("vibe64.browser.navigation");

// The host keeps Colleague alive while routed headers supply its mobile launcher location.
export const VIBE64_COLLEAGUE_LAUNCHER_KEY = Symbol("vibe64.colleague.launcher");
// The app bar's place for the selected session's AI task chip.
export const VIBE64_AI_TASK_TRAY_KEY = Symbol("vibe64.ai-task.tray");

// Optional reactive host identity for actor-specific AI response caches.
// null means signed out; standalone editors use their local identity.
export const VIBE64_ASSISTANT_VIEWER_KEY = Symbol("vibe64.assistant.viewer");
// The viewer of a standalone editor, which has no host identity.
export const LOCAL_ASSISTANT_VIEWER = Object.freeze({ actorKey: "local" });

/**
 * The checks the project page's mounted chats add, each true while its chat
 * holds a draft or a message sending, failed or unconfirmed. Idle cleanup
 * leaves the page in place while one is true.
 * @typedef {Set<() => boolean>} UnsentChats
 */
// The project page provides its UnsentChats here.
export const VIBE64_UNSENT_CHATS_KEY = Symbol("vibe64.unsent.chats");
/** A chat outside the project page adds its check here, where nothing reads it. @type {UnsentChats} */
export const NO_UNSENT_CHATS = new Set();

/** @typedef {{ actorKey: string }} AssistantViewer */
/** What a host provides as its viewer: the viewer itself, or a ref that is null while nobody is signed in. */
/** @typedef {import("vue").MaybeRef<AssistantViewer | null>} AssistantViewerSource */

/**
 * A template ref callback that keeps one element slot pointing at the element while it is mounted.
 * @param {import("vue").ShallowRef<HTMLElement | null>} slot
 * @returns {(element: HTMLElement | null) => void}
 */
export function elementSlotTarget(slot) {
  let currentElement = null;
  return element => {
    if (element) slot.value = element;
    else if (slot.value === currentElement) slot.value = null;
    currentElement = element;
  };
}

/**
 * One of the shell context's slots: the view that owns it writes its current state there while it is
 * selected, and Colleague, the lesson player and the host read it. Every host provides each slot.
 * @template T
 * @typedef {import("vue").ShallowRef<T | null>} ShellSlot
 */

// The shared Learning environment (L) controller (createVibe64Learning), provided
// by the assistant shell context of each host as the controller itself.
// Colleague reads coursesOpen, hiddenBy, mode, lessonAttemptId, lesson, stepId,
// results and colleagueRequest, and calls show(), minimise(),
// openLesson({ attemptId, stepId }) and consumeColleagueRequest(id). Every host
// provides it, so consumers inject it required.
export const VIBE64_LEARNING_KEY = Symbol("vibe64.learning");

// The page's focus as its host computes it (Colleague's focus shape), written
// by each host and read by the lesson step bar's beat player.
export const VIBE64_PAGE_FOCUS_KEY = Symbol("vibe64.page.focus");

// This tab's page activity (src/lib/vibe64PageActivity.js): what the person
// just did, for the lesson step bar's do beats.
export const VIBE64_PAGE_ACTIVITY_KEY = Symbol("vibe64.page.activity");
