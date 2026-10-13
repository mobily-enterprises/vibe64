import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

const ACTION_READ_VOICE_CATALOGUE = "vibe64.voice.catalogue.read";
const emptyInput = Object.freeze({
  schema: createSchema({})
});

function createVoiceActions({ actions, voice } = {}) {
  if (!actions || typeof actions.execute !== "function") {
    throw new TypeError("createVoiceActions requires the action catalogue.");
  }
  if (!voice || typeof voice.readCatalogue !== "function") {
    throw new TypeError("createVoiceActions requires the Vibe64 Voice API.");
  }
  return Object.freeze([withVibe64ActionContext({
    id: ACTION_READ_VOICE_CATALOGUE,
    version: 1,
    kind: "query",
    input: emptyInput,
    output: null,
    extensions: { assistant: { exclude: true } },
    idempotency: "none",
    audit: { actionName: ACTION_READ_VOICE_CATALOGUE },
    observability: {},
    async execute(_input, context) {
      await actions.execute({
        actionId: "vibe64.colleague.state.read",
        input: {},
        context
      });
      return voice.readCatalogue();
    }
  }, { projectScoped: false })]);
}

export {
  ACTION_READ_VOICE_CATALOGUE,
  createVoiceActions
};
