import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const studioSetupQueryInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const terminalStartInputValidator = deepFreeze({
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
  studioSetupQueryInputValidator,
  terminalInputValidator,
  terminalStartInputValidator
};
