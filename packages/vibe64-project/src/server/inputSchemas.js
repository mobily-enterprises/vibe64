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

const adapterSettingsActionParamsValidator = deepFreeze({
  schema: createSchema({
    actionId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const adapterSettingsComponentParamsValidator = deepFreeze({
  schema: createSchema({
    componentId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const adapterSettingsComponentReadInputValidator = deepFreeze({
  schema: createSchema({
    projectType: {
      type: "string",
      noTrim: false
    },
    refresh: {
      type: "boolean"
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

const adapterSettingsActionStepParamsValidator = deepFreeze({
  schema: createSchema({
    actionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    stepId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const adapterSettingsComponentInputValidator = deepFreeze({
  schema: createSchema({
    accessToken: {
      type: "string",
      noTrim: false
    },
    environment: {
      type: "string",
      noTrim: false
    },
    environments: {
      type: "array",
      items: {
        type: "string",
        noTrim: false
      }
    },
    fromEmail: {
      type: "string",
      noTrim: false
    },
    fromName: {
      type: "string",
      noTrim: false
    },
    organizationSlug: {
      type: "string",
      noTrim: false
    },
    payload: {
      type: "object",
      additionalProperties: true
    },
    projectType: {
      type: "string",
      noTrim: false
    },
    redirectUrls: {
      type: "array",
      items: {
        type: "string",
        noTrim: false
      }
    },
    regionGroup: {
      type: "string",
      noTrim: false
    },
    sessionId: {
      type: "string",
      noTrim: false
    },
    siteUrl: {
      type: "string",
      noTrim: false
    },
    smtpHost: {
      type: "string",
      noTrim: false
    },
    smtpPassword: {
      type: "string",
      noTrim: false
    },
    smtpPort: {
      type: "string",
      noTrim: false
    },
    smtpUser: {
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

const adapterSettingsActionInputValidator = deepFreeze({
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
    payload: {
      type: "object",
      additionalProperties: true
    }
  }),
  mode: "patch"
});

const projectEnvReadInputValidator = deepFreeze({
  schema: createSchema({
    projectType: {
      type: "string",
      noTrim: false
    },
    sessionId: {
      type: "string",
      noTrim: false
    },
    environment: {
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

const projectEnvMaterializeInputValidator = deepFreeze({
  schema: createSchema({
    environment: {
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

const projectEnvUserValuesInputValidator = deepFreeze({
  schema: createSchema({
    environment: {
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
    name: {
      type: "string",
      noTrim: false
    },
    repository: {
      type: "object",
      additionalProperties: true
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
  adapterSettingsActionInputValidator,
  adapterSettingsActionParamsValidator,
  adapterSettingsActionStepParamsValidator,
  adapterSettingsComponentInputValidator,
  adapterSettingsComponentParamsValidator,
  adapterSettingsComponentReadInputValidator,
  projectConfigInputValidator,
  projectConfigReadInputValidator,
  projectCreateInputValidator,
  projectEnvMaterializeInputValidator,
  projectEnvReadInputValidator,
  projectEnvUserValuesInputValidator,
  projectsReadInputValidator,
  projectSelectInputValidator,
  projectTypeInputValidator,
  projectTypeReadInputValidator
};
