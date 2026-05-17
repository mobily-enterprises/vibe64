import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const currentAppQueryInputValidator = deepFreeze({
  schema: createSchema({
    includeGit: {
      type: "boolean",
      required: false
    }
  }),
  mode: "patch"
});

const emptyInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const targetScriptTerminalInputValidator = deepFreeze({
  schema: createSchema({
    scriptName: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const starredTargetScriptsInputValidator = deepFreeze({
  schema: createSchema({
    scriptNames: {
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
