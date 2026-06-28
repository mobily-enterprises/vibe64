import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const projectTypeReadInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: {
      type: "string",
      noTrim: false
    },
    sourcePath: {
      type: "string",
      noTrim: false
    }
  }),
  mode: "patch"
});

const projectConfigReadInputValidator = deepFreeze({
  schema: createSchema({
    projectType: {
      type: "string",
      noTrim: false
    },
    sessionId: {
      type: "string",
      noTrim: false
    },
    sourcePath: {
      type: "string",
      noTrim: false
    }
  }),
  mode: "patch"
});

const projectRuntimeConfigReadInputValidator = deepFreeze({
  schema: createSchema({
    phase: {
      type: "string",
      noTrim: false
    },
    projectType: {
      type: "string",
      noTrim: false
    },
    sessionId: {
      type: "string",
      noTrim: false
    },
    scope: {
      type: "string",
      noTrim: false
    },
    sourcePath: {
      type: "string",
      noTrim: false
    }
  }),
  mode: "patch"
});

const projectRuntimeConfigMaterializeInputValidator = deepFreeze({
  schema: createSchema({
    scope: {
      type: "string",
      noTrim: false
    },
    syncActiveSessionSources: {
      type: "boolean"
    },
    sourcePath: {
      type: "string",
      noTrim: false
    }
  }),
  mode: "patch"
});

const projectRuntimeConfigUserValuesInputValidator = deepFreeze({
  schema: createSchema({
    scope: {
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

const projectsReadInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const projectCreateInputValidator = deepFreeze({
  schema: createSchema({
    githubRepository: {
      type: "object",
      additionalProperties: true
    },
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
    sessionId: {
      type: "string",
      noTrim: false
    },
    sourcePath: {
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
    },
    sessionId: {
      type: "string",
      noTrim: false
    },
    sourcePath: {
      type: "string",
      noTrim: false
    }
  }),
  mode: "patch"
});

export {
  projectConfigInputValidator,
  projectConfigReadInputValidator,
  projectCreateInputValidator,
  projectRuntimeConfigMaterializeInputValidator,
  projectRuntimeConfigReadInputValidator,
  projectRuntimeConfigUserValuesInputValidator,
  projectsReadInputValidator,
  projectSelectInputValidator,
  projectTypeInputValidator,
  projectTypeReadInputValidator
};
