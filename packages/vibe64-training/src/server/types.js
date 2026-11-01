// The type of the `vibe64.training` capability, for features that require it,
// and the types several of the package's files share.

/** @typedef {ReturnType<typeof import("./Vibe64TrainingFeature.js").createTraining>} TrainingService */
/** @typedef {ReturnType<typeof import("./installedCatalogue.js").createInstalledTrainingCatalogue>} InstalledTrainingCatalogue */
/** @typedef {ReturnType<typeof import("./installedContent.js").createInstalledTrainingContent>} InstalledTrainingContent */
/** @typedef {ReturnType<typeof import("./learnerState.js").createTrainingLearnerState>} TrainingLearnerState */
/** @typedef {ReturnType<typeof import("./declaredCheck.js").createTrainingDeclaredCheckOwner>} TrainingDeclaredCheckOwner */
/** @typedef {ReturnType<typeof import("./codeAuthorship.js").createTrainingCodeAuthorship>} TrainingCodeAuthorship */
/** @typedef {ReturnType<typeof import("./learningSpace.js").createTrainingLearningSpace>} TrainingLearningSpace */
/** @typedef {TrainingService["learners"]} TrainingLearners */
/** @typedef {TrainingService["publishLearnerChanged"]} TrainingPublishLearnerChanged */
/** @typedef {TrainingService["content"]} TrainingContent */
/** @typedef {TrainingService["exercises"]} TrainingExercises */

export {};
