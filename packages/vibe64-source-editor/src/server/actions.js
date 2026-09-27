import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

const text = { type: "string", noTrim: true, required: false };
const requiredText = { ...text, minLength: 1, required: true };
const identity = { ...requiredText, maxLength: 256 };
const filePath = { ...text, maxLength: 4096 };
const object = { type: "object", additionalProperties: true, required: false };
const origin = { originId: text, projectSlug: text };
const selection = {
  path: { ...filePath, required: true }, startLine: { type: "integer", min: 1, required: true },
  startColumn: { type: "integer", min: 1, required: false }, endLine: { type: "integer", min: 1, required: true },
  endColumn: { type: "integer", min: 1, required: false },
  force: { type: "boolean", defaultTo: false, required: false }, originId: text
};

function createSourceEditorActions({ sourceEditor, publishFileChanged = async () => {} }) {
  const action = (name, fields, execute, { kind = "command", changed = null } = {}) => withVibe64ActionContext({
    id: `vibe64.source-editor.${name}`, version: 1, kind,
    input: { schema: createSchema({ sessionId: identity, ...fields }), mode: "create" },
    output: null, idempotency: kind === "query" ? "none" : "optional",
    // Source/engineering access remains with coding agents, not Colleague.
    extensions: { assistant: { exclude: true } },
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
    action("integrations.read", {}, (input) => sourceEditor.readIntegrations(input), query),
    action("integrations.n8n.discover", { serverUrl: requiredText }, (input) => sourceEditor.discoverN8nIntegration(input), query),
    action("integrations.save", integration, (input) => sourceEditor.saveIntegrations(input), { changed: (input) => input.baseHash === null ? "created" : "saved" }),
    action("integrations.oauth-client.register", { ...integration, integrationId: identity, callbackUrl: requiredText },
      (input) => sourceEditor.registerOAuthIntegration(input), { changed: (input) => input.baseHash === null ? "created" : "saved" }),
    action("integrations.setup", { integrationId: identity, operation: requiredText, attemptId: text,
      setupRequest: object, verificationInput: object, ads: object, paymentEnvironment: text, reviewId: text,
      providerId: text, subjectId: text, collection: text, after: { ...text, nullable: true } },
    (input) => sourceEditor.runIntegrationSetup({ ...input, environment: "development" })),
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
