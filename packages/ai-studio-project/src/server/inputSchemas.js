import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const projectTypeReadInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const projectConfigReadInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const projectConfigInputValidator = deepFreeze({
  schema: createSchema({
    values: {
      type: "object",
      additionalProperties: true,
      required: true
    }
  }),
  mode: "patch"
});

const projectTypeInputValidator = deepFreeze({
  schema: createSchema({
    projectType: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

export {
  projectConfigInputValidator,
  projectConfigReadInputValidator,
  projectTypeInputValidator,
  projectTypeReadInputValidator
};
