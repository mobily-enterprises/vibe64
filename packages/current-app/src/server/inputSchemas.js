import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const currentAppQueryInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "create"
});

export {
  currentAppQueryInputValidator
};
