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

export { currentAppQueryInputValidator };
