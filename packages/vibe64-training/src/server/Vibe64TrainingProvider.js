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
import { createTrainingActions } from "./actions.js";
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

const Vibe64TrainingProvider = defineFeature({
  id: "vibe64.training", domain: "vibe64-training",
  requires: { env: "runtime.env", logger: "runtime.logger", http: "runtime.http", project: "vibe64.project", sessions: "vibe64.sessions", terminals: "vibe64.terminals" },
  optional: { trainingHost: "vibe64.training.host", sourceEditor: "vibe64.source-editor", events: "runtime.events" },
  provides: { training: "vibe64.training" },
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  setup({ env, logger, http, project, sessions, terminals, trainingHost, sourceEditor, events }, { actionCatalogue }) {
    registerTrainingRoutes(http);
    registerTrainingVisualResourceRoutes(http);
    if (trainingHost) return { training: trainingHost };

    const projectContext = getStudioProjectContext();
    const systemRoot = projectContext.systemRoot;
    const catalogue = createInstalledTrainingCatalogue({ systemRoot });
    // The official catalogue repository is server configuration, never a request input.
    const courseInstaller = createTrainingCourseInstaller({ systemRoot, catalogue,
      repository: env?.VIBE64_LEARNING_CATALOG_REPOSITORY });
    const content = createInstalledTrainingContent({ systemRoot });
    const learners = createTrainingLearnerState({ systemRoot, content });
    const projectRepositoryService = createManagedProjectRepositoryService({ projectContext, projectService: project });
    const codeAuthorship = createTrainingCodeAuthorship({ learners, content, project });
    const checks = createTrainingDeclaredCheckOwner({ learners, content, project, terminals });
    // Version 2 step results; the action layer supplies the action executor.
    const steps = createTrainingStepChecks({ learners, content, checks, authorship: codeAuthorship, actions: actionCatalogue,
      evidence: createTrainingStepEvidence({ project, actions: actionCatalogue }), reviewer: createTrainingStepReviewer({ learners, terminals }) });
    // A browser-supplied actor is never local authority. Retain the original
    // transport check without a host's signed-in-user alternative.
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
      onReadFailure: error => logger?.warn?.({ error: String(error?.message || error) }, "Learn mode could not be read; Develop applies.")
    });
    // The standalone project archive service; a host supplies its own through trainingHost.
    const projectArchive = createProjectArchiveService({ projectContext,
      closeProjectRuntime: ({ slug, reason }) => project.runInProjectContext(slug, () => terminals.closeProjectRuntime({ reason }),
        { allowDeleting: true }) });
    const learningSpace = createTrainingLearningSpace({ learners, content, projectContext, projectArchive });
    const exercises = createTrainingService({ catalogue, content, learners, learningSpace, projectContext, projectRepositoryService, project, sessions, terminals });
    // The learner's ordinary Files editor saves in a practice project record
    // code authorship through the original ledger owner.
    sourceEditor?.setFileSaveOwner(createTrainingCodeSaveOwner({ authorship: codeAuthorship }));
    return { training: Object.freeze({ catalogue, courseInstaller, content, learners, exercises, checks, codeAuthorship, steps,
      learningSpace, publishLearnerChanged: createTrainingLearnerChangedPublisher(events) }) };
  },
  actions({ training, trainingHost }) {
    if (trainingHost) return [];
    return [...createTrainingActions({ catalogue: training.catalogue, learners: training.learners,
      exercises: training.exercises, courseInstaller: training.courseInstaller, learningSpace: training.learningSpace,
      publishLearnerChanged: training.publishLearnerChanged }),
    ...createTrainingStepActions({ learners: training.learners, content: training.content, steps: training.steps,
      exercises: training.exercises, learningSpace: training.learningSpace, publishLearnerChanged: training.publishLearnerChanged }),
    ...createTrainingLearnerNotesActions({ learners: training.learners, publishLearnerChanged: training.publishLearnerChanged }),
    ...createTrainingVisualResourceActions({ learners: training.learners, content: training.content })];
  }
});

export { Vibe64TrainingProvider };
