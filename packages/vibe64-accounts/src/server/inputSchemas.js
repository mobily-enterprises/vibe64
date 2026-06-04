import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const accountsReadInputValidator = deepFreeze({
  schema: createSchema({
    refresh: {
      type: "boolean",
      required: false
    }
  }),
  mode: "patch"
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
    }
  }),
  mode: "patch"
});

const accountIdInputValidator = deepFreeze({
  schema: createSchema({
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
    sessionId: {
      type: "string",
      required: true,
      minLength: 1
    }
  }),
  mode: "patch"
});

const opencodeProviderAuthInputValidator = deepFreeze({
  schema: createSchema({
    apiKey: {
      type: "string",
      noTrim: false,
      required: true,
      minLength: 1
    },
    providerId: {
      type: "string",
      noTrim: false,
      required: true,
      minLength: 1
    }
  }),
  mode: "patch"
});

const opencodeProviderOAuthInputValidator = deepFreeze({
  schema: createSchema({
    methodIndex: {
      type: "string",
      noTrim: false,
      required: true,
      minLength: 1
    },
    providerId: {
      type: "string",
      noTrim: false,
      required: true,
      minLength: 1
    }
  }),
  mode: "patch"
});

export {
  accountIdInputValidator,
  accountAuthSessionInputValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  opencodeProviderAuthInputValidator,
  opencodeProviderOAuthInputValidator
};
