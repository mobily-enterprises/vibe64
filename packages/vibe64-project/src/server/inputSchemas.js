import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
function patchSchema(fields) {
  return deepFreeze({
    schema: createSchema(fields),
    mode: "patch"
  });
}

const optionalUser = {
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const projectRemoteInputValidator = patchSchema({
  action: { type: "string", enum: ["status", "fetch", "pull", "push", "configure", "switch", "create"] },
  branch: { type: "string", maxLength: 255 },
  background: { type: "boolean" },
  merge: { type: "boolean" },
  review: { type: "object", additionalProperties: true },
  settings: { type: "object", additionalProperties: true }
});
const projectsReadInputValidator = patchSchema({});
const projectOnboardingInputValidator = patchSchema({
  sessionId: { type: "string", noTrim: false, required: true }
});
const projectTemplateInputValidator = patchSchema({
  sessionId: { type: "string", noTrim: false, required: true },
  templateId: { type: "string", noTrim: false, required: true }
});
const previewApplicationIdentitiesReadInputValidator = patchSchema({
  sessionId: {
    type: "string",
    noTrim: false
  }
});
const projectSettingsReadInputValidator = patchSchema({
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectEngineeringSettingsReadInputValidator = patchSchema({
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectEngineeringProfileInputValidator = patchSchema({
  profile: {
    type: "string",
    noTrim: false,
    required: true
  },
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectCollaborationInputValidator = patchSchema({
  ...optionalUser,
  requirements: {
    noTrim: false,
    required: true,
    type: "string"
  },
  experience: {
    noTrim: false,
    required: true,
    type: "string"
  },
  explanationStyle: {
    noTrim: false,
    required: true,
    type: "string"
  },
  responseLength: {
    noTrim: false,
    required: true,
    type: "string"
  },
  tone: {
    noTrim: false,
    required: true,
    type: "string"
  },
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectPromptHintsInputValidator = patchSchema({
  ...optionalUser,
  promptHints: {
    required: true,
    type: "boolean"
  }
});

const projectCreateInputValidator = patchSchema({
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
});

const projectSelectInputValidator = patchSchema({
  slug: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const projectEnvReadInputValidator = patchSchema({
  environment: {
    type: "string",
    noTrim: false
  },
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectEnvSecretRevealInputValidator = patchSchema({
  environment: {
    type: "string",
    noTrim: false
  },
  key: {
    type: "string",
    noTrim: false,
    required: true
  },
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectEnvUserValuesInputValidator = patchSchema({
  environment: {
    type: "string",
    noTrim: false
  },
  sessionId: {
    type: "string",
    noTrim: false
  },
  values: {
    type: "object",
    additionalProperties: true,
    required: true
  }
});

const projectDevelopmentDatabaseScopeInputValidator = patchSchema({
  scope: {
    type: "string",
    enum: ["project", "session"],
    noTrim: false,
    required: true
  }
});

const previewApplicationIdentitiesInputValidator = patchSchema({
  identities: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: true
    },
    required: true
  },
  sessionId: {
    type: "string",
    noTrim: false
  }
});

export {
  projectRemoteInputValidator,
  projectOnboardingInputValidator,
  projectTemplateInputValidator,
  projectCollaborationInputValidator,
  projectDevelopmentDatabaseScopeInputValidator,
  projectEngineeringProfileInputValidator,
  projectEngineeringSettingsReadInputValidator,
  projectCreateInputValidator,
  projectEnvReadInputValidator,
  projectEnvSecretRevealInputValidator,
  projectEnvUserValuesInputValidator,
  projectsReadInputValidator,
  projectPromptHintsInputValidator,
  projectSelectInputValidator,
  projectSettingsReadInputValidator,
  previewApplicationIdentitiesInputValidator,
  previewApplicationIdentitiesReadInputValidator
};
