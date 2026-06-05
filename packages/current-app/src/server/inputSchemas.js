import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const vibe64UserInputSchema = {
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const currentAppQueryInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    includeGit: {
      type: "boolean",
      required: false
    }
  }),
  mode: "patch"
});

const emptyInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema
  }),
  mode: "patch"
});

const targetScriptTerminalInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    scriptId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const starredTargetScriptsInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    scriptIds: {
      type: "array",
      items: {
        type: "string",
        noTrim: false
      },
      required: true
    }
  }),
  mode: "patch"
});

export {
  currentAppQueryInputValidator,
  emptyInputValidator,
  targetScriptTerminalInputValidator,
  starredTargetScriptsInputValidator
};
