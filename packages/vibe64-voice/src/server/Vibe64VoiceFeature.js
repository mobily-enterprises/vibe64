import { defineFeature } from "@jskit-ai/kernel/server/features";
import { resolveVoiceProxyConfig } from "@jskit-ai/assistant-voice/server";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";
import { createVoiceActions } from "./voiceActions.js";
import { createVoice } from "./voiceRuntime.js";
import { registerRoutes } from "./registerRoutes.js";
import { registerVoiceSocketRoutes } from "./voiceSocketRoutes.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@jskit-ai/kernel/server/types").FeatureSetupContext} FeatureSetupContext */
/** @typedef {import("./types.js").VoiceService} VoiceService */

const Vibe64VoiceFeature = defineFeature({
  id: "vibe64.voice",
  requires: {
    colleague: "vibe64.colleague",
    env: "runtime.env",
    fastify: "runtime.fastify",
    project: "vibe64.project",
    sessions: "vibe64.sessions"
  },
  provides: {
    voice: "vibe64.voice"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeFastify} capabilities.fastify
   * @param {SessionsService} capabilities.sessions
   * @param {FeatureSetupContext} context
   */
  setup({
    env,
    fastify,
    sessions
  }, { actionCatalogue }) {
    const proxyConfig = resolveVoiceProxyConfig({
      endpoint: env.VIBE64_VOICE_ENDPOINT,
      accessTokenFile: env.VIBE64_VOICE_ACCESS_TOKEN_FILE
    });
    registerRoutes(fastify, { actionCatalogue });
    registerVoiceSocketRoutes(fastify, {
      actionCatalogue,
      localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }),
      proxyConfig,
      sessions
    });
    return {
      voice: createVoice({
        actionCatalogue,
        proxyConfig
      })
    };
  },
  /**
   * @param {object} capabilities
   * @param {VoiceService} capabilities.voice
   */
  actions({ voice }) {
    return createVoiceActions({ voice });
  }
});

export { Vibe64VoiceFeature };
