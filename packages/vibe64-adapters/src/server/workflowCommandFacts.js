import path from "node:path";

import {
  shellQuote
} from "@local/vibe64-execution/server";

const COMMAND_RESULT_ENV = "VIBE64_COMMAND_RESULT_FILE";

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
    `VIBE64_STEP_ARTIFACTS_ROOT=${quotedArtifactsRoot}`,
    `VIBE64_STEP_ID=${quotedStepId}`,
    "vibe64_artifact_path() {",
    "  printf '%s/%s.%s\\n' \"$VIBE64_STEP_ARTIFACTS_ROOT\" \"$VIBE64_STEP_ID\" \"$1\"",
    "}",
    "vibe64_tmp_artifact_path() {",
    "  printf '%s/tmp/%s.%s\\n' \"$VIBE64_STEP_ARTIFACTS_ROOT\" \"$VIBE64_STEP_ID\" \"$1\"",
    "}",
    "vibe64_read_artifact() {",
    "  cat \"$(vibe64_artifact_path \"$1\")\"",
    "}",
    "vibe64_read_tmp_artifact() {",
    "  cat \"$(vibe64_tmp_artifact_path \"$1\")\"",
    "}",
    "vibe64_write_artifact() {",
    "  mkdir -p \"$VIBE64_STEP_ARTIFACTS_ROOT\"",
    "  printf '%s\\n' \"$2\" > \"$(vibe64_artifact_path \"$1\")\"",
    "}",
    "vibe64_write_tmp_artifact() {",
    "  mkdir -p \"$VIBE64_STEP_ARTIFACTS_ROOT/tmp\"",
    "  printf '%s\\n' \"$2\" > \"$(vibe64_tmp_artifact_path \"$1\")\"",
    "}",
    "vibe64_require_artifact() {",
    "  VIBE64_REQUIRED_ARTIFACT_PATH=\"$(vibe64_artifact_path \"$1\")\"",
    "  if [ ! -s \"$VIBE64_REQUIRED_ARTIFACT_PATH\" ]; then",
    "    printf '[studio] Missing %s: %s\\n' \"${2:-artifact}\" \"$VIBE64_REQUIRED_ARTIFACT_PATH\" >&2",
    "    exit 1",
    "  fi",
    "}",
    "vibe64_require_tmp_artifact() {",
    "  VIBE64_REQUIRED_ARTIFACT_PATH=\"$(vibe64_tmp_artifact_path \"$1\")\"",
    "  if [ ! -s \"$VIBE64_REQUIRED_ARTIFACT_PATH\" ]; then",
    "    printf '[studio] Missing %s: %s\\n' \"${2:-temporary artifact}\" \"$VIBE64_REQUIRED_ARTIFACT_PATH\" >&2",
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
    `VIBE64_COMMAND_FACT_VALUE=${valueExpression}`,
    `if [ -n "\${${COMMAND_RESULT_ENV}:-}" ]; then`,
    `  printf 'fact:set\\t%s\\t%s\\n' ${shellQuote(name)} "$(printf '%s' "$VIBE64_COMMAND_FACT_VALUE" | base64 | tr -d '\\n')" >> "$${COMMAND_RESULT_ENV}"`,
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
