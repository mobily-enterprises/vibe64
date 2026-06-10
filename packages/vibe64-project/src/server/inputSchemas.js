import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const projectTypeReadInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const projectConfigReadInputValidator = deepFreeze({
  schema: createSchema({
    projectType: {
      type: "string",
      noTrim: false
    }
  }),
  mode: "patch"
});

const projectsReadInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const projectCreateInputValidator = deepFreeze({
  schema: createSchema({
    name: {
      type: "string",
      noTrim: false
    },
    slug: {
      type: "string",
      noTrim: false
    }
  }),
  mode: "patch"
});

const projectSelectInputValidator = deepFreeze({
  schema: createSchema({
    slug: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const projectConfigInputValidator = deepFreeze({
  schema: createSchema({
    projectType: {
      type: "string",
      noTrim: false
    },
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
  projectCreateInputValidator,
  projectsReadInputValidator,
  projectSelectInputValidator,
  projectTypeInputValidator,
  projectTypeReadInputValidator
};
