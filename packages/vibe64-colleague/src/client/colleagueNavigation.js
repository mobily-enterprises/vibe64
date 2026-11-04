import { unref } from "vue";
import { runTrainingGuideCommand } from "@local/vibe64-training/client/guide";
import { applyLearningNavigation } from "../shared/learningFocus.js";

/**
 * A host's browser navigator: it shows the command's place and resolves with the browser's focus.
 * @typedef {(command: object) => Promise<object>} ColleagueNavigator
 */

/**
 * Both hosts' navigators run through this wrapper: opening an app place shows
 * the app (Courses closes with its state kept), and a guide rings the real
 * control after any "show me" navigation, reporting only what it drew.
 * @param {object} command
 * @param {object} context
 * @param {import("/src/types.js").Vibe64Learning} context.learning
 * @param {import("/src/lib/vibe64AssistantHost.js").ShellSlot<any>} context.companionView
 * @param {ColleagueNavigator} context.navigate
 */
async function navigateColleagueBrowser(command, { learning, companionView, navigate }) {
  const appPlace = command.projectSlug || command.route || (command.guide && command.guide.target !== "learning");
  if (appPlace && !command.learning && unref(learning.coursesOpen)) {
    await applyLearningNavigation(learning, { open: false });
  }
  if (!command.guide) return navigate(command);
  return runTrainingGuideCommand(command, { navigateBrowser: navigate, view: { openFile(path) {
    const view = companionView.value;
    return view?.projectSlug === command.projectSlug && view.sessionId === command.sessionId && view.openFile(path) === true;
  } } });
}

/**
 * Runs one pending navigation command in this browser and acknowledges it,
 * caching the receipt so a failed acknowledgement retries without navigating
 * again. beforeNavigate applies the compact-screen policy first.
 * @param {object} options
 * @param {() => { mounted: boolean, actorKey: string, clientId: string }} options.scope
 * @param {ColleagueNavigator} options.navigate
 * @param {(command: object) => Promise<unknown> | void} options.beforeNavigate
 * @param {(receipt: object) => Promise<unknown>} options.acknowledge
 * @param {import("vue").Ref<string>} options.error
 */
function createColleagueNavigation({
  scope,
  navigate,
  beforeNavigate,
  acknowledge,
  error
}) {
  let navigating = null;
  let navigationReceipt = null;

  async function handle(command) {
    if (navigating || command?.status !== "pending") return;
    navigating = command.id;
    const expectedActor = scope().actorKey;
    try {
      const before = beforeNavigate(command);
      if (before) await before;
      if (navigationReceipt?.commandId !== command.id) {
        let receipt;
        try {
          const result = await navigate(command);
          receipt = { commandId: command.id, clientId: scope().clientId, ok: true,
            ...(command.guide ? { ...(result.focus ? { focus: result.focus } : {}), guide: result.guide } : { focus: result }) };
        }
        catch (failure) { receipt = { commandId: command.id, clientId: scope().clientId, ok: false, error: failure.message }; }
        if (!scope().mounted || expectedActor !== scope().actorKey) return;
        navigationReceipt = receipt;
      }
      if (!scope().mounted || expectedActor !== scope().actorKey) return;
      await acknowledge(navigationReceipt);
    } catch (cause) { if (scope().mounted && expectedActor === scope().actorKey) error.value = cause.message; }
    finally { if (expectedActor === scope().actorKey) navigating = null; }
  }

  function reset() { navigationReceipt = null; navigating = null; }
  return Object.freeze({
    handle,
    reset
  });
}

export { createColleagueNavigation, navigateColleagueBrowser };
