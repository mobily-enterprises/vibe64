import { registerVoiceProxyRoute } from "@jskit-ai/assistant-voice/server";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { isTrustedStudioWebSocketRequest } from "@local/vibe64-core/server/localStudioRequest";
import { resolveProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { COLLEAGUE_VOICE_SOCKET_URL } from "../shared/routes.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("./types.js").VoiceProxyConfig} VoiceProxyConfig */

/**
 * Refuses a voice socket that does not come from a trusted Studio page.
 * @param {object} request
 * @param {boolean} localhostCheckBypassed
 */
function authorizeOrigin(request, localhostCheckBypassed) {
  if (!isTrustedStudioWebSocketRequest(request, { localhostCheckBypassed })) {
    throw new AppError(403, "Sign in to use voice.", { code: "voice_auth_required" });
  }
}

/**
 * The voice sockets: a project session's voice, for a session the request may inspect, and Colleague's voice, for a
 * request the Colleague read authorizes. Both proxy to the configured speech service.
 * @param {RuntimeFastify} fastify
 * @param {object} capabilities
 * @param {ActionCatalogue} capabilities.actionCatalogue
 * @param {boolean} capabilities.localhostCheckBypassed
 * @param {VoiceProxyConfig} capabilities.proxyConfig
 * @param {SessionsService} capabilities.sessions
 */
function registerVoiceSocketRoutes(fastify, { actionCatalogue, localhostCheckBypassed, proxyConfig, sessions }) {
  registerVoiceProxyRoute(fastify, {
    proxyConfig,
    route: "/api/app/:slug/vibe64/sessions/:sessionId/voice/ws",
    async authorize(request) {
      authorizeOrigin(request, localhostCheckBypassed);
      const context = await resolveProjectRequestContext({
        projectContext: getStudioProjectContext(),
        request
      });
      const sessionId = String(request.params?.sessionId || "").trim();
      const inspection = await runWithProjectRequestContext(context, () => sessions.inspectSession(sessionId));
      if (inspection?.ok !== true || !sessionId || inspection.sessionId !== sessionId) {
        throw new AppError(403, "This session is not available.", { code: "voice_session_unavailable" });
      }
    }
  });
  registerVoiceProxyRoute(fastify, {
    proxyConfig,
    route: COLLEAGUE_VOICE_SOCKET_URL,
    async authorize(request) {
      authorizeOrigin(request, localhostCheckBypassed);
      await actionCatalogue.execute({
        actionId: "vibe64.colleague.state.read",
        input: {},
        context: {
          channel: "api",
          surface: "app",
          requestMeta: { request }
        }
      });
    }
  });
}

export { registerVoiceSocketRoutes };
