import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createCurrentAppActions } from "./currentAppActions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("./types.js").CurrentAppService} CurrentAppService */

const CurrentAppFeature = defineFeature({
  id: "vibe64.current-app",
  domain: "vibe64-current-app",
  requires: {
    env: "runtime.env",
    http: "runtime.http",
    project: "vibe64.project"
  },
  provides: {
    currentApp: "vibe64.current-app"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeHttp} capabilities.http
   * @param {ProjectService} capabilities.project
   */
  setup({
    env,
    http,
    project
  }) {
    const currentApp = createService({
      env,
      project
    });
    registerRoutes(http, { localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }), projectContext: getStudioProjectContext() });
    return { currentApp };
  },
  /**
   * @param {object} capabilities
   * @param {CurrentAppService} capabilities.currentApp
   */
  actions({ currentApp }) {
    return createCurrentAppActions({ currentApp });
  }
});

export { CurrentAppFeature };
