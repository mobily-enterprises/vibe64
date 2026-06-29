import {
  normalizeText
} from "@local/vibe64-core/server/core";

const WORKFLOW_CONDITION_KINDS = Object.freeze({
  ACTION_INPUT_EXISTS: "action_input_exists",
  ALL: "all",
  ALL_ARTIFACTS_READY: "all_artifacts_ready",
  ALWAYS: "always",
  ANY: "any",
  ARTIFACT_READY: "artifact_ready",
  METADATA_EXISTS: "metadata_exists",
  SESSION_ACTIVE: "session_active",
  STEP_COMPLETED: "step_completed"
});

function freezeCondition(condition) {
  return Object.freeze(condition);
}

function normalizeConditionNames(values = []) {
  return Object.freeze(values.flat().map(normalizeText));
}

function always() {
  return freezeCondition({
    kind: WORKFLOW_CONDITION_KINDS.ALWAYS
  });
}

function sessionActive() {
  return freezeCondition({
    kind: WORKFLOW_CONDITION_KINDS.SESSION_ACTIVE
  });
}

function metadataExists(metadataName) {
  return freezeCondition({
    kind: WORKFLOW_CONDITION_KINDS.METADATA_EXISTS,
    metadataName: normalizeText(metadataName)
  });
}

function artifactReady(artifactName) {
  return freezeCondition({
    artifactName: normalizeText(artifactName),
    kind: WORKFLOW_CONDITION_KINDS.ARTIFACT_READY
  });
}

function allArtifactsReady(...artifactNames) {
  return freezeCondition({
    artifactNames: normalizeConditionNames(artifactNames),
    kind: WORKFLOW_CONDITION_KINDS.ALL_ARTIFACTS_READY
  });
}

function actionInputExists(actionId, inputName) {
  return freezeCondition({
    actionId: normalizeText(actionId),
    inputName: normalizeText(inputName),
    kind: WORKFLOW_CONDITION_KINDS.ACTION_INPUT_EXISTS
  });
}

function stepCompleted(stepId) {
  return freezeCondition({
    kind: WORKFLOW_CONDITION_KINDS.STEP_COMPLETED,
    stepId: normalizeText(stepId)
  });
}

function any(...conditions) {
  return freezeCondition({
    conditions: Object.freeze(conditions.flat()),
    kind: WORKFLOW_CONDITION_KINDS.ANY
  });
}

function all(...conditions) {
  return freezeCondition({
    conditions: Object.freeze(conditions.flat()),
    kind: WORKFLOW_CONDITION_KINDS.ALL
  });
}

const when = Object.freeze({
  actionInputExists,
  all,
  allArtifactsReady,
  always,
  any,
  artifactReady,
  metadataExists,
  sessionActive,
  stepCompleted
});

export {
  WORKFLOW_CONDITION_KINDS,
  actionInputExists,
  all,
  allArtifactsReady,
  always,
  any,
  artifactReady,
  metadataExists,
  sessionActive,
  stepCompleted,
  when
};
