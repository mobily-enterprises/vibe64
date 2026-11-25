import { defineFeature } from "@jskit-ai/kernel/server/features";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";
import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { VIBE64_SYSTEM_ROOT_ENV } from "@local/vibe64-core/server/studioRoots";
import { createProblemReportActions } from "./problemReportActions.js";
import { NO_PROBLEM_REPORT_HOST, PROBLEM_REPORT_HOST_TOKEN } from "./problemReportHost.js";
import { createProblemReportService } from "./problemReportService.js";
import { registerProblemReportRoutes } from "./registerProblemReportRoutes.js";

/** @typedef {import("../types.js").TerminalsService} TerminalsService */

/**
 * Who reports: the person the action context names. Only an editor without a host (Vibe64 on a person's own computer,
 * where every request is already the loopback Studio's) lets that computer's person stand in for a missing one; with a
 * host, a missing person refuses.
 * @param {boolean} hosted
 */
function createReporter(hosted) {
  return function reporter(user) {
    if (user) return user;
    if (hosted) return null;
    const person = currentOsUser();
    return person?.username ? { uid: person.uid, username: person.username, role: "owner" } : null;
  };
}

// Report a problem: one masked bundle of what the editor saw around the person's problem, reviewed by them, then
// downloaded, copied or (when a host delivers it) sent.
const ProblemReportFeature = defineFeature({
  id: "vibe64.problem-reports",
  domain: "vibe64-problem-reports",
  requires: {
    env: "runtime.env",
    http: "runtime.http",
    terminals: "vibe64.terminals"
  },
  optional: {
    host: PROBLEM_REPORT_HOST_TOKEN
  },
  provides: {
    problemReports: "vibe64.problem-reports"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {TerminalsService} capabilities.terminals
   * @param {import("./problemReportHost.js").ProblemReportHost | null} capabilities.host
   */
  setup({ env, http, terminals, host }) {
    const problemReports = createProblemReportService({
      sessions: { read: (sessionId, window) => terminals.readProblemReportSession(sessionId, window) },
      host: host ?? NO_PROBLEM_REPORT_HOST,
      reporter: createReporter(Boolean(host)),
      systemRoot: String(env[VIBE64_SYSTEM_ROOT_ENV] || "")
    });
    registerProblemReportRoutes(http, {
      localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }),
      projectContext: getStudioProjectContext()
    });
    return { problemReports };
  },
  actions({ problemReports }) {
    return createProblemReportActions({ problemReports });
  }
});

export { ProblemReportFeature, createReporter };
