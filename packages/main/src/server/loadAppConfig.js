import { loadAppConfigFromModuleUrl } from "@jskit-ai/kernel/server/support";

async function loadAppConfig({ moduleUrl = import.meta.url } = {}) {
  return loadAppConfigFromModuleUrl({
    moduleUrl
  });
}

export { loadAppConfig };
