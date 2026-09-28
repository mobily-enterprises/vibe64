import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
const createProjectSchema = createSchema.createFactory();
const maxItems = ({ value, parameterValue, throwParamError }) => {
  if (Array.isArray(value) && value.length > parameterValue) {
    throwParamError("MAX_ITEMS", `Choose up to ${parameterValue} repository labels.`);
  }
};
maxItems.toJsonSchema = ({ parameterValue }) => ({ maxItems: parameterValue });
createProjectSchema.addValidator("maxItems", maxItems);

function inputSchema(fields) {
  return deepFreeze({
    schema: createProjectSchema(Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, { required: false, ...field }]))),
    mode: "create"
  });
}

const projectRemoteInputValidator = inputSchema({
  action: { type: "string", enum: ["status", "fetch", "pull", "push", "configure", "switch", "create"] },
  branch: { type: "string", maxLength: 255 },
  background: { type: "boolean" },
  merge: { type: "boolean" },
  review: { type: "object", additionalProperties: true },
  settings: { type: "object", additionalProperties: true }
});
const projectsReadInputValidator = inputSchema({});
const projectRepositoryBranchesInputValidator = inputSchema({
  name: { type: "string", minLength: 1, maxLength: 4096, noTrim: true },
  offset: { type: "integer", min: 0 },
  limit: { type: "integer", min: 1, max: 10 }
});
const projectOnboardingInputValidator = inputSchema({
  sessionId: { type: "string", noTrim: false, required: true }
});
const projectTemplateInputValidator = inputSchema({
  sessionId: { type: "string", noTrim: false, required: true },
  templateId: { type: "string", noTrim: false, required: true }
});
const previewApplicationIdentitiesReadInputValidator = inputSchema({
  sessionId: {
    type: "string",
    noTrim: false
  }
});
const projectSettingsReadInputValidator = inputSchema({
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectEngineeringSettingsReadInputValidator = inputSchema({
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectEngineeringProfileInputValidator = inputSchema({
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

const projectCollaborationInputValidator = inputSchema({
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

const projectPromptHintsInputValidator = inputSchema({
  promptHints: {
    required: true,
    type: "boolean"
  }
});

const projectCreateInputValidator = inputSchema({
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

const projectSelectInputValidator = inputSchema({
  slug: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const projectEnvReadInputValidator = inputSchema({
  environment: {
    type: "string",
    noTrim: false
  },
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectEnvSecretRevealInputValidator = inputSchema({
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

const projectEnvUserValuesInputValidator = inputSchema({
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

const projectDevelopmentDatabaseScopeInputValidator = inputSchema({
  scope: {
    type: "string",
    enum: ["project", "session"],
    noTrim: false,
    required: true
  }
});

const previewApplicationIdentitiesInputValidator = inputSchema({
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

const emptyProjectInputValidator = inputSchema({});
const projectRepositoryWorkflowInputValidator = inputSchema({ requirePullRequest: { type: "boolean", required: true } });
const issueNumber = { type: "id", required: true };
const cursor = { type: "string", maxLength: 500, nullable: true };
const search = { type: "string", maxLength: 200 };
const labels = { type: "array", items: { type: "string", minLength: 1 }, required: false, maxItems: 100 };
const issueTitle = { type: "string", minLength: 1, maxLength: 256, required: true };
const issueBody = { type: "string", noTrim: true, maxLength: 65536, required: false };
const commentBody = { ...issueBody, minLength: 1, required: true };
const projectIssueInputValidators = {
  list: inputSchema({ state: { type: "string", enum: ["open", "closed", "all"] }, search, cursor, labels }),
  read: inputSchema({ number: issueNumber, cursor }),
  create: inputSchema({ title: issueTitle, body: issueBody, labels }),
  edit: inputSchema({ number: issueNumber, title: issueTitle, body: issueBody }),
  comment: inputSchema({ number: issueNumber, body: commentBody, originId: { type: "string", maxLength: 200 } }),
  "edit-comment": inputSchema({ number: issueNumber, commentId: { type: "string", minLength: 1, maxLength: 256, required: true }, body: commentBody }),
  state: inputSchema({ number: issueNumber, state: { type: "string", enum: ["open", "closed"], required: true } }),
  labels: emptyProjectInputValidator,
  "create-label": inputSchema({ name: { type: "string", minLength: 1, maxLength: 50, required: true }, color: { type: "string", minLength: 6, maxLength: 6, required: true } }),
  "set-labels": inputSchema({ number: issueNumber, labels: { ...labels, required: true }, labelMode: { type: "string", enum: ["replace", "add", "remove"] } }),
  mentions: inputSchema({ number: { ...issueNumber, required: false } })
};
const pullRequestReview = { type: "object", additionalProperties: true, required: true };
const projectPullRequestInputValidators = {
  list: inputSchema({ state: { type: "string", enum: ["open", "closed", "merged", "all"] }, search, cursor }),
  read: inputSchema({ number: issueNumber }),
  ready: inputSchema({ number: issueNumber, review: pullRequestReview }),
  "update-branch": inputSchema({ number: issueNumber, review: pullRequestReview }),
  merge: inputSchema({ number: issueNumber, review: pullRequestReview, mergeMethod: { type: "string", enum: ["merge", "squash", "rebase"], required: true } })
};

export {
  projectRepositoryBranchesInputValidator,
  emptyProjectInputValidator,
  projectRepositoryWorkflowInputValidator,
  projectIssueInputValidators,
  projectPullRequestInputValidators,
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
