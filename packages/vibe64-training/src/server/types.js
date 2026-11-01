// The type of the `vibe64.training` capability, for features that require it,
// and the types several of the package's files share.

/** @typedef {ReturnType<typeof import("./trainingRuntime.js").createTraining>} TrainingService */
/** @typedef {ReturnType<typeof import("./installedCatalogue.js").createInstalledTrainingCatalogue>} InstalledTrainingCatalogue */
/** @typedef {ReturnType<typeof import("./installedContent.js").createInstalledTrainingContent>} InstalledTrainingContent */
/** @typedef {ReturnType<typeof import("./learnerState.js").createTrainingLearnerState>} TrainingLearnerState */
/** @typedef {ReturnType<typeof import("./declaredCheck.js").createTrainingDeclaredCheckOwner>} TrainingDeclaredCheckOwner */
/** @typedef {ReturnType<typeof import("./codeAuthorship.js").createTrainingCodeAuthorship>} TrainingCodeAuthorship */
/** @typedef {ReturnType<typeof import("./learningSpace.js").createTrainingLearningSpace>} TrainingLearningSpace */
/** @typedef {ReturnType<typeof import("./courseInstaller.js").createTrainingCourseInstaller>} TrainingCourseInstaller */
/** @typedef {ReturnType<typeof import("./preparation.js").createTrainingService>} TrainingExercises */
/** @typedef {ReturnType<typeof import("./stepChecks.js").createTrainingStepChecks>} TrainingStepChecks */
/** @typedef {ReturnType<typeof import("./trainingOperations.js").createTrainingOperations>} TrainingOperations */
/** @typedef {ReturnType<typeof import("./stepOperations.js").createTrainingStepOperations>} TrainingStepOperations */
/** @typedef {ReturnType<typeof import("./learnerNotesOperations.js").createTrainingLearnerNotesOperations>} TrainingLearnerNotesOperations */
/** @typedef {ReturnType<typeof import("./lessonVisuals.js").createTrainingLessonVisuals>} TrainingLessonVisuals */
/** @typedef {ReturnType<typeof import("./learnerEvents.js").createTrainingLearnerChangedPublisher>} TrainingPublishLearnerChanged */
/** @typedef {TrainingLearnerState} TrainingLearners */
/** @typedef {InstalledTrainingContent} TrainingContent */
/**
 * A server fact reader a lesson's `fact` check asks, for example one a host answers from its own state.
 * @typedef {{
 *   id: string,
 *   read: (request: { actor: object, projectSlug: string, context: object }) => Promise<{ holds: boolean, reason?: string }>
 * }} LearningFact
 */
/** @typedef {ReturnType<typeof import("./learningFacts.js").createLearningFacts>} LearningFacts */

export {};
