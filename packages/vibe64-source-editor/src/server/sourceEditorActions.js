import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { integrationsSchema } from "@jskit-ai/connectors-core/shared/configuration";
import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { integrationReadTool, integrationSetupTool } from "./integrationAssistantContracts.js";
import { integrationSetupInputSchema } from "./integrationSetupInput.js";
import { integrationConfigurationChangesSchema } from "./integrationConfigurationInput.js";

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
  requestId: { ...reviewId, required: true }, configurationHash: { ...reviewId, required: true }
});
const selection = {
  path: { ...filePath, required: true }, startLine: { type: "integer", min: 1, required: true },
  startColumn: { type: "integer", min: 1, required: false }, endLine: { type: "integer", min: 1, required: true },
  endColumn: { type: "integer", min: 1, required: false },
  presentation: { type: "string", enum: ["description", "steps"], required: false },
  symbolId: { ...text, minLength: 1, maxLength: 4096 },
  expectedHash: { ...text, minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
  scope: { type: "string", enum: ["file", "selection"], required: false },
  force: { type: "boolean", defaultTo: false, required: false }, originId: text
};
// The explanation stream routes carry the transport's message identities; they
// stream directly instead of returning an action result.
const messageId = { ...text, maxLength: 256 };
const explanationStreamSchema = createSchema({
  sessionId: identity, ...selection, explanationId: { ...identity, required: false },
  assistantMessageId: messageId, userMessageId: messageId
});
const explanationFollowupStreamSchema = createSchema({
  sessionId: identity, explanationId: identity, message: requiredText,
  assistantMessageId: messageId, userMessageId: messageId
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
      id: "vibe64.source-editor.file-areas.read", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "areas")
    }),
    // Project areas need no session; the service requires one for session areas.
    Object.freeze({
      id: "vibe64.source-editor.file-area.tree", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: filePath,
        offset: text
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "tree", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.file", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: { ...filePath, required: true }
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "file", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.download", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: { ...filePath, required: true }
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "download", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.archive", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: { ...identity, required: false }, area: { ...fileArea, required: true }, path: filePath }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "archive", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.conflicts", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: filePath,
        names: { type: "array", items: { type: "string" }, required: true }
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "conflicts", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.upload", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: filePath,
        conflict: { ...conflict, enum: ["fail", "replace", "keep-both"] }
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sourceEditor.fileArea(input, "upload", { readUpload: context.sourceEditorUpload?.readUpload })
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.create", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: { ...filePath, required: true },
        text: { ...text, required: true }
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "create", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.save", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: { ...filePath, required: true },
        baseHash: requiredText,
        text: { ...text, required: true }
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "save", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.rename", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: { ...filePath, required: true },
        destination: { ...filePath, required: true }
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "rename", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.mkdir", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: { ...filePath, required: true }
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "mkdir", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.delete", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: { ...filePath, required: true }
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "delete", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.file-area.transfer", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({
        sessionId: { ...identity, required: false },
        area: { ...fileArea, required: true },
        path: { ...filePath, required: true },
        mode: { type: "string", enum: ["copy", "move"], required: true },
        targetArea: { ...fileArea, required: true },
        targetPath: filePath,
        targetSessionId: { ...identity, required: false },
        conflict
      }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.fileArea(input, "transfer", {})
    }),
    Object.freeze({
      id: "vibe64.source-editor.integrations.read", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity }), mode: "create" }, output: null,
      extensions: { assistant: integrationReadTool("integrations.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readIntegrations(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.integrations.providers.read", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity, search: { ...text, maxLength: 200 }, offset: { type: "integer", min: 0, required: false } }), mode: "create" }, output: null,
      extensions: { assistant: integrationReadTool("integrations.providers.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readIntegrationProviders(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.integrations.n8n.discover", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity, serverUrl: requiredText }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.discoverN8nIntegration(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.integrations.save", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({ sessionId: identity, ...integration,
        baseHash: { ...reviewId, nullable: true, required: true },
        configuration: { type: "object", schema: integrationsSchema, required: false },
        changes: { type: "object", schema: integrationConfigurationChangesSchema, required: false } }), mode: "create" }, output: null,
      extensions: { assistant: integrationReadTool("integrations.save"), vibe64: PROJECT_OPERATION },
      execute: (input) => announceChange(input.baseHash === null ? "created" : "saved", sourceEditor.saveIntegrations(input))
    }),
    Object.freeze({
      id: "vibe64.source-editor.integrations.oauth-client.register", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({ sessionId: identity, ...integration, integrationId: identity, callbackUrl: requiredText }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => announceChange(input.baseHash === null ? "created" : "saved", sourceEditor.registerOAuthIntegration(input))
    }),
    Object.freeze({
      id: "vibe64.source-editor.integrations.setup", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({ sessionId: identity, ...integrationSetupInputSchema.getFieldDefinitions(),
        setupRequest: { type: "object", schema: setupRequest, required: false } }), mode: "create" }, output: null,
      extensions: { assistant: integrationSetupTool(), vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.runIntegrationSetup({ ...input, environment: "development" })
    }),
    Object.freeze({
      id: "vibe64.source-editor.tree.read", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity, path: filePath, limit: text, offset: text }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readTree(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.files.find", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity, query: text, limit: text }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.listFiles(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.file.download", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity, path: { ...filePath, required: true } }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.downloadFile(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.stars.read", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readStarredFiles(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.star.set", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({ sessionId: identity, path: { ...filePath, required: true }, starred: { type: "boolean", required: true } }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.setStarredFile(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.search", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity, query: text, limit: text }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.search(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.path.resolve", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity, fromPath: filePath, target: requiredText }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.resolvePath(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.explanations.cleanup", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({ sessionId: identity, activeExplanationIds: { type: "array", items: { type: "string" }, required: false }, originId: text }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.cleanupExplanations(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.explanation.delete", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({ sessionId: identity, explanationId: identity }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.deleteExplanation(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.explanation.stop", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({ sessionId: identity, explanationId: identity }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.stopExplanation(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.file.read", version: 1, kind: "query", idempotency: "none",
      input: { schema: createSchema({ sessionId: identity, path: { ...filePath, required: true } }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sourceEditor.readFile(input)
    }),
    Object.freeze({
      id: "vibe64.source-editor.file.create", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({ sessionId: identity, ...origin, path: { ...filePath, required: true } }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => announceChange("created", sourceEditor.createFile(input))
    }),
    Object.freeze({
      id: "vibe64.source-editor.file.save", version: 1, kind: "command", idempotency: "optional",
      input: { schema: createSchema({ sessionId: identity, ...origin, path: { ...filePath, required: true }, baseHash: requiredText, text: { ...text, required: true } }), mode: "create" }, output: null,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => announceChange("saved", sourceEditor.saveFile(input))
    })
  ]);
}

export { createSourceEditorActions, explanationFollowupStreamSchema, explanationStreamSchema };
