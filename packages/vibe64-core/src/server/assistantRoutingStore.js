import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const writes = new Map();
const routingRoles = ["plan", "code", "economy", "router", "sharedBackup"];
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

function validateAssistantRoutingConfiguration(value, { legacy = false } = {}) {
  const invalid = () => { throw new Error("Saved model routing has an unsupported shape. Restore or repair the settings before changing them."); };
  if (!object(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !object(value.orchestrators) || !(legacy ? [1, 2] : [2]).includes(value.schemaVersion)) invalid();
  const assignment = (entry) => {
    if (!object(entry) || entry.schema !== "vibe64.assistant-selection.v1" ||
        Object.keys(entry).some((key) => !["schema", "engineId", "agentId", "modelProviderId", "modelId", "variantId", "catalogRevision", "selectionSource"].includes(key)) ||
        !["codex", "claude", "opencode"].includes(entry.engineId) ||
        !/^sha256:[a-f0-9]{64}$/u.test(entry.catalogRevision || "") ||
        !["engineId", "agentId", "modelProviderId", "modelId", "variantId"].every((name) =>
          typeof entry[name] === "string" && entry[name].length <= 512 &&
          (name === "variantId" || entry[name].trim().length) && !/[\x00-\x1f\x7f]/u.test(entry[name])) ||
        !(legacy && entry.selectionSource === undefined || ["recommended", "explicit"].includes(entry.selectionSource))) invalid();
  };
  for (const [engineId, roles] of Object.entries(value.orchestrators)) {
    if (!["codex", "claude", "opencode"].includes(engineId) || !object(roles) ||
        Object.keys(roles).some((key) => ![...routingRoles, "helperRoutingReview"].includes(key))) invalid();
    for (const role of routingRoles) {
      if (roles[role] == null) continue;
      assignment(roles[role]);
      if (["plan", "code"].includes(role) && roles[role].engineId !== engineId) invalid();
    }
    if (roles.helperRoutingReview !== undefined) {
      const review = roles.helperRoutingReview;
      if (!object(review) || Object.keys(review).some((key) => !["reason", "previous", "proposed"].includes(key)) ||
          review.reason !== "legacy_helpers_differ" || !Array.isArray(review.previous) ||
          !review.previous.length || review.previous.some((entry) => !object(entry) ||
            Object.keys(entry).some((key) => !["engineId", "modelProviderId", "modelId", "selectionSource"].includes(key)) ||
            !["codex", "claude", "opencode"].includes(entry.engineId) ||
            !["modelProviderId", "modelId"].every((key) => typeof entry[key] === "string" && entry[key].length > 0 && entry[key].length <= 512 && !/[\x00-\x1f\x7f]/u.test(entry[key])) ||
            !["explicit", "default"].includes(entry.selectionSource))) invalid();
      if (review.proposed != null) assignment(review.proposed);
    }
  }
  return value;
}

function createAssistantRoutingStore({ systemRoot } = {}) {
  if (!path.isAbsolute(systemRoot || "")) throw new Error("Model routing requires the private workspace system root.");
  const filePath = path.join(systemRoot, "ai-connections", "routing.json");
  async function read() {
    try {
      const value = JSON.parse(await readFile(filePath, "utf8"));
      if (value.schemaVersion === 1) {
        throw Object.assign(new Error("Model routing needs the stopped-service state upgrade. Run the candidate release's upgrade-state command before starting it."), {
          code: "vibe64_assistant_routing_upgrade_required"
        });
      }
      return validateAssistantRoutingConfiguration(value);
    } catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 2, revision: 0, orchestrators: {} };
      if (error instanceof SyntaxError) throw new Error("Saved model routing is unreadable. Restore or repair the settings before changing them.");
      throw error;
    }
  }
  async function write(orchestrators, expectedRevision) {
    const previous = writes.get(filePath) || Promise.resolve();
    const operation = previous.catch(() => null).then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) throw Object.assign(new Error("Model routing changed in another tab. Reload and review the current choices."), {
        code: "vibe64_assistant_routing_stale", statusCode: 409
      });
      const next = validateAssistantRoutingConfiguration({ schemaVersion: 2, revision: current.revision + 1, orchestrators });
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: "wx" });
        await rename(temporary, filePath);
      } finally { await rm(temporary, { force: true }); }
      return next;
    });
    writes.set(filePath, operation);
    try { return await operation; } finally { if (writes.get(filePath) === operation) writes.delete(filePath); }
  }
  return { read, write };
}

export { createAssistantRoutingStore, validateAssistantRoutingConfiguration };
