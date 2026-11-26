import { inject, onBeforeUnmount, onMounted, onScopeDispose, provide, reactive, toValue } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { createProblemReportErrorRecorder } from "@/lib/problemReportClientErrors.js";

// Report a problem on one page: the app's shell (StudioAppShellLayout) makes it once and holds its dialog
// (Vibe64ProblemReportHost.vue); what is inside the shell opens it: the account menu on every page, and the places that
// show a problem with a chat. A view that shows a session names it while it is shown (useProblemReportPlace), so a
// report from anywhere on the page describes that session and can include its chat. The shell records the errors the
// page sees from the moment it is mounted.

/**
 * @typedef {object} ProblemReportPlace
 * @property {string} sessionId
 * @property {{ kind: string, id: string } | null} chat
 */
/**
 * @typedef {object} ProblemReport
 * @property {boolean} available false outside the app's shell, where nothing opens it
 * @property {{ open: boolean, includeChat: boolean }} state
 * @property {() => object[]} errors the errors the page saw, oldest first
 * @property {() => ProblemReportPlace | null} place the newest place a shown view names that has a session
 * @property {(read: () => any) => () => void} name a shown view names its place until the returned function is called
 * @property {(options?: { includeChat?: boolean }) => void} open
 * @property {() => void} close
 */

const PROBLEM_REPORT = Symbol("vibe64.problem-report");

/** @type {ProblemReport} Report a problem outside the app's shell (a view rendered alone): nothing opens it. */
const NO_PROBLEM_REPORT = Object.freeze({
  available: false,
  state: Object.freeze({ open: false, includeChat: false }),
  errors: () => [],
  place: () => null,
  name: () => () => null,
  open: () => null,
  close: () => null
});

/**
 * Makes the page's Report a problem and gives it to everything inside the calling component.
 * @param {{ errorRuntime?: { subscribe: Function }, target?: () => EventTarget }} [sources] the page's error runtime,
 *   and its window, read once the shell is mounted
 * @returns {ProblemReport}
 */
function provideProblemReport({ errorRuntime = useShellWebErrorRuntime(), target = () => window } = {}) {
  const state = reactive({ open: false, includeChat: true });
  const places = [];
  const recorder = createProblemReportErrorRecorder();
  let stop = () => null;
  onMounted(() => {
    stop = recorder.listen({ errorRuntime, target: target() });
  });
  onBeforeUnmount(() => stop());

  function place() {
    for (let index = places.length - 1; index >= 0; index -= 1) {
      const named = places[index]();
      if (named?.sessionId) {
        return { sessionId: String(named.sessionId), chat: named.chat?.kind ? { kind: named.chat.kind, id: String(named.chat.id || "") } : null };
      }
    }
    return null;
  }

  function name(read) {
    places.push(read);
    return () => {
      const index = places.indexOf(read);
      if (index >= 0) places.splice(index, 1);
    };
  }

  function open({ includeChat = true } = {}) {
    state.includeChat = includeChat !== false;
    state.open = true;
  }

  function close() {
    state.open = false;
  }

  /** @type {ProblemReport} */
  const report = { available: true, state, errors: recorder.errors, place, name, open, close };
  provide(PROBLEM_REPORT, report);
  return report;
}

/**
 * The page's Report a problem: the shell's, or outside it one that nothing opens.
 * @returns {ProblemReport}
 */
function useProblemReport() {
  return inject(PROBLEM_REPORT, NO_PROBLEM_REPORT);
}

/**
 * Names the session (and its chat) this view shows, while the calling component is mounted.
 * @param {import("vue").MaybeRefOrGetter<{ sessionId?: string, chat?: { kind: string, id?: string } | null } | null>} place
 */
function useProblemReportPlace(place) {
  onScopeDispose(useProblemReport().name(() => toValue(place)));
}

export { NO_PROBLEM_REPORT, provideProblemReport, useProblemReport, useProblemReportPlace };
