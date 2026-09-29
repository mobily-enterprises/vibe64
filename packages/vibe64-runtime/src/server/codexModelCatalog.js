import { execFile } from "node:child_process";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { codexProviderModelCatalog } from "@local/vibe64-core/server/codexProviderConnections";

const execute = promisify(execFile);

// Codex's model manager reads model_catalog_json once, before any threads
// exist. A thread override changes routing, but cannot supply model metadata.
// Export from the installed CLI so native model definitions stay CLI-owned.
async function prepareCodexModelCatalog({ command, runtimeDir, bundled = false, signal }) {
  let catalog;
  const models = new Map();
  try {
    const { stdout } = await execute(command, [
      "debug", "models", ...(bundled ? ["--bundled"] : []),
      "-c", "check_for_update_on_startup=false"
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 20_000, signal });
    catalog = JSON.parse(stdout);
    if (!Array.isArray(catalog?.models) || !catalog.models.length) {
      throw new Error("Invalid native model catalogue");
    }
    for (const model of catalog.models) {
      if (!model || typeof model.slug !== "string" || !model.slug.trim() || models.has(model.slug)) {
        throw new Error("Invalid native model catalogue");
      }
      models.set(model.slug, model);
    }
  } catch {
    // CLI output can contain provider configuration. Never include it here.
    throw new Error("Codex could not load its model catalogue. Restart the assistant service after checking the Codex installation and connection.");
  }
  // Adding foreign metadata must not change the native default model.
  let priority = catalog.models.reduce((maximum, model) => Math.max(maximum, model.priority || 0), 0);
  for (const model of codexProviderModelCatalog().models) {
    models.set(model.slug, { ...model, priority: ++priority });
  }
  const catalogPath = path.join(runtimeDir, "models.json");
  const temporary = `${catalogPath}.tmp`;
  try {
    signal?.throwIfAborted();
    await writeFile(temporary, JSON.stringify({ ...catalog, models: [...models.values()] }), { mode: 0o600 });
    await rename(temporary, catalogPath);
  } finally {
    await rm(temporary, { force: true });
  }
  return catalogPath;
}

export { prepareCodexModelCatalog };
