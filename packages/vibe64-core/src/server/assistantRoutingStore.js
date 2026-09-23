import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const writes = new Map();

function createAssistantRoutingStore({ systemRoot } = {}) {
  if (!path.isAbsolute(systemRoot || "")) throw new Error("Model routing requires the private workspace system root.");
  const filePath = path.join(systemRoot, "ai-connections", "routing.json");
  async function read() {
    try {
      const value = JSON.parse(await readFile(filePath, "utf8"));
      if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
          !value.orchestrators || typeof value.orchestrators !== "object" || Array.isArray(value.orchestrators)) {
        throw new Error("Saved model routing is unreadable. Restore or repair the settings before changing them.");
      }
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 1, revision: 0, orchestrators: {} };
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
      const next = { schemaVersion: 1, revision: current.revision + 1, orchestrators };
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

export { createAssistantRoutingStore };
