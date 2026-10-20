import { createTrainingDeclaredCheckOwner } from "./declaredCheck.js";
import { createTrainingCodeAuthorship } from "./codeAuthorship.js";
import { createTrainingStepChecks } from "./stepChecks.js";
import { createTrainingCodeSaveOwner } from "./codeEditorActions.js";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { isLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { registerLocalPracticeAdmission } from "@local/vibe64-core/server/projectRequestContext";
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
import { admitLocalPracticeProject, createLocalPracticeProjects } from "./practiceProjects.js";
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
    const steps = createTrainingStepChecks({ learners, content, checks, authorship: codeAuthorship, actions: actionCatalogue });
    const exercises = createTrainingService({ catalogue, content, learners, projectContext, projectRepositoryService, project, sessions, terminals });
    registerVibe64ActionContext(actionCatalogue, {
      env,
      logger,
      admissionScope: "learning-only",
      projectContext,
      resolveUser({ request }) {
        // A browser-supplied actor is never local authority. Retain the original
        // transport check without its hosted signed-in-user alternative.
        if (!request || !isLocalStudioRequest(Object.assign(Object.create(request), { vibe64User: null }))) return null;
        const actor = currentOsUser();
        if (!Number.isSafeInteger(actor.uid) || actor.uid < 0 || !actor.username) return null;
        return { ...actor, role: "owner" };
      },
      authorizeProject() {
        throw new Error("Learning authority cannot authorize a working project.");
      }
    });
    registerLocalPracticeAdmission(({ slug }) => admitLocalPracticeProject({ learners, actor: currentOsUser(), slug }));
    // Learning mode: the local learner is this computer's user, whatever the request says.
    registerLearningModeReader(() => learners.readLearningMode({ actor: currentOsUser() }), {
      onReadFailure: error => logger?.warn?.({ error: String(error?.message || error) }, "Learning mode could not be read; projects stay open.")
    });
    // Host facility practiceProjects.remove; Online supplies its own through trainingHost.
    const practiceProjects = createLocalPracticeProjects({ learners, projectContext, project, terminals });
    // The learner's ordinary Files editor saves in a practice project record
    // code authorship through the original ledger owner.
    sourceEditor?.setFileSaveOwner(createTrainingCodeSaveOwner({ authorship: codeAuthorship, learners }));
    return { training: Object.freeze({ catalogue, courseInstaller, content, learners, exercises, checks, codeAuthorship, steps,
      practiceProjects, publishLearnerChanged: createTrainingLearnerChangedPublisher(events) }) };
  },
  actions({ training, trainingHost }) {
    if (trainingHost) return [];
    return [...createTrainingActions({ catalogue: training.catalogue, learners: training.learners,
      exercises: training.exercises, courseInstaller: training.courseInstaller, practiceProjects: training.practiceProjects,
      publishLearnerChanged: training.publishLearnerChanged }),
    ...createTrainingStepActions({ learners: training.learners, content: training.content, steps: training.steps,
      exercises: training.exercises, practiceProjects: training.practiceProjects, publishLearnerChanged: training.publishLearnerChanged }),
    ...createTrainingLearnerNotesActions({ learners: training.learners, publishLearnerChanged: training.publishLearnerChanged }),
    ...createTrainingVisualResourceActions({ learners: training.learners, content: training.content })];
  }
});

export { Vibe64TrainingProvider };
