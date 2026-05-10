import {
  bootstrapQueryInputValidator,
  repairInputValidator
} from "./inputSchemas.js";

const ACTION_READ_BOOTSTRAP = "feature.bootstrap-doctor.read";
const ACTION_REPAIR_BOOTSTRAP = "feature.bootstrap-doctor.repair";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_BOOTSTRAP,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: bootstrapQueryInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_BOOTSTRAP
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.getStatus(input);
    }
  },
  {
    id: ACTION_REPAIR_BOOTSTRAP,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: repairInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_REPAIR_BOOTSTRAP
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.repair(input);
    }
  }
]);

export {
  ACTION_READ_BOOTSTRAP,
  ACTION_REPAIR_BOOTSTRAP,
  featureActions
};
