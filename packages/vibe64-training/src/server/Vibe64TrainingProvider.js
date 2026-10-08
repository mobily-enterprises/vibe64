import { defineFeature } from "@jskit-ai/kernel/server/features";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { isLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { registerRoutes as registerLearningSessionRoutes } from "@local/vibe64-sessions/server/routes";
import { createTrainingActions } from "./actions.js";
import { createInstalledTrainingCatalogue } from "./installedCatalogue.js";
import { createInstalledTrainingContent } from "./installedContent.js";
import { createTrainingLearnerState } from "./learnerState.js";
import { createTrainingTeachingBrief } from "./teachingBrief.js";
import { createTrainingService } from "./preparation.js";
import { createManagedProjectRepositoryService } from "@local/vibe64-project/server/managedRepository";
import { createTrainingLearningSessions } from "./learningSessions.js";
import { createTrainingTeachingOwner } from "./teaching.js";
import { createTrainingAnswerAssessment } from "./answerAssessment.js";
import { createTrainingPresentationActions } from "./presentationActions.js";
import { createTrainingMainPresentationActions } from "./mainPresentationActions.js";
import { registerTrainingMainPresentationRoutes } from "./mainPresentationRoutes.js";
import { createTrainingMainTeaching } from "./mainTeaching.js";
import { createTrainingTeachingActions } from "./teachingActions.js";
import { createTrainingAssessmentActions } from "./assessmentActions.js";
import { registerTrainingRoutes } from "./registerRoutes.js";
import { createTrainingVisualResourceActions } from "./visualResourceActions.js";
import { registerTrainingVisualResourceRoutes } from "./visualResourceRoutes.js";

const Vibe64TrainingProvider = defineFeature({
  id: "vibe64.training", domain: "vibe64-training",
  requires: { http: "runtime.http", project: "vibe64.project", sessions: "vibe64.sessions", terminals: "vibe64.terminals" },
  optional: { trainingHost: "vibe64.training.host" },
  provides: { training: "vibe64.training" },
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  setup({ http, project, sessions, terminals, trainingHost }, { actionCatalogue }) {
    registerTrainingRoutes(http);
    registerTrainingMainPresentationRoutes(http);
    registerTrainingVisualResourceRoutes(http);
    registerTrainingVisualResourceRoutes(http, { learningScoped: true });
    if (trainingHost) return { training: trainingHost };

    const projectContext = getStudioProjectContext();
    const systemRoot = projectContext.systemRoot;
    const catalogue = createInstalledTrainingCatalogue({ systemRoot });
    const content = createInstalledTrainingContent({ systemRoot });
    const learners = createTrainingLearnerState({ systemRoot, content });
    const brief = createTrainingTeachingBrief({ learners, content });
    const projectRepositoryService = createManagedProjectRepositoryService({ projectContext, projectService: project });
    const teaching = createTrainingTeachingOwner({ learners, content });
    const assessment = createTrainingAnswerAssessment({ learners, content, teaching });
    const mainTeaching = createTrainingMainTeaching({ teaching, assessment });
    const learningSessions = createTrainingLearningSessions({ learners, teachingBrief: brief, project, sessions, projectContext,
      learningTeaching: mainTeaching, practiceSessions: true });
    const exercises = createTrainingService({ catalogue, content, learners, projectContext, projectRepositoryService, project, sessions, terminals,
      learningSessions });
    registerVibe64ActionContext(actionCatalogue, {
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
      },
      resolveLearningContext: learningSessions.resolveContext
    });
    registerLearningSessionRoutes(http, { learningScoped: true, routeSurface: "app" });
    return { training: Object.freeze({ catalogue, content, learners, brief, exercises, learningSessions, teaching, assessment, mainTeaching }) };
  },
  actions({ training, trainingHost, project }, { actionCatalogue }) {
    if (trainingHost) return [];
    return [...createTrainingActions({ catalogue: training.catalogue, learners: training.learners,
      teachingBrief: training.brief, exercises: training.exercises, learningSessions: training.learningSessions }),
    ...createTrainingTeachingActions({ mainTeaching: training.mainTeaching }),
    ...createTrainingPresentationActions({ learners: training.learners, content: training.content, mainTeaching: training.mainTeaching }),
    ...createTrainingMainPresentationActions({ project, actions: actionCatalogue }),
    ...createTrainingAssessmentActions({ mainTeaching: training.mainTeaching }).filter(action => action.id === "vibe64.training.answer.evaluate"),
    ...createTrainingVisualResourceActions({ learners: training.learners, content: training.content,
      teaching: training.teaching, actions: actionCatalogue })];
  }
});

export { Vibe64TrainingProvider };
