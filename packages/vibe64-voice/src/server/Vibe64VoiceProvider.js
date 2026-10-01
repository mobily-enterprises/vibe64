import { defineFeature } from "@jskit-ai/kernel/server/features";
import { registerVoiceProxyRoute, resolveVoiceProxyConfig } from "@jskit-ai/assistant-voice/server";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { isTrustedStudioWebSocketRequest } from "@local/vibe64-core/server/localStudioRequest";
import { resolveProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

const Vibe64VoiceProvider = defineFeature({
  id: "vibe64.voice",
  requires: { colleague: "vibe64.colleague", env: "runtime.env", fastify: "runtime.fastify", project: "vibe64.project", sessions: "vibe64.sessions" },
  provides: { voice: "vibe64.voice" },
  setup({ env, fastify, sessions }, { actionCatalogue }) {
    const config = { ...process.env, ...env };
    const proxyConfig = resolveVoiceProxyConfig({ endpoint: config.VIBE64_VOICE_ENDPOINT, accessTokenFile: config.VIBE64_VOICE_ACCESS_TOKEN_FILE });
    function authorizeOrigin(request) {
      if (!isTrustedStudioWebSocketRequest(request)) throw Object.assign(new Error("Sign in to use voice."), { code: "voice_auth_required", statusCode: 403 });
    }
    registerVoiceProxyRoute(fastify, { proxyConfig, route: "/api/app/:slug/vibe64/sessions/:sessionId/voice/ws",
      async authorize(request) {
        authorizeOrigin(request);
        const context = await resolveProjectRequestContext({ projectContext: getStudioProjectContext(), request });
        const sessionId = String(request.params?.sessionId || "").trim();
        const inspection = await runWithProjectRequestContext(context, () => sessions.inspectSession(sessionId));
        if (inspection?.ok !== true || !sessionId || inspection.sessionId !== sessionId) {
          throw Object.assign(new Error("This session is not available."), { code: "voice_session_unavailable", statusCode: 403 });
        }
      }
    });
    registerVoiceProxyRoute(fastify, { proxyConfig, route: "/api/vibe64/colleague/voice/ws",
      async authorize(request) {
        authorizeOrigin(request);
        await actionCatalogue.execute({ actionId: "vibe64.colleague.state.read", input: {},
          context: { channel: "api", surface: "app", requestMeta: { request } } });
      }
    });
    return { voice: Object.freeze({ available: proxyConfig.available }) };
  }
});
export { Vibe64VoiceProvider };
