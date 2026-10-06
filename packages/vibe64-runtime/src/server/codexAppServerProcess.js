import { runCodexAppServerProcess } from "@jskit-ai/assistant-core/server/codex-process";
import { codexProviderModelCatalog } from "@local/vibe64-core/server/codexProviderConnections";

const [runtimeDir, command, ...args] = process.argv.slice(2);
await runCodexAppServerProcess({
  runtimeDir,
  command,
  args,
  runtimeToken: process.env.VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN,
  bundled: process.env.VIBE64_CODEX_MODEL_CATALOG_SOURCE === "bundled",
  additionalModels: codexProviderModelCatalog().models
});
