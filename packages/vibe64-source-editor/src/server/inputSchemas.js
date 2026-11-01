import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { integrationsSchema } from "@jskit-ai/connectors-core/shared/configuration";
import { integrationSetupInputSchema } from "./integrationSetupInput.js";
import { integrationConfigurationChangesSchema } from "./integrationConfigurationInput.js";

// The inputs of the source editor's actions and streams.
const text = { type: "string", noTrim: true, required: false };
const requiredText = { ...text, minLength: 1, required: true };
const identity = { ...requiredText, maxLength: 256 };
const filePath = { ...text, maxLength: 4096 };
const requiredFilePath = { ...filePath, required: true };
const object = { type: "object", additionalProperties: true, required: false };
const fileArea = { type: "string", enum: ["repo", "drop-zone", "session", "project-drop-zone", "backups"], required: false };
const requiredFileArea = { ...fileArea, required: true };
const conflict = { type: "string", enum: ["fail", "replace", "keep-both", "skip"], required: false };
const origin = { originId: text, projectSlug: text };
const reviewId = { ...text, minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" };
// Project areas need no session; the service requires one for session areas.
const areaSessionId = { ...identity, required: false };
const integration = {
  ...origin,
  baseHash: { ...text, nullable: true, required: true },
  configuration: { ...object, required: true }
};
const setupRequest = createSchema({
  turnId: { ...requiredText, pattern: "^[0-9]{6,32}$" },
  requestId: { ...reviewId, required: true },
  configurationHash: { ...reviewId, required: true }
});
const selection = {
  path: requiredFilePath,
  startLine: { type: "integer", min: 1, required: true },
  startColumn: { type: "integer", min: 1, required: false },
  endLine: { type: "integer", min: 1, required: true },
  endColumn: { type: "integer", min: 1, required: false },
  presentation: { type: "string", enum: ["description", "steps"], required: false },
  symbolId: { ...text, minLength: 1, maxLength: 4096 },
  expectedHash: { ...text, minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
  scope: { type: "string", enum: ["file", "selection"], required: false },
  force: { type: "boolean", defaultTo: false, required: false },
  originId: text
};
// The explanation stream routes carry the transport's message identities; they
// stream directly instead of returning an action result.
const messageId = { ...text, maxLength: 256 };

/**
 * An action input validator for these fields.
 * @param {object} fields
 */
function inputValidator(fields) {
  return Object.freeze({
    schema: createSchema(fields),
    mode: "create"
  });
}

const sessionInputValidator = inputValidator({ sessionId: identity });
const areaTreeInputValidator = inputValidator({
  sessionId: areaSessionId,
  area: requiredFileArea,
  path: filePath,
  offset: text
});
const areaPathInputValidator = inputValidator({
  sessionId: areaSessionId,
  area: requiredFileArea,
  path: requiredFilePath
});
const areaArchiveInputValidator = inputValidator({
  sessionId: areaSessionId,
  area: requiredFileArea,
  path: filePath
});
const areaConflictsInputValidator = inputValidator({
  sessionId: areaSessionId,
  area: requiredFileArea,
  path: filePath,
  names: { type: "array", items: { type: "string" }, required: true }
});
const areaUploadInputValidator = inputValidator({
  sessionId: areaSessionId,
  area: requiredFileArea,
  path: filePath,
  conflict: { ...conflict, enum: ["fail", "replace", "keep-both"] }
});
const areaCreateInputValidator = inputValidator({
  sessionId: areaSessionId,
  area: requiredFileArea,
  path: requiredFilePath,
  text: { ...text, required: true }
});
const areaSaveInputValidator = inputValidator({
  sessionId: areaSessionId,
  area: requiredFileArea,
  path: requiredFilePath,
  baseHash: requiredText,
  text: { ...text, required: true }
});
const areaRenameInputValidator = inputValidator({
  sessionId: areaSessionId,
  area: requiredFileArea,
  path: requiredFilePath,
  destination: requiredFilePath
});
const areaTransferInputValidator = inputValidator({
  sessionId: areaSessionId,
  area: requiredFileArea,
  path: requiredFilePath,
  mode: { type: "string", enum: ["copy", "move"], required: true },
  targetArea: requiredFileArea,
  targetPath: filePath,
  targetSessionId: { ...identity, required: false },
  conflict
});
const integrationProvidersInputValidator = inputValidator({
  sessionId: identity,
  search: { ...text, maxLength: 200 },
  offset: { type: "integer", min: 0, required: false }
});
const n8nDiscoveryInputValidator = inputValidator({ sessionId: identity, serverUrl: requiredText });
const integrationsSaveInputValidator = inputValidator({
  sessionId: identity,
  ...integration,
  baseHash: { ...reviewId, nullable: true, required: true },
  configuration: { type: "object", schema: integrationsSchema, required: false },
  changes: { type: "object", schema: integrationConfigurationChangesSchema, required: false }
});
const oauthClientInputValidator = inputValidator({
  sessionId: identity,
  ...integration,
  integrationId: identity,
  callbackUrl: requiredText
});
const integrationSetupInputValidator = inputValidator({
  sessionId: identity,
  ...integrationSetupInputSchema.getFieldDefinitions(),
  setupRequest: { type: "object", schema: setupRequest, required: false }
});
const sourceTreeInputValidator = inputValidator({
  sessionId: identity,
  path: filePath,
  limit: text,
  offset: text
});
const sourceQueryInputValidator = inputValidator({
  sessionId: identity,
  query: text,
  limit: text
});
const sourcePathInputValidator = inputValidator({ sessionId: identity, path: requiredFilePath });
const starSetInputValidator = inputValidator({
  sessionId: identity,
  path: requiredFilePath,
  starred: { type: "boolean", required: true }
});
const pathResolveInputValidator = inputValidator({
  sessionId: identity,
  fromPath: filePath,
  target: requiredText
});
const explanationsCleanupInputValidator = inputValidator({
  sessionId: identity,
  activeExplanationIds: { type: "array", items: { type: "string" }, required: false },
  originId: text
});
const explanationInputValidator = inputValidator({ sessionId: identity, explanationId: identity });
const sourceFileCreateInputValidator = inputValidator({
  sessionId: identity,
  ...origin,
  path: requiredFilePath
});
const sourceFileSaveInputValidator = inputValidator({
  sessionId: identity,
  ...origin,
  path: requiredFilePath,
  baseHash: requiredText,
  text: { ...text, required: true }
});
const explanationStreamSchema = createSchema({
  sessionId: identity,
  ...selection,
  explanationId: { ...identity, required: false },
  assistantMessageId: messageId,
  userMessageId: messageId
});
const explanationFollowupStreamSchema = createSchema({
  sessionId: identity,
  explanationId: identity,
  message: requiredText,
  assistantMessageId: messageId,
  userMessageId: messageId
});

export {
  areaArchiveInputValidator,
  areaConflictsInputValidator,
  areaCreateInputValidator,
  areaPathInputValidator,
  areaRenameInputValidator,
  areaSaveInputValidator,
  areaTransferInputValidator,
  areaTreeInputValidator,
  areaUploadInputValidator,
  explanationFollowupStreamSchema,
  explanationInputValidator,
  explanationStreamSchema,
  explanationsCleanupInputValidator,
  integrationProvidersInputValidator,
  integrationSetupInputValidator,
  integrationsSaveInputValidator,
  n8nDiscoveryInputValidator,
  oauthClientInputValidator,
  pathResolveInputValidator,
  sessionInputValidator,
  sourceFileCreateInputValidator,
  sourceFileSaveInputValidator,
  sourcePathInputValidator,
  sourceQueryInputValidator,
  sourceTreeInputValidator,
  starSetInputValidator
};
