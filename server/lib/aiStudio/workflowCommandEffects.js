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

function deleteMetadataScript(name = "") {
  return [
    `if [ -n "\${${COMMAND_RESULT_ENV}:-}" ]; then`,
    `  printf 'metadata:delete\\t%s\\n' ${shellQuote(name)} >> "$${COMMAND_RESULT_ENV}"`,
    "fi"
  ].join("\n");
}

function recordMetadataScript(name = "", valueExpression = "") {
  return [
    `AI_STUDIO_COMMAND_METADATA_VALUE=${valueExpression}`,
    `if [ -n "\${${COMMAND_RESULT_ENV}:-}" ]; then`,
    `  printf 'metadata:set\\t%s\\t%s\\n' ${shellQuote(name)} "$(printf '%s' "$AI_STUDIO_COMMAND_METADATA_VALUE" | base64 | tr -d '\\n')" >> "$${COMMAND_RESULT_ENV}"`,
    "fi"
  ].join("\n");
}

export {
  artifactFilePath,
  deleteMetadataScript,
  metadataFilePath,
  recordMetadataScript,
  requiredArtifactScript,
  requiredCommandFileScript
};
