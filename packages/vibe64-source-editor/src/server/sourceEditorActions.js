import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { integrationsSchema } from "@jskit-ai/connectors-core/shared/configuration";
import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { integrationReadTool, integrationSetupTool } from "./integrationAssistantContracts.js";
import { integrationSetupInputSchema } from "./integrationSetupInput.js";
import { integrationConfigurationChangesSchema } from "./integrationConfigurationInput.js";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

/** @typedef {import("./types.js").SourceEditorService} SourceEditorService */
/** @typedef {ReturnType<typeof import("./events.js").createSourceEditorFileChangedPublisher>} PublishFileChanged */

const text = { type: "string", noTrim: true, required: false };
const requiredText = { ...text, minLength: 1, required: true };
const identity = { ...requiredText, maxLength: 256 };
const filePath = { ...text, maxLength: 4096 };
const object = { type: "object", additionalProperties: true, required: false };
const fileArea = { type: "string", enum: ["repo", "drop-zone", "session", "project-drop-zone", "backups"], required: false };
const conflict = { type: "string", enum: ["fail", "replace", "keep-both", "skip"], required: false };
const origin = { originId: text, projectSlug: text };
const reviewId = { ...text, minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" };
const setupRequest = createSchema({
  turnId: { ...requiredText, pattern: "^[0-9]{6,32}$" },
  requestId: { ...reviewId, required: true },
  configurationHash: { ...reviewId, required: true }
});
const selection = {
  path: { ...filePath, required: true },
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

/**
 * @param {object} dependencies
 * @param {SourceEditorService} dependencies.sourceEditor
 * @param {PublishFileChanged} dependencies.publishFileChanged
 */
function createSourceEditorActions({ sourceEditor, publishFileChanged }) {
  /**
   * A saved change is announced to the editors open on its session.
   */
  async function announceChange(operation, change) {
    const result = await change;
    await publishFileChanged(result, { operation });
    return result;
  }
  const integration = { ...origin, baseHash: { ...text, nullable: true, required: true }, configuration: { ...object, required: true } };
  // Only explicit product controls are exposed; source work stays with coding agents.
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.file-areas.read",
      input: { schema: createSchema({ sessionId: identity }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readFileAreas(input)
    }),
    // Project areas need no session; the service requires one for session areas.
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.file-area.tree",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: filePath,
          offset: text
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readAreaTree(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.file-area.file",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: { ...filePath, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readAreaFile(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.file-area.download",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: { ...filePath, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.downloadAreaFile(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.file-area.archive",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: filePath
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.downloadAreaArchive(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.file-area.conflicts",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: filePath,
          names: { type: "array", items: { type: "string" }, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.findAreaConflicts(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.file-area.upload",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: filePath,
          conflict: { ...conflict, enum: ["fail", "replace", "keep-both"] }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sourceEditor.uploadAreaFile(input, { readUpload: context.sourceEditorUpload?.readUpload })
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.file-area.create",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: { ...filePath, required: true },
          text: { ...text, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.createAreaFile(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.file-area.save",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: { ...filePath, required: true },
          baseHash: requiredText,
          text: { ...text, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.saveAreaFile(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.file-area.rename",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: { ...filePath, required: true },
          destination: { ...filePath, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.renameAreaItem(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.file-area.mkdir",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: { ...filePath, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.createAreaFolder(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.file-area.delete",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: { ...filePath, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.deleteAreaItem(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.file-area.transfer",
      input: {
        schema: createSchema({
          sessionId: { ...identity, required: false },
          area: { ...fileArea, required: true },
          path: { ...filePath, required: true },
          mode: { type: "string", enum: ["copy", "move"], required: true },
          targetArea: { ...fileArea, required: true },
          targetPath: filePath,
          targetSessionId: { ...identity, required: false },
          conflict
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.transferAreaItem(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.integrations.read",
      input: { schema: createSchema({ sessionId: identity }), mode: "create" },
      extensions: { assistant: integrationReadTool("integrations.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readIntegrations(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.integrations.providers.read",
      input: {
        schema: createSchema({
          sessionId: identity,
          search: { ...text, maxLength: 200 },
          offset: { type: "integer", min: 0, required: false }
        }),
        mode: "create"
      },
      extensions: { assistant: integrationReadTool("integrations.providers.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readIntegrationProviders(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.integrations.n8n.discover",
      input: { schema: createSchema({ sessionId: identity, serverUrl: requiredText }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.discoverN8nIntegration(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.integrations.save",
      input: {
        schema: createSchema({
          sessionId: identity,
          ...integration,
          baseHash: { ...reviewId, nullable: true, required: true },
          configuration: { type: "object", schema: integrationsSchema, required: false },
          changes: { type: "object", schema: integrationConfigurationChangesSchema, required: false }
        }),
        mode: "create"
      },
      extensions: { assistant: integrationReadTool("integrations.save"), vibe64: PROJECT_OPERATION },
      execute: (input) => announceChange(input.baseHash === null ? "created" : "saved", sourceEditor.saveIntegrations(input))
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.integrations.oauth-client.register",
      input: {
        schema: createSchema({
          sessionId: identity,
          ...integration,
          integrationId: identity,
          callbackUrl: requiredText
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => announceChange(input.baseHash === null ? "created" : "saved", sourceEditor.registerOAuthIntegration(input))
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.integrations.setup",
      input: {
        schema: createSchema({
          sessionId: identity,
          ...integrationSetupInputSchema.getFieldDefinitions(),
          setupRequest: { type: "object", schema: setupRequest, required: false }
        }),
        mode: "create"
      },
      extensions: { assistant: integrationSetupTool(), vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.runIntegrationSetup({ ...input, environment: "development" })
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.tree.read",
      input: {
        schema: createSchema({
          sessionId: identity,
          path: filePath,
          limit: text,
          offset: text
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readTree(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.files.find",
      input: {
        schema: createSchema({
          sessionId: identity,
          query: text,
          limit: text
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.listFiles(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.file.download",
      input: { schema: createSchema({ sessionId: identity, path: { ...filePath, required: true } }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.downloadFile(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.stars.read",
      input: { schema: createSchema({ sessionId: identity }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readStarredFiles(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.star.set",
      input: {
        schema: createSchema({
          sessionId: identity,
          path: { ...filePath, required: true },
          starred: { type: "boolean", required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.setStarredFile(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.search",
      input: {
        schema: createSchema({
          sessionId: identity,
          query: text,
          limit: text
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.search(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.path.resolve",
      input: {
        schema: createSchema({
          sessionId: identity,
          fromPath: filePath,
          target: requiredText
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.resolvePath(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.explanations.cleanup",
      input: {
        schema: createSchema({
          sessionId: identity,
          activeExplanationIds: { type: "array", items: { type: "string" }, required: false },
          originId: text
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.cleanupExplanations(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.explanation.delete",
      input: { schema: createSchema({ sessionId: identity, explanationId: identity }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.deleteExplanation(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.explanation.stop",
      input: { schema: createSchema({ sessionId: identity, explanationId: identity }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.stopExplanation(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: "vibe64.source-editor.file.read",
      input: { schema: createSchema({ sessionId: identity, path: { ...filePath, required: true } }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readFile(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.file.create",
      input: {
        schema: createSchema({
          sessionId: identity,
          ...origin,
          path: { ...filePath, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => announceChange("created", sourceEditor.createFile(input))
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: "vibe64.source-editor.file.save",
      input: {
        schema: createSchema({
          sessionId: identity,
          ...origin,
          path: { ...filePath, required: true },
          baseHash: requiredText,
          text: { ...text, required: true }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => announceChange("saved", sourceEditor.saveFile(input))
    })
  ]);
}

export { createSourceEditorActions, explanationFollowupStreamSchema, explanationStreamSchema };
