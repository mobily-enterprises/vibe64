import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const vibe64UserInputSchema = {
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const statusQueryInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    verbose: {
      type: "boolean",
      required: false
    },
    refresh: {
      type: "boolean",
      required: false
    }
  }),
  mode: "patch"
});

const terminalStartInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
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
  statusQueryInputValidator,
  terminalInputValidator,
  terminalStartInputValidator
};
