import { ACTION_READ_VOICE_CATALOGUE } from "./voiceActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */

/**
 * The voice catalogue route: an HTTP read of the voice catalogue action.
 * @param {RuntimeFastify} fastify
 * @param {object} capabilities
 * @param {ActionCatalogue} capabilities.actionCatalogue
 */
function registerRoutes(fastify, { actionCatalogue }) {
  fastify.get("/api/vibe64/voice/voices", (request) => actionCatalogue.execute({
    actionId: ACTION_READ_VOICE_CATALOGUE,
    input: {},
    context: {
      channel: "api",
      surface: "app",
      requestMeta: { request }
    }
  }));
}

export { registerRoutes };
