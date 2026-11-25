// A host's part in Report a problem, optional: what it adds to a report (its own pages' state, its versions, and
// the exact secret values its masking must also hide), and whether and how it delivers a report. Without one, a
// report is reviewed and then downloaded or copied, and Vibe64 sends it nowhere.
import { AppError } from "@jskit-ai/kernel/server/runtime";

const PROBLEM_REPORT_HOST_TOKEN = "vibe64.problem-reports.host";

/**
 * @typedef {object} ProblemReportPlace
 * @property {string} page the page's name, as the person saw it
 * @property {string} route the page's path
 * @property {string} projectSlug "" outside a project
 * @property {string} sessionId "" outside a session
 */

/**
 * @typedef {object} ProblemReportHostSection
 * @property {string} id
 * @property {string} title
 * @property {string} [state]
 * @property {{ code?: string, message?: string, at?: string } | null} [lastError]
 * @property {Record<string, string | number | boolean | null>} [fields]
 */

/**
 * @typedef {object} ProblemReportConsent
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {boolean} default
 */

/**
 * @typedef {object} ProblemReportHost
 * @property {(request: { actor: object, place: ProblemReportPlace }) => Promise<{ sections?: ProblemReportHostSection[],
 *   versions?: Record<string, string>, secrets?: string[] }>} contribute
 * @property {(request: { actor: object }) => Promise<null | { label: string, description: string,
 *   consents: ProblemReportConsent[] }>} delivery how this host delivers a report to this person, or null
 * @property {(request: { bundle: object, consents: Record<string, boolean>, actor: object, place: ProblemReportPlace })
 *   => Promise<{ reference: string, message?: string }>} deliver
 */

/** @type {ProblemReportHost} */
const NO_PROBLEM_REPORT_HOST = Object.freeze({
  async contribute() {
    return {};
  },
  async delivery() {
    return null;
  },
  async deliver() {
    throw new AppError(409, "This editor sends problem reports nowhere: download or copy the report instead.", {
      code: "vibe64_problem_report_no_delivery"
    });
  }
});

export { NO_PROBLEM_REPORT_HOST, PROBLEM_REPORT_HOST_TOKEN };
