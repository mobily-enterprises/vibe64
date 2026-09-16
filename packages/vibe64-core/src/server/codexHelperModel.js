import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CODEX_RECOMMENDED_HELPER_MODEL = "gpt-5.6-luna";

function normalizeHelperModelId(value) {
  if (typeof value !== "string" || value.length > 200 || /\s/u.test(value) ||
      [...value].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error("Choose a helper model or Recommended.");
  }
  return value;
}

function createCodexHelperModelStore({ systemRoot } = {}) {
  if (!systemRoot) throw new Error("Codex helper settings require the Vibe64 system root.");
  const filePath = path.join(systemRoot, "ai-connections", "codex-helper-model.json");
  return {
    async read() {
      try {
        const value = JSON.parse(await readFile(filePath, "utf8"));
        return normalizeHelperModelId(value.modelId);
      } catch (error) {
        if (error.code === "ENOENT") return "";
        throw error;
      }
    },
    async write(modelId) {
      const value = normalizeHelperModelId(modelId);
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify({ modelId: value })}\n`, { mode: 0o600, flag: "wx" });
        await rename(temporaryPath, filePath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      return value;
    }
  };
}

export { CODEX_RECOMMENDED_HELPER_MODEL, createCodexHelperModelStore, normalizeHelperModelId };
