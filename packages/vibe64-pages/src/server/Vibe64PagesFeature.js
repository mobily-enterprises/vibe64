import { defineFeature } from "@jskit-ai/kernel/server/features";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";

import { createPagesActions } from "./pagesActions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createPagesService } from "./service.js";

/** @typedef {import("./types.js").PagesService} PagesService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * Pages: AI-made HTML pages every project member can open, kept in the
 * project's Vibe64 state. The session agent's `vibe64-helper pages` command
 * reaches this service through Terminals. Scheduled refreshes run on this server.
 */
const Vibe64PagesFeature = defineFeature({
  id: "vibe64.pages",
  domain: "vibe64-pages",
  requires: {
    env: "runtime.env",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    terminals: "vibe64.terminals"
  },
  provides: {
    pages: "vibe64.pages"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {TerminalsService} capabilities.terminals
   */
  setup({ env, http, logger, project, terminals }) {
    const pages = createPagesService({ now: () => new Date().toISOString(), clock: Date.now, project, logger });
    registerRoutes(http, {
      localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }),
      projectContext: getStudioProjectContext(),
      pages
    });
    // readable-check: allow setter-seam - cycle: vibe64.pages requires vibe64.terminals, whose agent command publishes pages
    terminals.setPagesProvider(pages);
    return { pages };
  },
  /**
   * @param {object} capabilities
   * @param {PagesService} capabilities.pages
   */
  actions({ pages }) {
    return createPagesActions({ pages });
  },
  /**
   * Picks up every project's refresh schedules.
   * @param {object} _capabilities
   * @param {{ outputs: { pages: PagesService } }} context
   */
  boot(_capabilities, { outputs }) {
    void outputs.pages.resumeRefreshes();
  },
  /**
   * Stops the refresh scheduler, and waits for a start's pickup still under way, so nothing
   * writes to a project's state once the server has stopped.
   * @param {{ terminals: TerminalsService }} capabilities
   * @param {{ outputs: { pages: PagesService } }} context
   */
  async shutdown({ terminals }, { outputs }) {
    // readable-check: allow setter-seam - cycle: vibe64.pages requires vibe64.terminals, whose agent command publishes pages
    terminals.setPagesProvider(null);
    await outputs.pages.closeRefreshes();
  }
});

export { Vibe64PagesFeature };
