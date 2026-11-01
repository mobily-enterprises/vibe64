import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * What the prompt hint parts share: the diagnostic report that never makes a
 * failure user-visible, and the open requests by subscriber, which requests
 * register and jobs cancel.
 * @param {object} dependencies
 * @param {(event: object) => void} dependencies.diagnostic
 */
function createPromptHintState({ diagnostic }) {
  const requestsBySubscriber = new Map();

  function reportDiagnostic(code, error, details) {
    try {
      diagnostic({
        code,
        details,
        error: toText(error?.message || error),
        event: "vibe64.prompt_hints.failed"
      });
    } catch {
      // A failing diagnostic must not make prompt hints user-visible.
    }
  }

  return Object.freeze({
    reportDiagnostic,
    requestsBySubscriber
  });
}

export {
  createPromptHintState
};
