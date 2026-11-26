import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { studioApiPath } from "@/lib/studioUrls.js";

// Report a problem's two requests: collect a report of the page the person is on (its project's when it has one,
// else the workspace's), and send the one they reviewed through the host's delivery.

const WORKSPACE_PROBLEM_REPORT_ENDPOINT = studioApiPath("studio/problem-report");
const SEND_PROBLEM_REPORT_ENDPOINT = studioApiPath("studio/problem-report/send");

function projectProblemReportEndpoint(projectSlug) {
  return `/api/app/${encodeURIComponent(projectSlug)}/vibe64/problem-report`;
}

/** What the page says of itself: its browser, size, language and time zone, and the errors it saw. */
function clientFacts(errors, browserWindow = globalThis.window) {
  return {
    userAgent: String(browserWindow?.navigator?.userAgent || "").slice(0, 400),
    viewport: browserWindow ? `${browserWindow.innerWidth}x${browserWindow.innerHeight}` : "",
    language: String(browserWindow?.navigator?.language || "").slice(0, 40),
    timeZone: String(Intl.DateTimeFormat().resolvedOptions().timeZone || "").slice(0, 80),
    errors
  };
}

/**
 * @param {{ projectSlug?: string, page: string, route: string, sessionId?: string,
 *   chat?: { kind: string, id?: string } | null, includeChat?: boolean, errors?: object[] }} request
 * @returns {Promise<{ draftId: string, bundle: Record<string, any>, delivery: null | { label: string,
 *   description: string, consents: { id: string, label: string, description: string, default: boolean }[] } }>}
 */
function collectProblemReport({ projectSlug = "", page, route, sessionId = "", chat = null, includeChat = false, errors = [] }) {
  const place = { page: String(page || "").slice(0, 200), route: String(route || "").slice(0, 2000), client: clientFacts(errors) };
  if (!projectSlug) {
    return getHttpWebClient().request(WORKSPACE_PROBLEM_REPORT_ENDPOINT, { method: "POST", body: place });
  }
  return getHttpWebClient().request(projectProblemReportEndpoint(projectSlug), {
    method: "POST",
    body: {
      ...place,
      ...(sessionId ? { sessionId } : {}),
      ...(sessionId && chat ? { chat, includeChat: includeChat === true } : {})
    }
  });
}

/**
 * @param {{ draftId: string, note: string, consents: Record<string, boolean> }} request
 * @returns {Promise<{ reference: string, message: string }>}
 */
function sendProblemReport({ draftId, note, consents }) {
  return getHttpWebClient().request(SEND_PROBLEM_REPORT_ENDPOINT, { method: "POST", body: { draftId, note, consents } });
}

export { collectProblemReport, sendProblemReport };
