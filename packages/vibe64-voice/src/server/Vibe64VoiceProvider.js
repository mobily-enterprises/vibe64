import { defineFeature } from "@jskit-ai/kernel/server/features";
import { registerVoiceProxyRoute, resolveVoiceProxyConfig, readVoiceCatalogue } from "@jskit-ai/assistant-voice/server";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { isTrustedStudioWebSocketRequest } from "@local/vibe64-core/server/localStudioRequest";
import { resolveProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { COLLEAGUE_VOICE_SOCKET_URL } from "../shared/routes.js";
import { ACTION_READ_VOICE_CATALOGUE, createVoiceActions } from "./voiceActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */

/**
 * @param {RuntimeFastify} fastify
 * @param {ActionCatalogue} actions
 */
function registerVoiceCatalogueRoute(fastify, actions) {
  fastify.get("/api/vibe64/voice/voices", request => actions.execute({
    actionId: ACTION_READ_VOICE_CATALOGUE,
    input: {},
    context: { channel: "api", surface: "app", requestMeta: { request } }
  }));
}

/**
 * The voice capability: whether the voice proxy is configured, and its voice
 * catalogue.
 * @param {ReturnType<typeof resolveVoiceProxyConfig>} proxyConfig
 */
function createVoice(proxyConfig) {
  const readCatalogue = () => readVoiceCatalogue(proxyConfig);

  return Object.freeze({ available: proxyConfig.available, readCatalogue });
}

const Vibe64VoiceProvider = defineFeature({
  id: "vibe64.voice",
  actionDefaults: {
    channels: ["api", "internal"],
    surfaces: ["app"]
  },
  requires: {
    colleague: "vibe64.colleague",
    env: "runtime.env",
    fastify: "runtime.fastify",
    project: "vibe64.project",
    sessions: "vibe64.sessions"
  },
  provides: { voice: "vibe64.voice" },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeFastify} capabilities.fastify
   * @param {SessionsService} capabilities.sessions
   * @param {{ actionCatalogue: ActionCatalogue }} context
   */
  setup({
    env,
    fastify,
    sessions
  }, { actionCatalogue }) {
    const config = { ...process.env, ...env };
    const proxyConfig = resolveVoiceProxyConfig({
      endpoint: config.VIBE64_VOICE_ENDPOINT,
      accessTokenFile: config.VIBE64_VOICE_ACCESS_TOKEN_FILE
    });
    registerVoiceCatalogueRoute(fastify, actionCatalogue);
    function authorizeOrigin(request) {
      if (!isTrustedStudioWebSocketRequest(request)) throw Object.assign(new Error("Sign in to use voice."), {
        code: "voice_auth_required",
        statusCode: 403
      });
    }
    registerVoiceProxyRoute(fastify, {
      proxyConfig,
      route: "/api/app/:slug/vibe64/sessions/:sessionId/voice/ws",
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
    registerVoiceProxyRoute(fastify, {
      proxyConfig,
      route: COLLEAGUE_VOICE_SOCKET_URL,
      async authorize(request) {
        authorizeOrigin(request);
        await actionCatalogue.execute({
          actionId: "vibe64.colleague.state.read",
          input: {},
          context: { channel: "api", surface: "app", requestMeta: { request } }
        });
      }
    });
    return { voice: createVoice(proxyConfig) };
  },
  actions({ voice }, { actionCatalogue }) {
    return createVoiceActions({ actions: actionCatalogue, voice });
  }
});
export { Vibe64VoiceProvider, createVoice, registerVoiceCatalogueRoute };
