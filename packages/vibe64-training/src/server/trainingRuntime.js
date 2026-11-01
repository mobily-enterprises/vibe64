import { createManagedProjectRepositoryService } from "@local/vibe64-project/server/managedRepository";
import { createProjectArchiveService } from "@local/vibe64-project/server/project-archive";
import { createTrainingCodeAuthorship } from "./codeAuthorship.js";
import { createTrainingCourseInstaller } from "./courseInstaller.js";
import { createTrainingDeclaredCheckOwner } from "./declaredCheck.js";
import { createInstalledTrainingCatalogue } from "./installedCatalogue.js";
import { createInstalledTrainingContent } from "./installedContent.js";
import { createTrainingLearnerChangedPublisher } from "./learnerEvents.js";
import { createTrainingLearnerNotesOperations } from "./learnerNotesOperations.js";
import { createTrainingLearnerState } from "./learnerState.js";
import { createTrainingLearningSpace } from "./learningSpace.js";
import { createTrainingLessonVisuals } from "./lessonVisuals.js";
import { createTrainingService } from "./preparation.js";
import { createTrainingStepChecks } from "./stepChecks.js";
import { createTrainingStepEvidence } from "./stepEvidence.js";
import { createTrainingStepOperations } from "./stepOperations.js";
import { createTrainingStepReviewer } from "./stepReview.js";
import { createTrainingOperations } from "./trainingOperations.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").LearningFacts} LearningFacts */
/** @typedef {import("./types.js").LearnThreadOwner} LearnThreadOwner */

/**
 * The training capability of this computer: its installed catalogue and content, the learners' state, exercise
 * preparation, step checks, the learning space, and the operations Training's actions call. The local project archive
 * closes a practice project's runtime in that project before archiving it.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actionCatalogue
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeEvents} dependencies.events
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {StudioProjectContext} dependencies.projectContext
 * @param {SessionsService} dependencies.sessions
 * @param {TerminalsService} dependencies.terminals
 * @param {LearningFacts} dependencies.facts
 * @param {LearnThreadOwner} dependencies.learnThreads
 */
function createTraining({
  actionCatalogue,
  env,
  events,
  logger,
  project,
  projectContext,
  sessions,
  terminals,
  facts,
  learnThreads
}) {
  const systemRoot = projectContext.systemRoot;
  const catalogue = createInstalledTrainingCatalogue({ systemRoot });
  // The official catalogue repository is server configuration, never a request input.
  const courseInstaller = createTrainingCourseInstaller({
    systemRoot,
    catalogue,
    repository: env.VIBE64_LEARNING_CATALOG_REPOSITORY
  });
  const content = createInstalledTrainingContent({ systemRoot });
  const learners = createTrainingLearnerState({ systemRoot, content, logger });
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
    }),
    facts
  });
  const projectArchive = createProjectArchiveService({
    projectContext,
    closeProjectRuntime: ({ slug, reason }) => project.runInProjectContext(
      slug,
      () => terminals.closeProjectRuntime({ reason }),
      { allowDeleting: true }
    )
  });
  const learningSpace = createTrainingLearningSpace({
    learners,
    content,
    projectContext,
    projectArchive,
    learnThreads
  });
  const exercises = createTrainingService({
    catalogue,
    content,
    learners,
    learningSpace,
    projectContext,
    projectRepositoryService: createManagedProjectRepositoryService({ projectContext, project }),
    project,
    sessions,
    terminals
  });
  const publishLearnerChanged = createTrainingLearnerChangedPublisher(events);

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
    publishLearnerChanged,
    operations: createTrainingOperations({
      catalogue,
      learners,
      content,
      exercises,
      courseInstaller,
      learningSpace,
      publishLearnerChanged,
      logger
    }),
    stepOperations: createTrainingStepOperations({
      learners,
      attemptLearners: learners,
      content,
      steps,
      exercises,
      learningSpace,
      publishLearnerChanged,
      logger
    }),
    learnerNotes: createTrainingLearnerNotesOperations({ learners, publishLearnerChanged }),
    lessonVisuals: createTrainingLessonVisuals({ learners, content })
  });
}

export { createTraining };
