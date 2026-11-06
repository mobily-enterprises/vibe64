import { readCodexCustomModels } from "@jskit-ai/assistant-core/server/codex-configuration";
import { runCodexAppServerProcess } from "@jskit-ai/assistant-core/server/codex-process";
import { CODEX_CUSTOM_HOME_ENV, codexProviderModelCatalog } from "@local/vibe64-core/server/codexProviderConnections";

const [runtimeDir, command, ...args] = process.argv.slice(2);
await runCodexAppServerProcess({
  runtimeDir,
  command,
  args,
  runtimeToken: process.env.VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN,
  bundled: process.env.VIBE64_CODEX_MODEL_CATALOG_SOURCE === "bundled",
  // The owner's custom endpoint names its model only in its saved home.
  additionalModels: [
    ...codexProviderModelCatalog().models,
    ...process.env[CODEX_CUSTOM_HOME_ENV] ? await readCodexCustomModels(process.env[CODEX_CUSTOM_HOME_ENV]) : []
  ],
  env: process.env
});
