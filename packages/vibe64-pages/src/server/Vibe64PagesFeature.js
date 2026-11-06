import { defineFeature } from "@jskit-ai/kernel/server/features";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";

import { createPagesActions } from "./pagesActions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createPagesService } from "./service.js";

/** @typedef {import("./types.js").PagesService} PagesService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * Pages: AI-made HTML pages every project member can open, kept in the
 * project's Vibe64 state. The session agent's `vibe64-helper pages` command
 * reaches this service through Terminals.
 */
const Vibe64PagesFeature = defineFeature({
  id: "vibe64.pages",
  domain: "vibe64-pages",
  requires: {
    env: "runtime.env",
    http: "runtime.http",
    terminals: "vibe64.terminals"
  },
  provides: {
    pages: "vibe64.pages"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeHttp} capabilities.http
   * @param {TerminalsService} capabilities.terminals
   */
  setup({ env, http, terminals }) {
    const pages = createPagesService({ now: () => new Date().toISOString(), clock: Date.now });
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
   * @param {{ terminals: TerminalsService }} capabilities
   */
  shutdown({ terminals }) {
    // readable-check: allow setter-seam - cycle: vibe64.pages requires vibe64.terminals, whose agent command publishes pages
    terminals.setPagesProvider(null);
  }
});

export { Vibe64PagesFeature };
