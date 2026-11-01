import { defineFeature } from "@jskit-ai/kernel/server/features";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { COLLEAGUE_NAVIGATION_PANES_TOKEN, NO_HOST_PANES } from "../shared/navigationPanes.js";
import { createColleagueActions } from "./colleagueActions.js";
import { createColleagueService } from "./service.js";
import { COLLEAGUE_NAME_RESOLVER_TOKEN, assertColleagueNameResolver, nameColleague } from "./colleagueName.js";
import { createColleagueBrowserFocus } from "./registerColleagueFocus.js";
import { createColleagueUsageKnowledge } from "./usageKnowledge.js";
import { registerRoutes } from "./registerRoutes.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@jskit-ai/realtime/server/types").RuntimeRealtime} RuntimeRealtime */
/** @typedef {import("@local/vibe64-accounts/server/types").AccountsService} AccountsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").ColleagueService} ColleagueService */
/** @typedef {import("./types.js").ColleagueBrowserFocus} ColleagueBrowserFocus */
/** @typedef {import("./types.js").ColleagueNameResolver} ColleagueNameResolver */
/** @typedef {import("../shared/navigationPanes.js").ColleagueNavigationPane} ColleagueNavigationPane */
/** @typedef {import("@jskit-ai/kernel/server/types").FeatureSetupContext} FeatureSetupContext */

const Vibe64ColleagueFeature = defineFeature({
  id: "vibe64.colleague",
  domain: "vibe64-colleague",
  requires: {
    accounts: "vibe64.accounts",
    http: "runtime.http",
    terminals: "vibe64.terminals",
    events: "runtime.events",
    logger: "runtime.logger"
  },
  // A composed host's own project views for navigation.open, and the name it gives Colleague.
  optional: {
    navigationPanes: COLLEAGUE_NAVIGATION_PANES_TOKEN,
    resolveName: COLLEAGUE_NAME_RESOLVER_TOKEN
  },
  provides: {
    colleague: "vibe64.colleague"
  },
  /**
   * @param {object} capabilities
   * @param {AccountsService} capabilities.accounts
   * @param {RuntimeHttp} capabilities.http
   * @param {TerminalsService} capabilities.terminals
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeLogger} capabilities.logger
   * @param {ColleagueNameResolver} [capabilities.resolveName]
   * @param {FeatureSetupContext} context
   */
  setup({
    accounts,
    http,
    terminals,
    events,
    logger,
    resolveName
  }, { actionCatalogue }) {
    assertColleagueNameResolver(resolveName);
    const colleague = createColleagueService({
      actions: actionCatalogue,
      accounts,
      terminals,
      events,
      logger,
      resolveName: resolveName ?? nameColleague,
      systemRoot: getStudioProjectContext().systemRoot
    });
    registerRoutes(http);
    return { colleague };
  },
  /**
   * @param {object} capabilities
   * @param {ColleagueService} capabilities.colleague
   * @param {ReadonlyArray<ColleagueNavigationPane>} [capabilities.navigationPanes]
   */
  actions({ colleague, navigationPanes }) {
    return createColleagueActions({
      colleague,
      usage: createColleagueUsageKnowledge(),
      navigationPanes: navigationPanes ?? NO_HOST_PANES
    });
  },
  /**
   * @param {object} _capabilities
   * @param {{ outputs: { colleague: ColleagueService } }} context
   */
  shutdown(_capabilities, { outputs }) {
    return outputs.colleague.close();
  }
});

// An authentication layer composed on top may consume Colleague, so the service
// does not depend on authenticated realtime. This adapter attaches only after
// both owners exist.
const Vibe64ColleagueFocusFeature = defineFeature({
  id: "vibe64.colleague.browser-focus",
  requires: {
    colleague: "vibe64.colleague",
    logger: "runtime.logger",
    realtime: "runtime.realtime"
  },
  provides: {
    browserFocus: "vibe64.colleague.browser-focus"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeLogger} capabilities.logger
   * @param {RuntimeRealtime} capabilities.realtime
   * @param {FeatureSetupContext} context
   */
  setup({ logger, realtime }, { actionCatalogue }) {
    return {
      browserFocus: createColleagueBrowserFocus({
        realtime,
        actions: actionCatalogue,
        logger
      })
    };
  },
  /**
   * @param {object} _capabilities
   * @param {{ outputs: { browserFocus: ColleagueBrowserFocus } }} context
   */
  shutdown(_capabilities, { outputs }) {
    outputs.browserFocus.close();
  }
});

export { Vibe64ColleagueFeature, Vibe64ColleagueFocusFeature };
