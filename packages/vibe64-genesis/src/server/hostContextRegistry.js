import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { vibe64Driver } from "./promptContext.js";

// One Vibe64 process can share a native agent process across several projects.
// Keep its hook bindings together; project-local hooks supply the native ID.
// Retain bindings across transport stops, including an attached native terminal.
export async function createVibe64HostContextRegistry(runtimeDirectory = "") {
  const directory = runtimeDirectory || await mkdtemp(path.join(os.tmpdir(), "vibe64-genesis-context-"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const registryPath = path.join(directory, "sessions.json");
  let sessions = new Map();
  try {
    const saved = JSON.parse(await readFile(registryPath, "utf8"));
    for (const entry of saved.sessions) {
      vibe64Driver(entry.promptContext);
      sessions.set(entry.upstreamSessionId, entry);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let pending = Promise.resolve();
  let closed = false;

  async function save(next) {
    const temporary = path.join(directory, "sessions.tmp");
    await writeFile(temporary, JSON.stringify({ sessions: [...next.values()] }), { mode: 0o600 });
    await rename(temporary, registryPath);
  }

  await save(sessions);
  return {
    registryPath,
    get(providerSessionId) { return structuredClone(sessions.get(providerSessionId)); },
    async register(providerSessionId, promptContext, workdir = "") {
      if (closed) throw new Error("The Genesis host context registry is closed.");
      if (typeof providerSessionId !== "string" || !providerSessionId.trim()) {
        throw new TypeError("Genesis host context requires a native conversation ID.");
      }
      const context = structuredClone(promptContext);
      vibe64Driver(context);
      const entry = { upstreamSessionId: providerSessionId, workdir, promptContext: context };
      // This records delivery ownership, not prompt installation. Publish a
      // binding only after hooks can read the same durable entry.
      const write = pending.catch(() => {}).then(async () => {
        if (JSON.stringify(sessions.get(providerSessionId)) === JSON.stringify(entry)) return;
        const next = new Map(sessions);
        next.set(providerSessionId, entry);
        await save(next);
        sessions = next;
      });
      pending = write;
      await write;
    },
    async close() {
      closed = true;
      await pending.catch(() => {});
      sessions.clear();
      if (!runtimeDirectory) await rm(directory, { recursive: true, force: true });
    }
  };
}
