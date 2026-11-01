import { defineFeature } from "@jskit-ai/kernel/server/features";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { registerLearningModeReader } from "@local/vibe64-core/server/learningMode";
import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";
import { registerPracticeRequestActor } from "@local/vibe64-core/server/projectRequestContext";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { createTrainingCodeSaveOwner } from "./codeSaveOwner.js";
import { createTrainingLearnerNotesActions } from "./learnerNotesActions.js";
import { aiReadyFact, createLearningFacts } from "./learningFacts.js";
import { localLearnerActor } from "./localLearnerActor.js";
import { registerTrainingRoutes } from "./registerRoutes.js";
import { createTrainingStepActions } from "./stepActions.js";
import { createTrainingActions } from "./trainingActions.js";
import { createTraining } from "./trainingRuntime.js";
import { createTrainingVisualResourceActions } from "./visualResourceActions.js";
import { registerTrainingVisualResourceRoutes } from "./visualResourceRoutes.js";

/** @typedef {import("@jskit-ai/kernel/server/types").FeatureSetupContext} FeatureSetupContext */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").TrainingService} TrainingService */
/** @typedef {import("./types.js").LearningFact} LearningFact */
/** @typedef {import("@local/vibe64-colleague/server/types").ColleagueService} ColleagueService */

// Each runtime's core slot registrations, released at its shutdown. A feature's outputs hold only its declared
// capabilities, so the releases are kept beside the training service they belong to.
const slotReleases = new WeakMap();

const Vibe64TrainingFeature = defineFeature({
  id: "vibe64.training",
  domain: "vibe64-training",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    logger: "runtime.logger",
    http: "runtime.http",
    project: "vibe64.project",
    sessions: "vibe64.sessions",
    terminals: "vibe64.terminals"
  },
  optional: {
    colleague: "vibe64.colleague",
    learningFacts: "vibe64.training.learning-facts",
    trainingHost: "vibe64.training.host",
    sourceEditor: "vibe64.source-editor"
  },
  provides: {
    training: "vibe64.training"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeLogger} capabilities.logger
   * @param {RuntimeHttp} capabilities.http
   * @param {ProjectService} capabilities.project
   * @param {SessionsService} capabilities.sessions
   * @param {TerminalsService} capabilities.terminals
   * @param {ColleagueService | null} capabilities.colleague releases a closed lesson's teacher thread
   * @param {ReadonlyArray<LearningFact> | null} capabilities.learningFacts a host's own fact readers
   * @param {TrainingService | null} capabilities.trainingHost
   * @param {SourceEditorService | null} capabilities.sourceEditor
   * @param {FeatureSetupContext} context
   */
  setup({
    env,
    events,
    logger,
    http,
    project,
    sessions,
    terminals,
    colleague,
    learningFacts,
    trainingHost,
    sourceEditor
  }, { actionCatalogue }) {
    registerTrainingRoutes(http);
    registerTrainingVisualResourceRoutes(http);
    // A host that composes its own training passes its fact readers to that composition.
    if (trainingHost) return { training: trainingHost };

    const projectContext = getStudioProjectContext();
    const training = createTraining({
      actionCatalogue,
      env,
      events,
      logger,
      project,
      projectContext,
      sessions,
      terminals,
      // The built-in fact readers, then any a host provides.
      facts: createLearningFacts([aiReadyFact({ terminals }), ...(learningFacts ?? [])]),
      // Without Colleague no teacher thread is running, so there is nothing to release.
      releaseLearnThread: colleague ? colleague.releaseLearnThread : doNothing
    });
    registerVibe64ActionContext(actionCatalogue, {
      env,
      logger,
      admissionScope: "learning-only",
      projectContext,
      resolveUser: ({ request }) => localLearnerActor(request),
      authorizeProject() {
        throw new Error("Learning authority cannot authorize a working project.");
      }
    });
    // The person of a local practice project request is this computer's user.
    const releasePracticeActor = registerPracticeRequestActor(({ request }) => localLearnerActor(request));
    // Learn mode: the local learner is this computer's user, whatever the request says.
    const releaseLearningMode = registerLearningModeReader(() => training.learners.readLearningMode({ actor: currentOsUser() }), {
      onReadFailure: error => logger.warn({ error: String(error?.message || error) }, "Learn mode could not be read; Develop applies.")
    });
    // The learner's ordinary Files editor saves in a practice project record
    // their code authorship in the learner's code ledger.
    // readable-check: allow setter-seam - cycle: vibe64.training requires vibe64.source-editor
    sourceEditor?.setFileSaveOwner(createTrainingCodeSaveOwner({ authorship: training.codeAuthorship }));
    slotReleases.set(training, [releasePracticeActor, releaseLearningMode]);
    return { training };
  },
  /**
   * @param {object} capabilities
   * @param {TrainingService} capabilities.training
   * @param {TrainingService | null} capabilities.trainingHost
   */
  actions({ training, trainingHost }) {
    // A host composes its own Training actions over its own training.
    if (trainingHost) return [];
    return Object.freeze([
      ...createTrainingActions({ operations: training.operations }),
      ...createTrainingStepActions({ stepOperations: training.stepOperations }),
      ...createTrainingLearnerNotesActions({ learnerNotes: training.learnerNotes }),
      ...createTrainingVisualResourceActions({ lessonVisuals: training.lessonVisuals })
    ]);
  },
  /**
   * @param {object} _capabilities
   * @param {{ outputs: { training: TrainingService } }} context
   */
  shutdown(_capabilities, { outputs }) {
    for (const release of slotReleases.get(outputs.training)) release();
  }
});

export { Vibe64TrainingFeature };
