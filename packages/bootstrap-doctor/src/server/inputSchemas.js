import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const bootstrapQueryInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const repairInputValidator = deepFreeze({
  schema: createSchema({
    actionId: {
      type: "string",
      required: true,
      minLength: 1
    },
    inputs: {
      type: "object",
      required: false,
      additionalProperties: true
    }
  }),
  mode: "patch"
});

const terminalStartInputValidator = repairInputValidator;

const terminalInputValidator = deepFreeze({
  schema: createSchema({
    data: {
      type: "string",
      noTrim: true,
      required: true
    }
  }),
  mode: "patch"
});

export {
  bootstrapQueryInputValidator,
  repairInputValidator,
  terminalInputValidator,
  terminalStartInputValidator
};
