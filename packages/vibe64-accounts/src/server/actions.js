import {
  accountIdInputValidator,
  accountAuthSessionInputValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  gitIdentityInputValidator
} from "./inputSchemas.js";

const ACTION_READ_ACCOUNTS = "feature.vibe64-accounts.read";
const ACTION_START_ACCOUNT_AUTH = "feature.vibe64-accounts.auth.start";
const ACTION_LOGOUT_ACCOUNT = "feature.vibe64-accounts.logout";
const ACTION_READ_ACCOUNT_AUTH_SESSION = "feature.vibe64-accounts.auth-session.read";
const ACTION_CANCEL_ACCOUNT_AUTH_SESSION = "feature.vibe64-accounts.auth-session.cancel";
const ACTION_SAVE_GIT_IDENTITY = "feature.vibe64-accounts.git-identity.save";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_ACCOUNTS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
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
    surfaces: ["app"],
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
    id: ACTION_SAVE_GIT_IDENTITY,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: gitIdentityInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_GIT_IDENTITY
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveGitIdentity(input);
    }
  },
  {
    id: ACTION_START_ACCOUNT_AUTH,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
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
    surfaces: ["app"],
    input: accountAuthSessionInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_ACCOUNT_AUTH_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readAuthSession(input);
    }
  },
  {
    id: ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: accountAuthSessionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_CANCEL_ACCOUNT_AUTH_SESSION
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.cancelAuthSession(input);
    }
  }
]);

export {
  ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
  ACTION_LOGOUT_ACCOUNT,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_SAVE_GIT_IDENTITY,
  ACTION_START_ACCOUNT_AUTH,
  featureActions
};
