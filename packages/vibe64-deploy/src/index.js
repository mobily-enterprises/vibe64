// The deploy engine (public Vibe64): from a project's Stack to what runs at a provider. It runs only in Vibe64's editor,
// which gives it the credential, the record's place and the prices; it knows no host. Each part is also its own export.
export { HOST_SETTINGS, INSTANCES_LIMIT, NEED_KINDS, SERVICES_MAX, STACK_FIX, boundSettings, needsProblem, productionAppName } from "./needs.js";
export { needsOfStack } from "./needsOfStack.js";
export { archiveProblem, envEntryProblem, packArchive, settingsPerService } from "./package.js";
export { planOf } from "./plan.js";
export { FORMAT as RECORD_FORMAT, createRecordStore, labelsFor, newRecord, rebuildFromLabels } from "./record.js";
