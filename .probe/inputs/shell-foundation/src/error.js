import { createDefaultErrorPolicy } from "@jskit-ai/shell-web/client/error";

/**
 * App-owned error handling contract.
 * - intent chooses default presentation: resource-load, action-feedback, app-recoverable, blocking.
 * - policy(event, ctx): decide channel + presenter + message.
 * - defaultPresenterId: used when policy does not set presenterId.
 * - presenters: optional custom presenters registered at boot.
 */
export default Object.freeze({
  defaultPresenterId: "material.snackbar",
  policy: createDefaultErrorPolicy({
    resourceLoadChannel: "silent",
    actionFeedbackChannel: "snackbar",
    appRecoverableChannel: "banner",
    blockingChannel: "dialog"
  }),
  presenters: []
});
