import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";
import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const vibe64UserInputSchema = {
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const accountsReadInputValidator = deepFreeze({
  schema: createSchema({
    providerId: { type: "string", enum: ["codex", "claude"], required: false },
    ...vibe64UserInputSchema,
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
  mode: "patch"
});

const accountAuthStartInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
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
  mode: "patch"
});

const gitIdentityInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
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
  mode: "patch"
});

const helperModelInputValidator = deepFreeze({
  schema: createSchema({
    providerId: { type: "string", enum: ["codex", "claude"], required: false },
    ...vibe64UserInputSchema,
    modelId: {
      type: "string",
      required: true,
      maxLength: 200
    }
  }),
  mode: "patch"
});

const modelRoutingInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    revision: { type: "integer", min: 0, required: true },
    orchestrators: { type: "object", additionalProperties: true, required: true }
  }), mode: "patch"
});

const accountIdInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    accountId: {
      type: "string",
      required: true,
      minLength: 1
    }
  }),
  mode: "patch"
});

const accountAuthSessionInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    sessionId: {
      type: "string",
      required: true,
      minLength: 1
    }
  }),
  mode: "patch"
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
  mode: "patch"
});

const personalAiProfileInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    preferredName: {
      type: "string",
      required: false
    }
  }),
  mode: "patch"
});

const codexProviderInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    modelProviderId: { type: "string", enum: CURATED_CODEX_PROVIDERS.map(({ id }) => id), required: true },
    apiKey: { type: "string", maxLength: 16384, required: false }
  }), mode: "patch"
});

export {
  modelRoutingInputValidator,
  codexProviderInputValidator,
  helperModelInputValidator,
  accountIdInputValidator,
  accountAuthSessionParamsValidator,
  accountAuthSessionInputValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  gitIdentityInputValidator,
  personalAiProfileInputValidator
};
