import path from "node:path";

import {
  shellQuote
} from "../shellCommands.js";

const COMMAND_RESULT_ENV = "AI_STUDIO_COMMAND_RESULT_FILE";

function metadataFilePath(session = {}, name = "") {
  return session.metadataRoot && name ? path.join(session.metadataRoot, name) : "";
}

function artifactFilePath(session = {}, name = "") {
  return session.artifactsRoot && name ? path.join(session.artifactsRoot, name) : "";
}

function stepArtifactShellLibrary(session = {}, stepId = "") {
  const quotedArtifactsRoot = shellQuote(session.artifactsRoot || "");
  const quotedStepId = shellQuote(stepId);
  return [
    `AI_STUDIO_STEP_ARTIFACTS_ROOT=${quotedArtifactsRoot}`,
    `AI_STUDIO_STEP_ID=${quotedStepId}`,
    "ai_studio_artifact_path() {",
    "  printf '%s/%s.%s\\n' \"$AI_STUDIO_STEP_ARTIFACTS_ROOT\" \"$AI_STUDIO_STEP_ID\" \"$1\"",
    "}",
    "ai_studio_tmp_artifact_path() {",
    "  printf '%s/tmp/%s.%s\\n' \"$AI_STUDIO_STEP_ARTIFACTS_ROOT\" \"$AI_STUDIO_STEP_ID\" \"$1\"",
    "}",
    "ai_studio_read_artifact() {",
    "  cat \"$(ai_studio_artifact_path \"$1\")\"",
    "}",
    "ai_studio_read_tmp_artifact() {",
    "  cat \"$(ai_studio_tmp_artifact_path \"$1\")\"",
    "}",
    "ai_studio_write_artifact() {",
    "  mkdir -p \"$AI_STUDIO_STEP_ARTIFACTS_ROOT\"",
    "  printf '%s\\n' \"$2\" > \"$(ai_studio_artifact_path \"$1\")\"",
    "}",
    "ai_studio_write_tmp_artifact() {",
    "  mkdir -p \"$AI_STUDIO_STEP_ARTIFACTS_ROOT/tmp\"",
    "  printf '%s\\n' \"$2\" > \"$(ai_studio_tmp_artifact_path \"$1\")\"",
    "}",
    "ai_studio_require_artifact() {",
    "  AI_STUDIO_REQUIRED_ARTIFACT_PATH=\"$(ai_studio_artifact_path \"$1\")\"",
    "  if [ ! -s \"$AI_STUDIO_REQUIRED_ARTIFACT_PATH\" ]; then",
    "    printf '[studio] Missing %s: %s\\n' \"${2:-artifact}\" \"$AI_STUDIO_REQUIRED_ARTIFACT_PATH\" >&2",
    "    exit 1",
    "  fi",
    "}",
    "ai_studio_require_tmp_artifact() {",
    "  AI_STUDIO_REQUIRED_ARTIFACT_PATH=\"$(ai_studio_tmp_artifact_path \"$1\")\"",
    "  if [ ! -s \"$AI_STUDIO_REQUIRED_ARTIFACT_PATH\" ]; then",
    "    printf '[studio] Missing %s: %s\\n' \"${2:-temporary artifact}\" \"$AI_STUDIO_REQUIRED_ARTIFACT_PATH\" >&2",
    "    exit 1",
    "  fi",
    "}"
  ].join("\n");
}

function requiredCommandFileScript(filePath = "", label = "file") {
  const quotedFilePath = shellQuote(filePath);
  return [
    `if [ ! -s ${quotedFilePath} ]; then`,
    `  printf '[studio] Missing ${label}: %s\\n' ${quotedFilePath} >&2`,
    "  exit 1",
    "fi"
  ].join("\n");
}

function requiredArtifactScript(session = {}, name = "", label = "artifact") {
  return requiredCommandFileScript(artifactFilePath(session, name), label);
}

function recordCommandFactScript(name = "", valueExpression = "") {
  return [
    `AI_STUDIO_COMMAND_FACT_VALUE=${valueExpression}`,
    `if [ -n "\${${COMMAND_RESULT_ENV}:-}" ]; then`,
    `  printf 'fact:set\\t%s\\t%s\\n' ${shellQuote(name)} "$(printf '%s' "$AI_STUDIO_COMMAND_FACT_VALUE" | base64 | tr -d '\\n')" >> "$${COMMAND_RESULT_ENV}"`,
    "fi"
  ].join("\n");
}

export {
  artifactFilePath,
  metadataFilePath,
  recordCommandFactScript,
  requiredArtifactScript,
  requiredCommandFileScript,
  stepArtifactShellLibrary
};
