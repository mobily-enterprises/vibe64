import {
  modelRoutingInputValidator,
  codexProviderInputValidator,
  helperModelInputValidator,
  accountIdInputValidator,
  accountAuthSessionInputValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  gitIdentityInputValidator,
  personalAiProfileInputValidator
} from "./inputSchemas.js";
import {
  vibe64AccountAuthSessionChangedActionEvent,
  vibe64AccountsChangedActionEvent,
  vibe64ConnectionsChangedActionEvent
} from "./accountRealtimeEvents.js";

const ACTION_READ_CODEX_PROVIDERS = "vibe64.accounts.codex-providers.read";
const ACTION_READ_MODEL_ROUTING = "vibe64.accounts.model-routing.read";
const ACTION_SAVE_MODEL_ROUTING = "vibe64.accounts.model-routing.save";
const ACTION_SAVE_CODEX_PROVIDER = "vibe64.accounts.codex-providers.save";
const ACTION_REMOVE_CODEX_PROVIDER = "vibe64.accounts.codex-providers.remove";
const ACTION_READ_HELPER_MODEL = "vibe64.accounts.helper-model.read";
const ACTION_SAVE_HELPER_MODEL = "vibe64.accounts.helper-model.save";
const ACTION_READ_ACCOUNTS = "vibe64.accounts.read";
const ACTION_START_ACCOUNT_AUTH = "vibe64.accounts.auth.start";
const ACTION_LOGOUT_ACCOUNT = "vibe64.accounts.logout";
const ACTION_READ_ACCOUNT_AUTH_SESSION = "vibe64.accounts.auth-session.read";
const ACTION_CANCEL_ACCOUNT_AUTH_SESSION = "vibe64.accounts.auth-session.cancel";
const ACTION_SAVE_GIT_IDENTITY = "vibe64.accounts.git-identity.save";
const ACTION_SAVE_PERSONAL_AI_PROFILE = "vibe64.accounts.personal-ai-profile.save";

function createActions({ accounts } = {}) {
  if (!accounts || typeof accounts.getStatus !== "function") {
    throw new TypeError("createActions requires the Vibe64 Accounts API.");
  }

  return Object.freeze([
    {
      id: ACTION_READ_MODEL_ROUTING, version: 1, kind: "query", input: accountsReadInputValidator,
      output: null, idempotency: "none", audit: { actionName: ACTION_READ_MODEL_ROUTING }, observability: {},
      execute: (input) => accounts.readModelRouting(input)
    },
    {
      id: ACTION_SAVE_MODEL_ROUTING, version: 1, kind: "command", input: modelRoutingInputValidator,
      output: null, idempotency: "optional", audit: { actionName: ACTION_SAVE_MODEL_ROUTING }, observability: {},
      events: [vibe64AccountsChangedActionEvent(), vibe64ConnectionsChangedActionEvent()],
      execute: (input) => accounts.saveModelRouting(input)
    },
    {
      id: ACTION_READ_CODEX_PROVIDERS,
      version: 1,
      kind: "query",
      input: accountsReadInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: ACTION_READ_CODEX_PROVIDERS },
      observability: {},
      execute: (input) => accounts.readCodexProviders(input)
    },
    {
      id: ACTION_SAVE_CODEX_PROVIDER,
      version: 1,
      kind: "command",
      input: codexProviderInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: ACTION_SAVE_CODEX_PROVIDER },
      observability: {},
      events: [vibe64AccountsChangedActionEvent(), vibe64ConnectionsChangedActionEvent()],
      execute: (input) => accounts.saveCodexProvider(input)
    },
    {
      id: ACTION_REMOVE_CODEX_PROVIDER,
      version: 1,
      kind: "command",
      input: codexProviderInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: ACTION_REMOVE_CODEX_PROVIDER },
      observability: {},
      events: [vibe64AccountsChangedActionEvent(), vibe64ConnectionsChangedActionEvent()],
      execute: (input) => accounts.removeCodexProvider(input)
    },
    {
      id: ACTION_READ_HELPER_MODEL,
      version: 1,
      kind: "query",
      input: accountsReadInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: ACTION_READ_HELPER_MODEL },
      observability: {},
      execute: (input) => accounts.readHelperModel(input)
    },
    {
      id: ACTION_SAVE_HELPER_MODEL,
      version: 1,
      kind: "command",
      input: helperModelInputValidator,
      output: null,
      idempotency: "optional",
      audit: { actionName: ACTION_SAVE_HELPER_MODEL },
      observability: {},
      execute: (input) => accounts.saveHelperModel(input)
    },
    {
      id: ACTION_READ_ACCOUNTS,
      version: 1,
      kind: "query",
      input: accountsReadInputValidator,
      output: null,
      idempotency: "none",
      audit: {
        actionName: ACTION_READ_ACCOUNTS
      },
      observability: {},
      async execute(input) {
        return accounts.getStatus(input);
      }
    },
    {
      id: ACTION_LOGOUT_ACCOUNT,
      version: 1,
      kind: "command",
      input: accountIdInputValidator,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: ACTION_LOGOUT_ACCOUNT
      },
      observability: {},
      events: [
        vibe64AccountsChangedActionEvent(),
        vibe64ConnectionsChangedActionEvent()
      ],
      async execute(input) {
        return accounts.logout(input);
      }
    },
    {
      id: ACTION_SAVE_GIT_IDENTITY,
      version: 1,
      kind: "command",
      input: gitIdentityInputValidator,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: ACTION_SAVE_GIT_IDENTITY
      },
      observability: {},
      events: [
        vibe64AccountsChangedActionEvent(),
        vibe64ConnectionsChangedActionEvent()
      ],
      async execute(input) {
        return accounts.saveGitIdentity(input);
      }
    },
    {
      id: ACTION_SAVE_PERSONAL_AI_PROFILE,
      version: 1,
      kind: "command",
      input: personalAiProfileInputValidator,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: ACTION_SAVE_PERSONAL_AI_PROFILE
      },
      observability: {},
      events: [
        vibe64AccountsChangedActionEvent()
      ],
      async execute(input) {
        return accounts.savePersonalAiProfile(input);
      }
    },
    {
      id: ACTION_START_ACCOUNT_AUTH,
      version: 1,
      kind: "command",
      input: accountAuthStartInputValidator,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: ACTION_START_ACCOUNT_AUTH
      },
      observability: {},
      events: [
        vibe64AccountsChangedActionEvent(),
        vibe64ConnectionsChangedActionEvent(),
        vibe64AccountAuthSessionChangedActionEvent()
      ],
      async execute(input) {
        return accounts.startAuth(input);
      }
    },
    {
      id: ACTION_READ_ACCOUNT_AUTH_SESSION,
      version: 1,
      kind: "query",
      input: accountAuthSessionInputValidator,
      output: null,
      idempotency: "none",
      audit: {
        actionName: ACTION_READ_ACCOUNT_AUTH_SESSION
      },
      observability: {},
      async execute(input) {
        return accounts.readAuthSession(input);
      }
    },
    {
      id: ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
      version: 1,
      kind: "command",
      input: accountAuthSessionInputValidator,
      output: null,
      idempotency: "optional",
      audit: {
        actionName: ACTION_CANCEL_ACCOUNT_AUTH_SESSION
      },
      observability: {},
      async execute(input) {
        return accounts.cancelAuthSession(input);
      }
    }
  ]);
}

export {
  ACTION_READ_MODEL_ROUTING, ACTION_SAVE_MODEL_ROUTING,
  ACTION_READ_CODEX_PROVIDERS,
  ACTION_SAVE_CODEX_PROVIDER,
  ACTION_REMOVE_CODEX_PROVIDER,
  ACTION_READ_HELPER_MODEL,
  ACTION_SAVE_HELPER_MODEL,
  ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
  ACTION_LOGOUT_ACCOUNT,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_SAVE_GIT_IDENTITY,
  ACTION_SAVE_PERSONAL_AI_PROFILE,
  ACTION_START_ACCOUNT_AUTH,
  createActions
};
