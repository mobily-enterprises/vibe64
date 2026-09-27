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
  const sessions = new Map();
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

  async function save() {
    const write = pending.catch(() => {}).then(async () => {
      const temporary = path.join(directory, "sessions.tmp");
      await writeFile(temporary, JSON.stringify({ sessions: [...sessions.values()] }), { mode: 0o600 });
      await rename(temporary, registryPath);
    });
    pending = write;
    await write;
  }

  await save();
  return {
    registryPath,
    async register(providerSessionId, promptContext, workdir = "") {
      if (closed) throw new Error("The Genesis host context registry is closed.");
      if (typeof providerSessionId !== "string" || !providerSessionId.trim()) {
        throw new TypeError("Genesis host context requires a native conversation ID.");
      }
      vibe64Driver(promptContext);
      sessions.set(providerSessionId, { upstreamSessionId: providerSessionId, workdir, promptContext: structuredClone(promptContext) });
      await save();
    },
    async close() {
      closed = true;
      await pending.catch(() => {});
      sessions.clear();
      if (!runtimeDirectory) await rm(directory, { recursive: true, force: true });
    }
  };
}
