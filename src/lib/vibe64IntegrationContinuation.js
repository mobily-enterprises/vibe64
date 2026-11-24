import { followHeldRequest } from "./vibe64HeldRequest.js";
import { vibe64SessionPath } from "./vibe64SessionRequestConfig.js";

const CONTINUATION_NOT_WORDED = "Vibe64 could not continue the chat after this integration setup.";
const CONTINUATION_LOST_CONTACT =
  "Vibe64 could not be reached to continue the chat. Choose Check continuation again; it never sends the message twice.";

/**
 * Continue in chat after a verified integration setup (`POST .../integration-setup/resume`). The server answers
 * within two seconds, as resuming while the session's workspace setup runs and the continuation goes out; this
 * repeats the same request until its outcome, also after an answer that never came back, since a repeat joins the
 * running continuation or reads one already sent and never sends it twice.
 * @param {import("@jskit-ai/http-web/client/types").HttpClient} httpClient
 * @param {{ sessionsApiPath: string, sessionId: string, turnId: string, requestId: string }} request
 */
function resumeIntegrationContinuation(httpClient, { sessionsApiPath, sessionId, turnId, requestId }) {
  const path = vibe64SessionPath(sessionsApiPath, sessionId, "/integration-setup/resume");
  return followHeldRequest(() => httpClient.request(path, { method: "POST", body: { turnId, requestId } }), {
    heldAs: "resuming",
    lostContact: CONTINUATION_LOST_CONTACT,
    notWorded: CONTINUATION_NOT_WORDED
  });
}

export { resumeIntegrationContinuation };
