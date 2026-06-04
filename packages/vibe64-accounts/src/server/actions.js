import {
  accountIdInputValidator,
  accountAuthSessionInputValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  opencodeProviderAuthInputValidator,
  opencodeProviderOAuthInputValidator
} from "./inputSchemas.js";

const ACTION_READ_ACCOUNTS = "feature.vibe64-accounts.read";
const ACTION_START_ACCOUNT_AUTH = "feature.vibe64-accounts.auth.start";
const ACTION_LOGOUT_ACCOUNT = "feature.vibe64-accounts.logout";
const ACTION_READ_ACCOUNT_AUTH_SESSION = "feature.vibe64-accounts.auth-session.read";
const ACTION_CANCEL_ACCOUNT_AUTH_SESSION = "feature.vibe64-accounts.auth-session.cancel";
const ACTION_SET_OPENCODE_PROVIDER_AUTH = "feature.vibe64-accounts.opencode-provider.auth.set";
const ACTION_START_OPENCODE_PROVIDER_OAUTH = "feature.vibe64-accounts.opencode-provider.oauth.start";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_ACCOUNTS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: accountsReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_ACCOUNTS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.getStatus(input);
    }
  },
  {
    id: ACTION_LOGOUT_ACCOUNT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: accountIdInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_LOGOUT_ACCOUNT
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.logout(input);
    }
  },
  {
    id: ACTION_START_ACCOUNT_AUTH,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: accountAuthStartInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START_ACCOUNT_AUTH
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.startAuth(input);
    }
  },
  {
    id: ACTION_READ_ACCOUNT_AUTH_SESSION,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: accountAuthSessionInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_ACCOUNT_AUTH_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readAuthSession(input.sessionId);
    }
  },
  {
    id: ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: accountAuthSessionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_CANCEL_ACCOUNT_AUTH_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.cancelAuthSession(input.sessionId);
    }
  },
  {
    id: ACTION_SET_OPENCODE_PROVIDER_AUTH,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: opencodeProviderAuthInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SET_OPENCODE_PROVIDER_AUTH
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.setOpenCodeProviderAuth(input);
    }
  },
  {
    id: ACTION_START_OPENCODE_PROVIDER_OAUTH,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: opencodeProviderOAuthInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START_OPENCODE_PROVIDER_OAUTH
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.startOpenCodeProviderOAuth(input);
    }
  }
]);

export {
  ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
  ACTION_LOGOUT_ACCOUNT,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_START_ACCOUNT_AUTH,
  ACTION_START_OPENCODE_PROVIDER_OAUTH,
  ACTION_SET_OPENCODE_PROVIDER_AUTH,
  featureActions
};
