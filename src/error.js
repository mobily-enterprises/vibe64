import { createDefaultErrorPolicy } from "@jskit-ai/shell-web/client/error";

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
