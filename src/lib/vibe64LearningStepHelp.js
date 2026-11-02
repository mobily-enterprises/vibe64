import { nextTick, shallowRef } from "vue";
import { learningVocabulary } from "@local/vibe64-training/shared/learning-vocabulary";
import { VIBE64_LEARNING_STUCK_MESSAGE, VIBE64_LEARNING_TEACH_MESSAGE, showMeCommand, text } from "@/lib/vibe64LearningModel.js";

/** @typedef {import("./vibe64LearningModel.js").LearningState} LearningState */
/** @typedef {import("./vibe64LearningModel.js").LearningLayout} LearningLayout */
/** @typedef {import("./vibe64LearningModel.js").LearningColleagueView} LearningColleagueView */
/** @typedef {import("./vibe64LearningModel.js").LearningBrowserNavigation} LearningBrowserNavigation */
/** @typedef {import("./vibe64LearningModel.js").LearningGuideRunner} LearningGuideRunner */
/** @typedef {import("./vibe64LearningCurrentLesson.js").LearningCurrentLesson} LearningCurrentLesson */
/** @typedef {import("./vibe64LearningModes.js").LearningModes} LearningModes */

// How long a file or Database guide waits for the navigated project view to publish itself.
const PROJECT_VIEW_WAIT_MS = 5000;

/**
 * Help on the current lesson step: Show me and Do it for me act on the real
 * page; Teach me and I'm stuck ask this host's Colleague.
 * @param {object} dependencies
 * @param {LearningState} dependencies.state
 * @param {LearningCurrentLesson} dependencies.currentLesson
 * @param {LearningModes} dependencies.modes
 * @param {ReturnType<typeof import("./vibe64LessonPlayer.js").createLessonPlayer>} dependencies.player
 * @param {LearningLayout} dependencies.layout
 * @param {LearningColleagueView} dependencies.colleagueView
 * @param {LearningBrowserNavigation} dependencies.browserNavigation
 * @param {LearningGuideRunner} dependencies.runGuide
 * @param {() => number} dependencies.now
 */
function createLearningStepHelp({ state, currentLesson, modes, player, layout, colleagueView, browserNavigation, runGuide, now }) {
  const colleagueRequest = shallowRef(null);

  /**
   * Show me: minimise Courses, then point at (and, when declared, open) the
   * real place. A step with beats instead plays them in the step bar from the
   * first one, so the lesson stays in view.
   */
  async function showMe(stepId = currentLesson.currentStep.value?.id) {
    const step = currentLesson.steps.value.find(value => value.id === stepId);
    if (step?.beats?.length) {
      modes.minimise();
      player.start(stepId);
      return { beats: true };
    }
    if (!step?.guide) throw new Error("This step has nothing to show.");
    modes.minimise();
    return goTo(step.guide);
  }

  /**
   * Point at a place and, when the guide navigates, open it in the practice
   * project (Show me, and a do beat's Do it for me).
   */
  async function goTo(guide) {
    let command = showMeCommand(guide, { projectSlug: currentLesson.lesson.value?.practiceProjectSlug || "" });
    const navigator = browserNavigation.value || null;
    // A Database view belongs to one session: both hosts open it only with that
    // exact sessionId. Use the practice project's selected session, opening the
    // project first.
    if (navigator && command.databaseView) {
      if (!selectedSession(command.projectSlug)) {
        await navigator({ projectSlug: command.projectSlug });
        await waitForProjectView(command.projectSlug, selectedSession);
      }
      const sessionId = selectedSession(command.projectSlug);
      if (sessionId) command = { ...command, sessionId };
    }
    // A file guide opens its file through the view the navigation selected:
    // the view is read only after navigation and must belong to the target project.
    const navigateBrowser = navigator && command.guide.filePath
      ? async navigation => {
        const focus = await navigator(navigation);
        await waitForProjectView(command.projectSlug);
        return focus;
      }
      : navigator;
    const view = { openFile(path) {
      const handle = projectView(command.projectSlug);
      return handle ? handle.openFile(path) === true : false;
    } };
    return runGuide(command, { navigateBrowser, view });
  }

  function projectView(projectSlug) {
    const handle = colleagueView.value;
    return projectSlug && handle?.projectSlug === projectSlug && handle.ready !== false &&
      typeof handle.openFile === "function" ? handle : null;
  }

  function selectedSession(projectSlug) {
    const handle = colleagueView.value;
    return projectSlug && handle?.projectSlug === projectSlug && text(handle.sessionId) ? handle.sessionId : "";
  }

  async function waitForProjectView(projectSlug, published = projectView) {
    const deadline = now() + PROJECT_VIEW_WAIT_MS;
    while (!published(projectSlug) && now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  }

  /**
   * Teach me: ask this host's Colleague, which opens beside the step in the
   * Lesson pane and sends the fixed message (watchColleagueLearningRequests in
   * vibe64-colleague). The step stays visible.
   */
  function teachMe(stepId = currentLesson.currentStep.value?.id) {
    if (!state.attemptId || !stepId) throw new Error("Open a lesson step before asking Colleague to teach it.");
    currentLesson.selectStep(stepId);
    return askColleague("teach", { message: VIBE64_LEARNING_TEACH_MESSAGE, stepId });
  }

  /**
   * One request for this host's Colleague, about this learner's lesson step.
   */
  function askColleague(kind, { message, stepId }) {
    colleagueRequest.value = Object.freeze({ id: `${kind}-${now()}-${Math.random().toString(36).slice(2, 8)}`, kind,
      ...(message ? { message } : {}), actorKey: state.actorKey, attemptId: state.attemptId, stepId });
    return colleagueRequest.value;
  }

  /**
   * Do it for me on the bar's current do beat: what the learner would do
   * there, done through the page's own controls. Returns false when it could
   * not be done (the bar then says so; Next still moves on).
   */
  function doItForMeKind(beat = player.beat.value) {
    if (beat?.kind !== "do") return "";
    if (beat.target === "send-message") return "send";
    if (beat.target === "file-opened") return beat.path ? "navigate" : "";
    // Waiting for the agent, the App's button, closing Colleague and L stay the learner's.
    if (["agent-finished", "app-pressed", "colleague-minimised"].includes(beat.target)) return "";
    if (beat.target === "learning") return "point";
    if (["chat", "courses", "colleague", "lesson", "reload-preview"].includes(beat.target)) return beat.target;
    const open = learningVocabulary.place(beat.target)?.open;
    return open?.pane || open?.route ? "navigate" : "point";
  }

  async function doItForMe() {
    const beat = player.beat.value;
    const kind = doItForMeKind(beat);
    const projectSlug = currentLesson.lesson.value?.practiceProjectSlug || "";
    if (kind === "send") {
      const view = colleagueView.value;
      if (!projectSlug || view?.projectSlug !== projectSlug || typeof view.sendLessonMessage !== "function") return false;
      return await view.sendLessonMessage(beat.prompt) === true;
    }
    if (kind === "navigate") return goTo({ target: beat.target === "file-opened" ? "files" : beat.target, navigate: true,
      ...(beat.path ? { filePath: beat.path } : {}) });
    if (kind === "chat") {
      layout.value?.showChat?.();
      await nextTick();
      globalThis.document?.querySelector?.('[data-vibe64-guide="chat"] textarea')?.focus();
      return true;
    }
    if (kind === "courses") return modes.show();
    if (kind === "lesson") return modes.openLesson({ stepId: currentLesson.currentStep.value?.id });
    if (kind === "colleague") {
      askColleague("open", { stepId: currentLesson.currentStep.value?.id || "" });
      return true;
    }
    if (kind === "reload-preview") {
      // The Preview's own Reload button, after opening the Preview.
      await goTo({ target: "preview", navigate: true });
      await nextTick();
      const reload = globalThis.document?.querySelector?.('[data-vibe64-guide="reload-preview"]');
      if (!reload) return false;
      reload.click();
      return true;
    }
    if (kind === "point") return player.point();
    return false;
  }

  /**
   * I'm stuck: the same Colleague request as Teach me, with the stuck message;
   * Colleague reads the learner's work on the step and helps without passing it.
   */
  function stuck(stepId = currentLesson.currentStep.value?.id) {
    if (!state.attemptId || !stepId) throw new Error("Open a lesson step before asking Colleague for help.");
    return askColleague("stuck", { message: VIBE64_LEARNING_STUCK_MESSAGE, stepId });
  }

  function consumeColleagueRequest(id) {
    if (colleagueRequest.value?.id !== id) return null;
    const value = colleagueRequest.value;
    colleagueRequest.value = null;
    return value;
  }

  /**
   * Another signed-in viewer: no Colleague request of the previous one.
   */
  function reset() {
    colleagueRequest.value = null;
  }

  return Object.freeze({
    colleagueRequest,
    showMe,
    teachMe,
    stuck,
    doItForMe,
    doItForMeKind,
    consumeColleagueRequest,
    reset
  });
}

export { createLearningStepHelp };
