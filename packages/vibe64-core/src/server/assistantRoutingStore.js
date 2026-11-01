import { readFile } from "node:fs/promises";
import path from "node:path";
import { serializeByKey, writeFileAtomic } from "./atomicFile.js";
import { isPlainObject } from "./isPlainObject.js";
import { AppError } from "@jskit-ai/kernel/server/runtime";

const writes = new Map();
const setupRoles = Object.freeze({
  owner: ["senior", "junior", "router", "colleague", "fix", "explain", "quickHelper"],
  nonOwner: ["colleague", "fix", "explain", "quickHelper"]
});
const followingRoles = ["colleague", "fix", "explain"];
// eslint-disable-next-line no-control-regex -- Routing identifiers must exclude ASCII control characters.
const controlCharacters = /[\x00-\x1f\x7f]/u;

/**
 * Schema 5: the owner's setup (main chat and the owner's helpers) and the team
 * setup (everyone else's helpers). A role is absent, null (off), a selection,
 * or { follows } naming another role of the same setup, one level deep.
 */
function validateAssistantRoutingConfiguration(value) {
  const invalid = () => {
    throw new Error(
      "Saved model routing has an unsupported shape. Restore or repair the settings before changing them."
    );
  };
  if (!isPlainObject(value) || value.schemaVersion !== 5 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      Object.keys(value).some((key) => !["schemaVersion", "revision", "owner", "nonOwner"].includes(key)) ||
      !isPlainObject(value.owner) || !isPlainObject(value.nonOwner)) invalid();
  const assignment = (entry) => {
    if (!isPlainObject(entry) || entry.schema !== "vibe64.assistant-selection.v1" ||
        Object.keys(entry)
          .some((key) =>
            !["schema", "engineId", "agentId", "modelProviderId", "modelId", "variantId", "catalogRevision", "selectionSource"].includes(
              key
            )) ||
        !["codex", "claude", "opencode"].includes(entry.engineId) ||
        !/^sha256:[a-f0-9]{64}$/u.test(entry.catalogRevision || "") ||
        !["engineId", "agentId", "modelProviderId", "modelId", "variantId"].every((name) =>
          typeof entry[name] === "string" && entry[name].length <= 512 &&
          (name === "variantId" || entry[name].trim().length) && !controlCharacters.test(entry[name])) ||
        !["recommended", "explicit"].includes(entry.selectionSource)) invalid();
  };
  for (const [setup, roles] of Object.entries(setupRoles)) {
    const values = value[setup];
    if (Object.keys(values).some((key) => !roles.includes(key))) invalid();
    for (const [role, entry] of Object.entries(values)) {
      if (entry === null) continue;
      if (!isPlainObject(entry) || !Object.hasOwn(entry, "follows")) {
        assignment(entry);
        continue;
      }
      const target = values[entry.follows];
      if (Object.keys(entry).length !== 1 || !followingRoles.includes(role) || entry.follows === role ||
          !roles.includes(entry.follows) || isPlainObject(target) && Object.hasOwn(target, "follows")) invalid();
    }
  }
  const { senior, junior } = value.owner;
  if (isPlainObject(senior) && isPlainObject(junior) && senior.engineId !== junior.engineId) {
    throw new Error("Senior and Junior must run in the same tool.");
  }
  return value;
}

function createAssistantRoutingStore({ systemRoot } = {}) {
  if (!path.isAbsolute(systemRoot || "")) throw new Error("Model routing requires the private workspace system root.");
  const filePath = path.join(systemRoot, "ai-connections", "routing.json");
  async function read() {
    try {
      const value = JSON.parse(await readFile(filePath, "utf8"));
      if (value.schemaVersion !== 5) {
        throw new AppError(409, "Vibe64's saved AI settings need an upgrade. The workspace administrator must stop Vibe64, run this version's upgrade-state command, and restart it.", { code: "vibe64_assistant_routing_upgrade_required" });
      }
      return validateAssistantRoutingConfiguration(value);
    } catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 5, revision: 0, owner: {}, nonOwner: {} };
      if (error instanceof SyntaxError) {
        throw new Error("Saved model routing is unreadable. Restore or repair the settings before changing them.");
      }
      throw error;
    }
  }
  async function write({ owner, nonOwner }, expectedRevision) {
    return serializeByKey(writes, filePath, async () => {
      const current = await read();
      if (current.revision !== expectedRevision) throw new AppError(409, "Models changed in another tab. Reload and review the current choices.", { code: "vibe64_assistant_routing_stale" });
      const next = validateAssistantRoutingConfiguration({ schemaVersion: 5, revision: current.revision + 1, owner, nonOwner });
      await writeFileAtomic(filePath, `${JSON.stringify(next)}\n`, { directoryMode: 0o700, fileMode: 0o600 });
      return next;
    });
  }
  return Object.freeze({
    read,
    write
  });
}

export { createAssistantRoutingStore, validateAssistantRoutingConfiguration };
