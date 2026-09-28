import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";
import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { AI_CONNECTION_PROVIDER_PATTERN } from "./aiConnectionStore.js";

const accountsReadInputValidator = deepFreeze({
  schema: createSchema({
    providerId: { type: "string", enum: ["codex", "claude"], required: false },
    refresh: {
      type: "boolean",
      required: false
    },
    providerIds: {
      type: "array",
      items: {
        type: "string",
        noTrim: false
      },
      required: false
    }
  }),
  mode: "create"
});

const accountAuthStartInputValidator = deepFreeze({
  schema: createSchema({
    accountId: {
      type: "string",
      required: true,
      minLength: 1
    },
    mode: {
      type: "string",
      required: false
    },
    gitUserName: {
      type: "string",
      required: false
    },
    gitUserEmail: {
      type: "string",
      required: false
    },
    apiKey: {
      type: "string",
      required: false
    }
  }),
  mode: "create"
});

const gitIdentityInputValidator = deepFreeze({
  schema: createSchema({
    gitUserName: {
      type: "string",
      required: true,
      minLength: 1
    },
    gitUserEmail: {
      type: "string",
      required: true,
      minLength: 1
    }
  }),
  mode: "create"
});

const modelRoutingReadInputValidator = deepFreeze({
  schema: createSchema({
    engineId: { type: "string", enum: ["codex", "claude", "opencode"], required: false },
    includeOtherModels: { type: "boolean", required: false }
  }), mode: "create"
});

const modelRoutingInputValidator = deepFreeze({
  schema: createSchema({
    engineId: { type: "string", enum: ["codex", "claude", "opencode"], required: false },
    revision: { type: "integer", min: 0, required: true },
    reviewedHelperWorkflows: { type: "array", items: { type: "string", enum: ["codex", "claude", "opencode"] }, required: false },
    orchestrators: { type: "object", additionalProperties: true, required: true }
  }), mode: "create"
});

const accountIdInputValidator = deepFreeze({
  schema: createSchema({
    accountId: {
      type: "string",
      required: true,
      minLength: 1
    }
  }),
  mode: "create"
});

const accountAuthSessionInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: {
      type: "string",
      required: true,
      minLength: 1
    }
  }),
  mode: "create"
});

const accountAuthSessionParamsValidator = deepFreeze({
  schema: createSchema({
    slug: {
      type: "string",
      required: false
    },
    sessionId: {
      type: "string",
      required: true,
      minLength: 1
    }
  }),
  mode: "create"
});

const personalAiProfileInputValidator = deepFreeze({
  schema: createSchema({
    preferredName: {
      type: "string",
      required: false
    }
  }),
  mode: "create"
});

const codexProviderInputValidator = deepFreeze({
  schema: createSchema({
    modelProviderId: { type: "string", enum: CURATED_CODEX_PROVIDERS.map(({ id }) => id), required: true },
    engineId: { type: "string", enum: ["codex", "claude"], required: false },
    useSavedKey: { type: "boolean", required: false },
    apiKey: { type: "string", maxLength: 16384, required: false }
  }), mode: "create"
});

const connectionProvider = { type: "string", pattern: AI_CONNECTION_PROVIDER_PATTERN, required: true };
const aiConnectionInputValidators = deepFreeze(Object.fromEntries(Object.entries({
  list: {},
  catalog: { modelProviderId: { ...connectionProvider, required: false } },
  save: {
    modelProviderId: connectionProvider,
    apiKey: { type: "string", minLength: 1, maxLength: 16384, required: true },
    providerRevision: { type: "string", minLength: 1, required: true },
    label: { type: "string", required: false }
  },
  remove: { modelProviderId: connectionProvider },
  modelAccess: {
    modelProviderId: connectionProvider,
    operation: { type: "string", enum: ["cancel-check", "check-available", "disable-additional", "enable-all"], required: false },
    unlocked: { type: "boolean", required: false }
  }
}).map(([operation, fields]) => [operation, { schema: createSchema(fields), mode: "create" }])));

export {
  aiConnectionInputValidators,
  modelRoutingInputValidator,
  modelRoutingReadInputValidator,
  codexProviderInputValidator,
  accountIdInputValidator,
  accountAuthSessionParamsValidator,
  accountAuthSessionInputValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  gitIdentityInputValidator,
  personalAiProfileInputValidator
};
