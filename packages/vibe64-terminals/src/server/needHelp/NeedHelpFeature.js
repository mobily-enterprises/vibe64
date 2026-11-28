import { defineFeature } from "@jskit-ai/kernel/server/features";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { createNeedHelpActions } from "./needHelpActions.js";
import { NEED_HELP_HOST_TOKEN, NO_NEED_HELP_HOST, assertNeedHelpHost } from "./needHelpHost.js";
import { createNeedHelpService } from "./needHelpService.js";
import { registerNeedHelpRoutes } from "./registerNeedHelpRoutes.js";

/** @typedef {import("../types.js").TerminalsService} TerminalsService */

// Need help: a session's flag that its AI, or the person, needs help with what the session can't fix itself. The
// person raises, answers and clears it from the session's pages; the AI's vibe64-helper need-help reaches it through
// the terminals, which this fills; a host may forward each raised flag to whoever can help.
const NeedHelpFeature = defineFeature({
  id: "vibe64.need-help",
  domain: "vibe64-need-help",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    terminals: "vibe64.terminals"
  },
  optional: {
    host: NEED_HELP_HOST_TOKEN
  },
  provides: {
    needHelp: "vibe64.need-help"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEvents} capabilities.events
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} capabilities.logger
   * @param {import("@local/vibe64-project/server/types").ProjectService} capabilities.project
   * @param {TerminalsService} capabilities.terminals
   * @param {import("./needHelpHost.js").NeedHelpHost | null} capabilities.host
   */
  setup({ env, events, http, logger, project, terminals, host }) {
    assertNeedHelpHost(host);
    const needHelp = createNeedHelpService({
      project,
      host: host ?? NO_NEED_HELP_HOST,
      publishSessionChanged: createSessionChangedPublisher({ events }),
      noteMainChat: (sessionId, input, options) => terminals.noteMainChat(sessionId, input, options),
      logger
    });
    // readable-check: allow setter-seam - cycle: vibe64.need-help requires vibe64.terminals
    terminals.setNeedHelp(needHelp);
    registerNeedHelpRoutes(http, {
      localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }),
      projectContext: getStudioProjectContext()
    });
    return { needHelp };
  },
  actions({ needHelp }) {
    return createNeedHelpActions({ needHelp });
  },
  /**
   * @param {{ terminals: TerminalsService }} capabilities
   */
  shutdown({ terminals }) {
    // readable-check: allow setter-seam - cycle: vibe64.need-help requires vibe64.terminals
    terminals.setNeedHelp(null);
  }
});

export { NeedHelpFeature };
