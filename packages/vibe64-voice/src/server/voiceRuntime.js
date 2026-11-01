import { readVoiceCatalogue } from "@jskit-ai/assistant-voice/server";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("./types.js").VoiceProxyConfig} VoiceProxyConfig */

/**
 * The voice capability: the speech service's voice catalogue, read for Colleague.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actionCatalogue
 * @param {VoiceProxyConfig} dependencies.proxyConfig
 */
function createVoice({ actionCatalogue, proxyConfig }) {
  /**
   * The installed voices, once the Colleague read has authorized the original request afresh. Its contributor
   * rejects a resolved grant carried over from the catalogue action, so the grant is left out.
   * @param {object} context
   */
  async function readCatalogueForColleague(context) {
    const recheckContext = { ...context };
    delete recheckContext.vibe64Action;
    await actionCatalogue.execute({
      actionId: "vibe64.colleague.state.read",
      input: {},
      context: recheckContext
    });
    return readVoiceCatalogue(proxyConfig);
  }

  return Object.freeze({
    readCatalogueForColleague
  });
}

export { createVoice };
