import { createTrainingDeclaredCheckOwner } from "./declaredCheck.js";
import { createTrainingCodeAuthorship } from "./codeAuthorship.js";
import { createTrainingStepChecks } from "./stepChecks.js";
import { createTrainingStepEvidence } from "./stepEvidence.js";
import { createTrainingStepReviewer } from "./stepReview.js";
import { createTrainingCodeSaveOwner } from "./codeEditorActions.js";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { isLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { registerPracticeRequestActor } from "@local/vibe64-core/server/projectRequestContext";
import { registerLearningModeReader } from "@local/vibe64-core/server/learningMode";
import { createTrainingActions } from "./trainingActions.js";
import { createTrainingStepActions } from "./stepActions.js";
import { createTrainingLearnerNotesActions } from "./learnerNotesActions.js";
import { createTrainingLearnerChangedPublisher } from "./learnerEvents.js";
import { createInstalledTrainingCatalogue } from "./installedCatalogue.js";
import { createTrainingCourseInstaller } from "./courseInstaller.js";
import { createInstalledTrainingContent } from "./installedContent.js";
import { createTrainingLearnerState } from "./learnerState.js";
import { createTrainingService } from "./preparation.js";
import { createManagedProjectRepositoryService } from "@local/vibe64-project/server/managedRepository";
import { createProjectArchiveService } from "@local/vibe64-project/server/project-archive";
import { createTrainingLearningSpace } from "./learningSpace.js";
import { registerTrainingRoutes } from "./registerRoutes.js";
import { createTrainingVisualResourceActions } from "./visualResourceActions.js";
import { registerTrainingVisualResourceRoutes } from "./visualResourceRoutes.js";
import { aiReadyFact, registerLearningFact } from "./learningFacts.js";

/** @typedef {import("./types.js").InstalledTrainingCatalogue} InstalledTrainingCatalogue */
/** @typedef {ReturnType<typeof import("./courseInstaller.js").createTrainingCourseInstaller>} TrainingCourseInstaller */
/** @typedef {import("./types.js").InstalledTrainingContent} InstalledTrainingContent */
/** @typedef {import("./types.js").TrainingLearnerState} TrainingLearnerState */
/** @typedef {ReturnType<typeof import("./preparation.js").createTrainingService>} TrainingExercises */
/** @typedef {import("./types.js").TrainingDeclaredCheckOwner} TrainingDeclaredCheckOwner */
/** @typedef {import("./types.js").TrainingCodeAuthorship} TrainingCodeAuthorship */
/** @typedef {ReturnType<typeof import("./stepChecks.js").createTrainingStepChecks>} TrainingStepChecks */
/** @typedef {import("./types.js").TrainingLearningSpace} TrainingLearningSpace */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").TrainingService} TrainingService */

/**
 * The training capability: the learning owners, and the learner-changed
 * publisher.
 * @param {object} dependencies
 * @param {InstalledTrainingCatalogue} dependencies.catalogue
 * @param {TrainingCourseInstaller} dependencies.courseInstaller
 * @param {InstalledTrainingContent} dependencies.content
 * @param {TrainingLearnerState} dependencies.learners
 * @param {TrainingExercises} dependencies.exercises
 * @param {TrainingDeclaredCheckOwner} dependencies.checks
 * @param {TrainingCodeAuthorship} dependencies.codeAuthorship
 * @param {TrainingStepChecks} dependencies.steps
 * @param {TrainingLearningSpace} dependencies.learningSpace
 * @param {RuntimeEvents | null} [dependencies.events]
 */
function createTraining({
  catalogue,
  courseInstaller,
  content,
  learners,
  exercises,
  checks,
  codeAuthorship,
  steps,
  learningSpace,
  events
}) {
  return Object.freeze({
    catalogue,
    courseInstaller,
    content,
    learners,
    exercises,
    checks,
    codeAuthorship,
    steps,
    learningSpace,
    publishLearnerChanged: createTrainingLearnerChangedPublisher(events)
  });
}

const Vibe64TrainingProvider = defineFeature({
  id: "vibe64.training",
  domain: "vibe64-training",
  requires: {
    env: "runtime.env",
    logger: "runtime.logger",
    http: "runtime.http",
    project: "vibe64.project",
    sessions: "vibe64.sessions",
    terminals: "vibe64.terminals"
  },
  optional: {
    trainingHost: "vibe64.training.host",
    sourceEditor: "vibe64.source-editor",
    events: "runtime.events"
  },
  provides: { training: "vibe64.training" },
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeLogger} capabilities.logger
   * @param {RuntimeHttp} capabilities.http
   * @param {ProjectService} capabilities.project
   * @param {SessionsService} capabilities.sessions
   * @param {TerminalsService} capabilities.terminals
   * @param {TrainingService | null} capabilities.trainingHost
   * @param {SourceEditorService | null} capabilities.sourceEditor
   * @param {RuntimeEvents | null} capabilities.events
   * @param {{ actionCatalogue: ActionCatalogue }} context
   */
  setup({
    env,
    logger,
    http,
    project,
    sessions,
    terminals,
    trainingHost,
    sourceEditor,
    events
  }, { actionCatalogue }) {
    registerTrainingRoutes(http);
    registerTrainingVisualResourceRoutes(http);
    // Built-in fact readers, for every host (a host adds its own by composition).
    registerLearningFact(aiReadyFact({ terminals }));
    if (trainingHost) return { training: trainingHost };

    const projectContext = getStudioProjectContext();
    const systemRoot = projectContext.systemRoot;
    const catalogue = createInstalledTrainingCatalogue({ systemRoot });
    // The official catalogue repository is server configuration, never a request input.
    const courseInstaller = createTrainingCourseInstaller({
      systemRoot,
      catalogue,
      repository: env?.VIBE64_LEARNING_CATALOG_REPOSITORY
    });
    const content = createInstalledTrainingContent({ systemRoot });
    const learners = createTrainingLearnerState({ systemRoot, content });
    const projectRepositoryService = createManagedProjectRepositoryService({ projectContext, projectService: project });
    const codeAuthorship = createTrainingCodeAuthorship({
      learners,
      content,
      project
    });
    const checks = createTrainingDeclaredCheckOwner({
      learners,
      content,
      project,
      terminals
    });
    // Version 2 step results; the action layer supplies the action executor.
    const steps = createTrainingStepChecks({
      learners,
      content,
      checks,
      authorship: codeAuthorship,
      actions: actionCatalogue,
      evidence: createTrainingStepEvidence({
        project,
        actions: actionCatalogue
      }),
      reviewer: createTrainingStepReviewer({
        learners,
        terminals
      })
    });
    /**
     * A browser-supplied actor is never local authority. Retain the original
     * transport check without a host's signed-in-user alternative.
     */
    const localActor = request => {
      if (!request || !isLocalStudioRequest(Object.assign(Object.create(request), { vibe64User: null }))) return null;
      const actor = currentOsUser();
      return Number.isSafeInteger(actor.uid) && actor.uid >= 0 && actor.username ? { ...actor, role: "owner" } : null;
    };
    registerVibe64ActionContext(actionCatalogue, {
      env,
      logger,
      admissionScope: "learning-only",
      projectContext,
      resolveUser: ({ request }) => localActor(request),
      authorizeProject() {
        throw new Error("Learning authority cannot authorize a working project.");
      }
    });
    // The person of a local practice project request is this computer's user.
    registerPracticeRequestActor(({ request }) => localActor(request));
    // Learn mode: the local learner is this computer's user, whatever the request says.
    registerLearningModeReader(() => learners.readLearningMode({ actor: currentOsUser() }), {
      onReadFailure: error => logger.warn({ error: String(error?.message || error) }, "Learn mode could not be read; Develop applies.")
    });
    // The standalone project archive service; a host supplies its own through trainingHost.
    const projectArchive = createProjectArchiveService({
      projectContext,
      closeProjectRuntime: ({ slug, reason }) => project.runInProjectContext(slug, () => terminals.closeProjectRuntime({ reason }),
        { allowDeleting: true })
    });
    const learningSpace = createTrainingLearningSpace({
      learners,
      content,
      projectContext,
      projectArchive
    });
    const exercises = createTrainingService({
      catalogue,
      content,
      learners,
      learningSpace,
      projectContext,
      projectRepositoryService,
      project,
      sessions,
      terminals
    });
    // The learner's ordinary Files editor saves in a practice project record
    // code authorship through the original ledger owner.
    sourceEditor?.setFileSaveOwner(createTrainingCodeSaveOwner({ authorship: codeAuthorship }));
    return {
      training: createTraining({
        catalogue,
        courseInstaller,
        content,
        learners,
        exercises,
        checks,
        codeAuthorship,
        steps,
        learningSpace,
        events
      })
    };
  },
  actions({ training, trainingHost }) {
    if (trainingHost) return [];
    return [...createTrainingActions({
      catalogue: training.catalogue,
      learners: training.learners,
      content: training.content,
      exercises: training.exercises,
      courseInstaller: training.courseInstaller,
      learningSpace: training.learningSpace,
      publishLearnerChanged: training.publishLearnerChanged
    }),
    ...createTrainingStepActions({
      learners: training.learners,
      attemptLearners: training.learners,
      content: training.content,
      steps: training.steps,
      exercises: training.exercises,
      learningSpace: training.learningSpace,
      publishLearnerChanged: training.publishLearnerChanged
    }),
    ...createTrainingLearnerNotesActions({ learners: training.learners, publishLearnerChanged: training.publishLearnerChanged }),
    ...createTrainingVisualResourceActions({ learners: training.learners, content: training.content })];
  }
});

export { Vibe64TrainingProvider, createTraining };
