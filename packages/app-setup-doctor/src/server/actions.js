import {
  statusQueryInputValidator
} from "./inputSchemas.js";

const ACTION_GET_STATUS = "feature.app-setup-doctor.status.read";

const featureActions = Object.freeze([
  {
    id: ACTION_GET_STATUS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: statusQueryInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_GET_STATUS
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.featureService.getStatus(input, {
        context
      });
    }
  }
]);

export {
  ACTION_GET_STATUS,
  featureActions
};
