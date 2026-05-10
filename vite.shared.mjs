import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VITE_DEV_PROXY_CONFIG_RELATIVE_PATH = ".jskit/vite.dev.proxy.json";

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function loadViteDevProxyEntries({ appRootUrl = import.meta.url, fallbackTarget = "" } = {}) {
  const appRootPath = fileURLToPath(new URL(".", appRootUrl));
  const absoluteConfigPath = path.join(appRootPath, VITE_DEV_PROXY_CONFIG_RELATIVE_PATH);
  if (!existsSync(absoluteConfigPath)) {
    return Object.freeze({});
  }

  let source = {};
  try {
    source = JSON.parse(readFileSync(absoluteConfigPath, "utf8"));
  } catch {
    return Object.freeze({});
  }

  const entries = Array.isArray(source?.entries) ? source.entries : [];
  const proxy = {};
  for (const entry of entries) {
    const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    const routePath = String(record.path || "").trim();
    if (!routePath || !routePath.startsWith("/")) {
      continue;
    }

    const target = String(record.target || "").trim() || String(fallbackTarget || "").trim();
    if (!target) {
      continue;
    }

    const proxyConfig = {
      target
    };
    if (Object.hasOwn(record, "changeOrigin")) {
      proxyConfig.changeOrigin = record.changeOrigin === true;
    }
    if (Object.hasOwn(record, "ws")) {
      proxyConfig.ws = record.ws === true;
    }

    proxy[routePath] = proxyConfig;
  }

  return Object.freeze(proxy);
}

export { toPositiveInt, loadViteDevProxyEntries };
