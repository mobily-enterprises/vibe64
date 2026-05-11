import { createTransientRetryHttpClient } from "@jskit-ai/http-runtime/client";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";

const BOOTSTRAP_ENDPOINT = resolveScopedApiBasePath({
  routeBase: "/",
  relativePath: "studio/bootstrap",
  strictParams: false
});

const TARGET_APP_ENDPOINT = resolveScopedApiBasePath({
  routeBase: "/",
  relativePath: "studio/target-app",
  strictParams: false
});

const CURRENT_APP_ENDPOINT = resolveScopedApiBasePath({
  routeBase: "/",
  relativePath: "studio/current-app",
  strictParams: false
});

const BOOTSTRAP_TERMINAL_ENDPOINT = `${BOOTSTRAP_ENDPOINT}/terminal`;
const TARGET_APP_TERMINAL_ENDPOINT = `${TARGET_APP_ENDPOINT}/terminal`;

const studioHttpClient = createTransientRetryHttpClient({
  credentials: "include",
  csrf: {
    enabled: false
  }
});

async function readBootstrapStatus() {
  return studioHttpClient.get(BOOTSTRAP_ENDPOINT);
}

async function readTargetAppStatus() {
  return studioHttpClient.get(TARGET_APP_ENDPOINT);
}

async function readCurrentApp() {
  return studioHttpClient.get(CURRENT_APP_ENDPOINT);
}

async function resolveStudioGate() {
  const bootstrap = await readBootstrapStatus();
  if (bootstrap?.ready !== true) {
    return {
      bootstrap,
      route: "/bootup"
    };
  }

  const targetApp = await readTargetAppStatus();
  if (targetApp?.ready !== true) {
    return {
      bootstrap,
      route: "/app-bootup",
      targetApp
    };
  }

  return {
    bootstrap,
    route: "/home",
    targetApp
  };
}

export {
  BOOTSTRAP_ENDPOINT,
  BOOTSTRAP_TERMINAL_ENDPOINT,
  CURRENT_APP_ENDPOINT,
  TARGET_APP_ENDPOINT,
  TARGET_APP_TERMINAL_ENDPOINT,
  readBootstrapStatus,
  readCurrentApp,
  readTargetAppStatus,
  resolveStudioGate,
  studioHttpClient
};
