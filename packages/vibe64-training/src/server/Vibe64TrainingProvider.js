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
import { createTrainingLearningSessions } from "./learningSessions.js";
import { registerTrainingRoutes } from "./registerRoutes.js";

const Vibe64TrainingProvider = defineFeature({
  id: "vibe64.training", domain: "vibe64-training",
  requires: { http: "runtime.http", project: "vibe64.project", sessions: "vibe64.sessions", terminals: "vibe64.terminals" },
  optional: { trainingHost: "vibe64.training.host" },
  provides: { training: "vibe64.training" },
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  setup({ http, project, sessions, terminals, trainingHost }, { actionCatalogue }) {
    registerTrainingRoutes(http);
    if (trainingHost) return { training: trainingHost };

    const projectContext = getStudioProjectContext();
    const systemRoot = projectContext.systemRoot;
    const catalogue = createInstalledTrainingCatalogue({ systemRoot });
    const content = createInstalledTrainingContent({ systemRoot });
    const learners = createTrainingLearnerState({ systemRoot, content });
    const brief = createTrainingTeachingBrief({ learners, content });
    const exercises = createTrainingService({ catalogue, content, learners, projectContext, project, sessions, terminals });
    const learningSessions = createTrainingLearningSessions({ learners, teachingBrief: brief, project, sessions, projectContext });
    registerVibe64ActionContext(actionCatalogue, {
      admissionScope: "learning-only",
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
    return { training: Object.freeze({ catalogue, content, learners, brief, exercises, learningSessions }) };
  },
  actions({ training, trainingHost }) {
    return trainingHost ? [] : createTrainingActions({ catalogue: training.catalogue, learners: training.learners,
      teachingBrief: training.brief, exercises: training.exercises, learningSessions: training.learningSessions });
  }
});

export { Vibe64TrainingProvider };
