import { createTrainingDeclaredCheckOwner } from "./declaredCheck.js";
import { createTrainingCodeAuthorship } from "./codeAuthorship.js";
import { createTrainingStepChecks } from "./stepChecks.js";
import { createTrainingCodeEditorActions, registerTrainingCodeEditorRoutes } from "./codeEditorActions.js";
import { createTrainingPracticalActions } from "./practicalActions.js";
import { createTrainingMainPracticalActions } from "./mainPracticalActions.js";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { isLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { registerLocalPracticeAdmission } from "@local/vibe64-core/server/projectRequestContext";
import { registerRoutes as registerLearningSessionRoutes } from "@local/vibe64-sessions/server/routes";
import { createTrainingActions } from "./actions.js";
import { createTrainingStepActions } from "./stepActions.js";
import { createTrainingLearnerNotesActions } from "./learnerNotesActions.js";
import { createTrainingLearnerChangedPublisher } from "./learnerEvents.js";
import { createInstalledTrainingCatalogue } from "./installedCatalogue.js";
import { createTrainingCourseInstaller } from "./courseInstaller.js";
import { createInstalledTrainingContent } from "./installedContent.js";
import { createTrainingLearnerState } from "./learnerState.js";
import { createTrainingTeachingBrief } from "./teachingBrief.js";
import { createTrainingService } from "./preparation.js";
import { createManagedProjectRepositoryService } from "@local/vibe64-project/server/managedRepository";
import { admitLocalPracticeProject, createTrainingLearningSessions } from "./learningSessions.js";
import { createLocalPracticeProjects } from "./practiceProjects.js";
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
  requires: { env: "runtime.env", logger: "runtime.logger", http: "runtime.http", project: "vibe64.project", sessions: "vibe64.sessions", terminals: "vibe64.terminals" },
  optional: { trainingHost: "vibe64.training.host", sourceEditor: "vibe64.source-editor", events: "runtime.events" },
  provides: { training: "vibe64.training" },
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  setup({ env, logger, http, project, sessions, terminals, trainingHost, sourceEditor, events }, { actionCatalogue }) {
    registerTrainingRoutes(http);
    registerTrainingMainPresentationRoutes(http);
    registerTrainingVisualResourceRoutes(http);
    registerTrainingVisualResourceRoutes(http, { learningScoped: true });
    if (trainingHost) return { training: trainingHost };

    const projectContext = getStudioProjectContext();
    const systemRoot = projectContext.systemRoot;
    const catalogue = createInstalledTrainingCatalogue({ systemRoot });
    // The official catalogue repository is server configuration, never a request input.
    const courseInstaller = createTrainingCourseInstaller({ systemRoot, catalogue,
      repository: env?.VIBE64_LEARNING_CATALOG_REPOSITORY });
    const content = createInstalledTrainingContent({ systemRoot });
    const learners = createTrainingLearnerState({ systemRoot, content });
    const brief = createTrainingTeachingBrief({ learners, content });
    const projectRepositoryService = createManagedProjectRepositoryService({ projectContext, projectService: project });
    const codeAuthorship = createTrainingCodeAuthorship({ learners, content, project });
    const teaching = createTrainingTeachingOwner({ learners, content, codeBaseline: codeAuthorship.recordBaseline });
    const assessment = createTrainingAnswerAssessment({ learners, content, teaching });
    const checks = createTrainingDeclaredCheckOwner({ learners, content, project, terminals });
    const mainTeaching = createTrainingMainTeaching({ teaching, assessment, checks });
    // Version 2 step results; the action layer supplies the action executor.
    const steps = createTrainingStepChecks({ learners, content, checks, authorship: codeAuthorship, actions: actionCatalogue });
    const learningSessions = createTrainingLearningSessions({ learners, teachingBrief: brief, project, sessions, terminals, projectContext,
      learningTeaching: mainTeaching, practiceSessions: true });
    const exercises = createTrainingService({ catalogue, content, learners, projectContext, projectRepositoryService, project, sessions, terminals,
      learningSessions });
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
      },
      resolveLearningContext: learningSessions.resolveContext
    });
    registerLocalPracticeAdmission(({ slug }) => admitLocalPracticeProject({ learners, actor: currentOsUser(), slug }));
    // Host facility practiceProjects.remove; Online supplies its own through trainingHost.
    const practiceProjects = createLocalPracticeProjects({ learners, projectContext, project, terminals });
    registerLearningSessionRoutes(http, { learningScoped: true, routeSurface: "app" });
    if (sourceEditor) registerTrainingCodeEditorRoutes(http);
    return { training: Object.freeze({ catalogue, courseInstaller, content, learners, brief, exercises, learningSessions, teaching, assessment, checks, mainTeaching,
      codeAuthorship, steps, practiceProjects, publishLearnerChanged: createTrainingLearnerChangedPublisher(events) }) };
  },
  actions({ training, trainingHost, project, sourceEditor }, { actionCatalogue }) {
    if (trainingHost) return [];
    return [...createTrainingActions({ catalogue: training.catalogue, learners: training.learners,
      teachingBrief: training.brief, exercises: training.exercises, learningSessions: training.learningSessions,
      courseInstaller: training.courseInstaller, practiceProjects: training.practiceProjects }),
    ...createTrainingStepActions({ learners: training.learners, content: training.content, steps: training.steps,
      exercises: training.exercises, practiceProjects: training.practiceProjects, publishLearnerChanged: training.publishLearnerChanged }),
    ...createTrainingLearnerNotesActions({ learners: training.learners, publishLearnerChanged: training.publishLearnerChanged }),
    ...createTrainingTeachingActions(),
    ...createTrainingPresentationActions({ learners: training.learners, content: training.content }),
    ...createTrainingMainPresentationActions({ project, actions: actionCatalogue }),
    ...createTrainingMainPracticalActions({ project, actions: actionCatalogue }),
    ...createTrainingPracticalActions(),
    ...createTrainingAssessmentActions(),
    ...createTrainingCodeEditorActions({ authorship: training.codeAuthorship, sourceEditor }),
    ...createTrainingVisualResourceActions({ learners: training.learners, content: training.content,
      teaching: training.teaching, actions: actionCatalogue })];
  }
});

export { Vibe64TrainingProvider };
