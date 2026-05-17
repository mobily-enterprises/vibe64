import {
  studioSetupQueryInputValidator
} from "./inputSchemas.js";

const ACTION_READ_STUDIO_SETUP = "feature.studio-setup-doctor.read";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_STUDIO_SETUP,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: studioSetupQueryInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_STUDIO_SETUP
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.getStatus(input);
    }
  }
]);

export {
  ACTION_READ_STUDIO_SETUP,
  featureActions
};
