import { ASSISTANT_SETUP_ROLES } from "@local/vibe64-runtime/shared/assistantRouting";
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

const routingEngine = { type: "string", enum: ["codex", "claude", "opencode"], required: false };
const routingIdentifier = { type: "string", noTrim: true, minLength: 1, maxLength: 512, required: true };
const modelRoutingSelectionSchema = createSchema({
  schema: { type: "string", enum: ["vibe64.assistant-selection.v1"], required: true },
  engineId: { ...routingEngine, required: true },
  agentId: routingIdentifier, modelProviderId: routingIdentifier, modelId: routingIdentifier,
  variantId: { ...routingIdentifier, minLength: 0 },
  catalogRevision: { type: "string", pattern: /^sha256:[a-f0-9]{64}$/u, required: true },
  selectionSource: { type: "string", enum: ["recommended", "explicit"], required: true }
});
// A role value is a selection, null (off) or { follows }; the routing store validates which.
const setupValues = setup => ({ type: "object", required: false, schema: createSchema(Object.fromEntries(ASSISTANT_SETUP_ROLES[setup].map(role =>
  [role, { type: "object", additionalProperties: true, nullable: true, required: false }]))) });
const routingSetup = { type: "string", enum: Object.keys(ASSISTANT_SETUP_ROLES), required: false };

const modelRoutingReadInputValidator = deepFreeze({
  schema: createSchema({
    setup: routingSetup,
    choiceRole: { type: "string", enum: ASSISTANT_SETUP_ROLES.owner, required: false },
    choiceSearch: { type: "string", noTrim: false, maxLength: 200, required: false },
    choiceOffset: { type: "integer", min: 0, required: false }
  }), mode: "create"
});

const modelRoutingInputValidator = deepFreeze({
  schema: createSchema({
    revision: { type: "integer", min: 0, required: true },
    owner: setupValues("owner"),
    nonOwner: setupValues("nonOwner"),
    // Recommendations restricted to one provider and tool, for "Use as main AI" and the team card.
    preferProvider: { type: "object", required: false, schema: createSchema({
      setup: { ...routingSetup, required: true }, modelProviderId: routingIdentifier, engineId: { ...routingEngine, required: true }
    }) }
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
    engineId: { type: "string", enum: ["codex", "claude"], required: true },
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
  modelRoutingSelectionSchema,
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
