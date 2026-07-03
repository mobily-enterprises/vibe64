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

export {
  accountIdInputValidator,
  accountAuthSessionParamsValidator,
  accountAuthSessionInputValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  gitIdentityInputValidator
};
