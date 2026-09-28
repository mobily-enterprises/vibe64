import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { integrationReadTool, integrationSetupTool } from "./integrationAssistantContracts.js";
import { INTEGRATION_SETUP_OPERATIONS } from "./integrationSetupCommand.js";

const text = { type: "string", noTrim: true, required: false };
const requiredText = { ...text, minLength: 1, required: true };
const identity = { ...requiredText, maxLength: 256 };
const filePath = { ...text, maxLength: 4096 };
const object = { type: "object", additionalProperties: true, required: false };
const origin = { originId: text, projectSlug: text };
const reviewId = { ...text, minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" };
const adsSelection = createSchema({
  customerId: { ...text, pattern: "^[0-9]{10}$" }, name: { ...text, minLength: 1, maxLength: 100 },
  campaignId: { ...text, pattern: "^[0-9]{1,20}$" }, reviewId,
  trackingConfirmed: { type: "boolean", strictBoolean: true, required: false },
  billingConfirmed: { type: "boolean", strictBoolean: true, required: false }
});
const setupRequest = createSchema({
  turnId: { ...requiredText, pattern: "^[0-9]{6,32}$" },
  requestId: { ...reviewId, required: true }, configurationHash: { ...reviewId, required: true }
});
const selection = {
  path: { ...filePath, required: true }, startLine: { type: "integer", min: 1, required: true },
  startColumn: { type: "integer", min: 1, required: false }, endLine: { type: "integer", min: 1, required: true },
  endColumn: { type: "integer", min: 1, required: false },
  force: { type: "boolean", defaultTo: false, required: false }, originId: text
};

function createSourceEditorActions({ sourceEditor, publishFileChanged = async () => {} }) {
  const action = (name, fields, execute, { kind = "command", changed = null, assistant = { exclude: true } } = {}) => withVibe64ActionContext({
    id: `vibe64.source-editor.${name}`, version: 1, kind,
    input: { schema: createSchema({ sessionId: identity, ...fields }), mode: "create" },
    output: null, idempotency: kind === "query" ? "none" : "optional",
    // Only explicit product controls are exposed; source work stays with coding agents.
    extensions: { assistant },
    async execute(input, context) {
      const result = await execute(input, context);
      if (changed) await publishFileChanged(result, { operation: typeof changed === "function" ? changed(input) : changed });
      return result;
    }
  });
  const query = { kind: "query" };
  const integration = { ...origin, baseHash: { ...text, nullable: true, required: true }, configuration: { ...object, required: true } };
  return [
    action("file-areas.read", {}, (input) => sourceEditor.fileArea(input, "areas"), query),
    ...["tree", "file", "download", "archive", "upload", "save", "rename", "mkdir", "delete"].map((operation) => action(`file-area.${operation}`, {
      area: { type: "string", enum: ["session", "drop-zone"], required: true },
      path: { ...filePath, required: !["tree", "archive", "upload"].includes(operation) },
      ...(operation === "tree" ? { offset: text } : {}),
      ...(operation === "rename" ? { destination: { ...filePath, required: true } } : {}),
      ...(operation === "save" ? { baseHash: requiredText, text: { ...text, required: true } } : {})
    }, (input, context) => sourceEditor.fileArea(input, operation,
      operation === "upload" ? { readUpload: context.sourceEditorUpload?.readUpload } : {}),
    ["tree", "file", "download", "archive"].includes(operation) ? query : {})),
    action("integrations.read", {}, (input) => sourceEditor.readIntegrations(input), { ...query, assistant: integrationReadTool("integrations.read") }),
    action("integrations.providers.read", {
      search: { ...text, maxLength: 200 }, offset: { type: "integer", min: 0, required: false }
    }, (input) => sourceEditor.readIntegrationProviders(input), { ...query, assistant: integrationReadTool("integrations.providers.read") }),
    action("integrations.n8n.discover", { serverUrl: requiredText }, (input) => sourceEditor.discoverN8nIntegration(input), query),
    action("integrations.save", integration, (input) => sourceEditor.saveIntegrations(input), { changed: (input) => input.baseHash === null ? "created" : "saved" }),
    action("integrations.oauth-client.register", { ...integration, integrationId: identity, callbackUrl: requiredText },
      (input) => sourceEditor.registerOAuthIntegration(input), { changed: (input) => input.baseHash === null ? "created" : "saved" }),
    action("integrations.setup", {
      integrationId: { ...identity, maxLength: 200, pattern: "^[a-z][a-z0-9-]*$" },
      operation: { ...requiredText, enum: INTEGRATION_SETUP_OPERATIONS },
      attemptId: { ...text, pattern: "^[A-Za-z0-9_-]{1,256}$" },
      setupRequest: { type: "object", schema: setupRequest, required: false }, verificationInput: object,
      ads: { type: "object", schema: adsSelection, required: false },
      paymentEnvironment: { ...text, enum: ["sandbox", "live"] }, reviewId,
      providerId: { ...text, pattern: "^[A-Za-z0-9_-]{1,200}$" }, subjectId: { ...text, minLength: 1, maxLength: 200 },
      collection: { ...text, enum: ["subscriptions", "transactions"] }, after: { ...text, nullable: true, pattern: "^[A-Za-z0-9_-]{1,200}$" }
    }, (input) => sourceEditor.runIntegrationSetup({ ...input, environment: "development" }), { assistant: integrationSetupTool() }),
    action("tree.read", { path: filePath, limit: text, offset: text }, (input) => sourceEditor.readTree(input), query),
    action("files.find", { query: text, limit: text }, (input) => sourceEditor.listFiles(input), query),
    action("file.download", { path: { ...filePath, required: true } }, (input) => sourceEditor.downloadFile(input), query),
    action("stars.read", {}, (input) => sourceEditor.readStarredFiles(input), query),
    action("star.set", { path: { ...filePath, required: true }, starred: { type: "boolean", required: true } }, (input) => sourceEditor.setStarredFile(input)),
    action("search", { query: text, limit: text }, (input) => sourceEditor.search(input), query),
    action("path.resolve", { fromPath: filePath, target: requiredText }, (input) => sourceEditor.resolvePath(input), query),
    action("explanation.create", selection, (input) => sourceEditor.explainSelection(input)),
    action("explanations.cleanup", { activeExplanationIds: { type: "array", items: { type: "string" }, required: false }, originId: text }, (input) => sourceEditor.cleanupExplanations(input)),
    action("explanation.delete", { explanationId: identity }, (input) => sourceEditor.deleteExplanation(input)),
    action("explanation.stop", { explanationId: identity }, (input) => sourceEditor.stopExplanation(input)),
    action("explanation.followup", { explanationId: identity, message: requiredText }, (input) => sourceEditor.addExplanationFollowup(input)),
    action("file.read", { path: { ...filePath, required: true } }, (input) => sourceEditor.readFile(input), query),
    action("file.create", { ...origin, path: { ...filePath, required: true } }, (input) => sourceEditor.createFile(input), { changed: "created" }),
    action("file.save", { ...origin, path: { ...filePath, required: true }, baseHash: requiredText, text: { ...text, required: true } }, (input) => sourceEditor.saveFile(input), { changed: "saved" })
  ];
}

export { createSourceEditorActions };
