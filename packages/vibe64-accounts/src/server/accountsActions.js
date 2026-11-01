import { modelRoutingTool } from "./routingAssistantContracts.js";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { NOT_A_TOOL, WORKSPACE_OPERATION } from "@local/vibe64-core/server/actionContext";
import {
  aiConnectionInputValidators,
  modelRoutingInputValidator,
  modelRoutingReadInputValidator,
  codexProviderInputValidator,
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

/** @typedef {import("./types.js").AccountsService} AccountsService */
/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {ReturnType<typeof import("./aiConnectionService.js").createAiConnectionService>} AiConnectionService */

const ACTION_READ_CODEX_PROVIDERS = "vibe64.accounts.codex-providers.read";
const ACTION_READ_MODEL_ROUTING = "vibe64.accounts.model-routing.read";
const ACTION_SAVE_MODEL_ROUTING = "vibe64.accounts.model-routing.save";
const ACTION_PREVIEW_MODEL_ROUTING = "vibe64.accounts.model-routing.preview";
const ACTION_SAVE_CODEX_PROVIDER = "vibe64.accounts.codex-providers.save";
const ACTION_REMOVE_CODEX_PROVIDER = "vibe64.accounts.codex-providers.remove";
const ACTION_READ_ACCOUNTS = "vibe64.accounts.read";
const ACTION_START_ACCOUNT_AUTH = "vibe64.accounts.auth.start";
const ACTION_LOGOUT_ACCOUNT = "vibe64.accounts.logout";
const ACTION_READ_ACCOUNT_AUTH_SESSION = "vibe64.accounts.auth-session.read";
const ACTION_CANCEL_ACCOUNT_AUTH_SESSION = "vibe64.accounts.auth-session.cancel";
const ACTION_SAVE_GIT_IDENTITY = "vibe64.accounts.git-identity.save";
const ACTION_SAVE_PERSONAL_AI_PROFILE = "vibe64.accounts.personal-ai-profile.save";

const gitIdentityText = { type: "string", maxLength: 512, required: false };
// Saves only the person's own Git name and email; the account object stays out.
const gitIdentityTool = Object.freeze({
  description: "Save the signed-in person's own Git name and email (git config --global user.name and user.email in their tool home), as Save Git identity does on Account settings → GitHub; this clears Health's Your name in Git warning. Use only values the person stated in this conversation for this purpose; never guess them from a GitHub username, an email seen elsewhere or a stand-in name. The email must be a valid address. This replaces both values for future Saves; it does not rewrite earlier commits, sign in to GitHub or change anyone else's identity. Report the returned values.",
  output: { mode: "replace", schema: createSchema({
    ok: { type: "boolean", required: true }, error: gitIdentityText, code: gitIdentityText,
    gitUserName: gitIdentityText, gitUserEmail: gitIdentityText
  }) },
  transformResult(result = {}) {
    const identity = result.account?.gitIdentity || {};
    const code = result.code || result.errors?.[0]?.code;
    return { ok: result.ok === true,
      ...(typeof result.error === "string" ? { error: result.error.slice(0, 512) } : {}),
      ...(typeof code === "string" ? { code: code.slice(0, 512) } : {}),
      ...(typeof identity.name === "string" ? { gitUserName: identity.name.slice(0, 512) } : {}),
      ...(typeof identity.email === "string" ? { gitUserEmail: identity.email.slice(0, 512) } : {}) };
  }
});

// The owner's saved API connections, as facts only.
const aiConnectionsListTool = Object.freeze({
  description: "Read the owner's saved API connections in AI Accounts, without a project: one row per saved provider (for example Z.AI, Z.AI Coding Plan, OpenRouter or OpenCode Zen) with provider, label, ready, reason when not ready, preferred, defaultModelId and modelAccessMode. An empty list means nothing is saved; unavailable means the host has no connection store. ready is saved state only: it does not verify current credentials, balance, model entitlement or running conversations. Claude and Codex sign-ins are not saved connections. Regular Z.AI and a Z.AI Coding Plan are separate connections. Use Model routing read for actual future workflow assignments and offered choices; the preferred provider/default model is not the Senior assignment or Colleague's model. The person must register, enter the key and consent to paid models in AI Accounts. Never request a key in chat or infer setup completion from a quiz answer.",
  output: { mode: "replace", schema: createSchema({
    ok: { type: "boolean", required: true },
    unavailable: { type: "boolean", required: true },
    error: { type: "string", maxLength: 512, required: false },
    connections: { type: "array", required: true, maxItems: 100, items: createSchema({
      provider: { type: "string", maxLength: 256, required: true },
      label: { type: "string", maxLength: 256, required: true },
      ready: { type: "boolean", required: true },
      reason: { type: "string", maxLength: 256, required: true },
      preferred: { type: "boolean", required: true },
      defaultModelId: { type: "string", maxLength: 512, required: true },
      modelAccessMode: { type: "string", maxLength: 64, nullable: true, required: true }
    }) }
  }) },
  // Only facts about each connection: never its key, key hint or fingerprint.
  transformResult(result) {
    if (result.ok !== true) return {
      ok: false, unavailable: false, connections: [],
      error: "Saved AI connection status could not be read. Go to AI Accounts for details."
    };
    return { ok: true, unavailable: result.unavailable === true, connections: result.connections.slice(0, 100).map(row => ({
      provider: String(row.modelProviderId || "").slice(0, 256),
      label: String(row.label || row.modelProviderId || "").slice(0, 256),
      ready: row.connected === true,
      reason: row.connected === true ? "" : "No default model is known for this provider. Reconnect it in AI Accounts.",
      preferred: row.preferred === true,
      defaultModelId: String(row.defaultModelId || "").slice(0, 512),
      modelAccessMode: typeof row.modelAccess?.mode === "string" ? row.modelAccess.mode.slice(0, 64) : null
    })) };
  }
});

/**
 * @param {object} dependencies
 * @param {AccountsService} dependencies.accounts
 */
function createAccountsActions({ accounts }) {
  return Object.freeze([
    Object.freeze({
      extensions: { assistant: modelRoutingTool("read"), vibe64: WORKSPACE_OPERATION },
      id: ACTION_READ_MODEL_ROUTING, version: 1, kind: "query", input: modelRoutingReadInputValidator,
      output: null, idempotency: "none",
      execute: (input) => accounts.readModelRouting(input)
    }),
    Object.freeze({
      extensions: { assistant: modelRoutingTool("preview"), vibe64: WORKSPACE_OPERATION },
      id: ACTION_PREVIEW_MODEL_ROUTING, version: 1, kind: "query", input: modelRoutingInputValidator,
      output: null, idempotency: "none",
      execute: (input) => accounts.previewModelRouting(input)
    }),
    Object.freeze({
      extensions: { assistant: modelRoutingTool("save"), vibe64: WORKSPACE_OPERATION },
      id: ACTION_SAVE_MODEL_ROUTING, version: 1, kind: "command", input: modelRoutingInputValidator,
      output: null, idempotency: "optional",
      events: [vibe64AccountsChangedActionEvent(), vibe64ConnectionsChangedActionEvent()],
      execute: (input) => accounts.saveModelRouting(input)
    }),
    Object.freeze({
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      id: ACTION_READ_CODEX_PROVIDERS,
      version: 1,
      kind: "query",
      input: accountsReadInputValidator,
      output: null,
      idempotency: "none",
      execute: (input) => accounts.readCodexProviders(input)
    }),
    Object.freeze({
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      id: ACTION_SAVE_CODEX_PROVIDER,
      version: 1,
      kind: "command",
      input: codexProviderInputValidator,
      output: null,
      idempotency: "none",
      events: [vibe64AccountsChangedActionEvent(), vibe64ConnectionsChangedActionEvent()],
      execute: (input) => accounts.saveCodexProvider(input)
    }),
    Object.freeze({
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      id: ACTION_REMOVE_CODEX_PROVIDER,
      version: 1,
      kind: "command",
      input: codexProviderInputValidator,
      output: null,
      idempotency: "none",
      events: [vibe64AccountsChangedActionEvent(), vibe64ConnectionsChangedActionEvent()],
      execute: (input) => accounts.removeCodexProvider(input)
    }),
    Object.freeze({
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      id: ACTION_READ_ACCOUNTS,
      version: 1,
      kind: "query",
      input: accountsReadInputValidator,
      output: null,
      idempotency: "none",
      execute: (input) => accounts.getStatus(input)
    }),
    Object.freeze({
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      id: ACTION_LOGOUT_ACCOUNT,
      version: 1,
      kind: "command",
      input: accountIdInputValidator,
      output: null,
      idempotency: "optional",
      events: [
        vibe64AccountsChangedActionEvent(),
        vibe64ConnectionsChangedActionEvent()
      ],
      execute: (input) => accounts.logout(input)
    }),
    Object.freeze({
      extensions: { assistant: gitIdentityTool, vibe64: WORKSPACE_OPERATION },
      id: ACTION_SAVE_GIT_IDENTITY,
      version: 1,
      kind: "command",
      input: gitIdentityInputValidator,
      output: null,
      idempotency: "optional",
      events: [
        vibe64AccountsChangedActionEvent(),
        vibe64ConnectionsChangedActionEvent()
      ],
      execute: (input) => accounts.saveGitIdentity(input)
    }),
    Object.freeze({
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      id: ACTION_SAVE_PERSONAL_AI_PROFILE,
      version: 1,
      kind: "command",
      input: personalAiProfileInputValidator,
      output: null,
      idempotency: "optional",
      events: [
        vibe64AccountsChangedActionEvent()
      ],
      execute: (input) => accounts.savePersonalAiProfile(input)
    }),
    Object.freeze({
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      id: ACTION_START_ACCOUNT_AUTH,
      version: 1,
      kind: "command",
      input: accountAuthStartInputValidator,
      output: null,
      idempotency: "optional",
      events: [
        vibe64AccountsChangedActionEvent(),
        vibe64ConnectionsChangedActionEvent(),
        vibe64AccountAuthSessionChangedActionEvent()
      ],
      execute: (input) => accounts.startAuth(input)
    }),
    Object.freeze({
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      id: ACTION_READ_ACCOUNT_AUTH_SESSION,
      version: 1,
      kind: "query",
      input: accountAuthSessionInputValidator,
      output: null,
      idempotency: "none",
      execute: (input) => accounts.readAuthSession(input)
    }),
    Object.freeze({
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      id: ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
      version: 1,
      kind: "command",
      input: accountAuthSessionInputValidator,
      output: null,
      idempotency: "optional",
      execute: (input) => accounts.cancelAuthSession(input)
    })
  ]);
}

/**
 * @param {object} dependencies
 * @param {AiConnectionService} dependencies.aiConnectionService
 * @param {AccountsRuntime["requireAiManagement"]} dependencies.requireAiManagement
 */
function createAiConnectionActions({ aiConnectionService, requireAiManagement }) {
  // Every AI connection operation is the AI manager's alone.
  async function manageAiConnection(operation, input) {
    const denied = await requireAiManagement({ vibe64User: input.vibe64User });
    if (denied) return { ...denied, statusCode: 403 };
    return aiConnectionService[operation](input);
  }

  return Object.freeze([
    Object.freeze({
      id: "vibe64.accounts.ai-connections.list",
      version: 1,
      kind: "query",
      input: aiConnectionInputValidators.list,
      output: null,
      idempotency: "none",
      extensions: { assistant: aiConnectionsListTool, vibe64: WORKSPACE_OPERATION },
      execute: (input) => manageAiConnection("list", input)
    }),
    Object.freeze({
      id: "vibe64.accounts.ai-connections.catalog",
      version: 1,
      kind: "query",
      input: aiConnectionInputValidators.catalog,
      output: null,
      idempotency: "none",
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => manageAiConnection("catalog", input)
    }),
    Object.freeze({
      id: "vibe64.accounts.ai-connections.save",
      version: 1,
      kind: "command",
      input: aiConnectionInputValidators.save,
      output: null,
      idempotency: "none",
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => manageAiConnection("save", input)
    }),
    Object.freeze({
      id: "vibe64.accounts.ai-connections.remove",
      version: 1,
      kind: "command",
      input: aiConnectionInputValidators.remove,
      output: null,
      idempotency: "none",
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => manageAiConnection("remove", input)
    }),
    Object.freeze({
      id: "vibe64.accounts.ai-connections.modelAccess",
      version: 1,
      kind: "command",
      input: aiConnectionInputValidators.modelAccess,
      output: null,
      idempotency: "none",
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => manageAiConnection("modelAccess", input)
    })
  ]);
}

export {
  createAiConnectionActions,
  ACTION_PREVIEW_MODEL_ROUTING,
  ACTION_READ_MODEL_ROUTING, ACTION_SAVE_MODEL_ROUTING,
  ACTION_READ_CODEX_PROVIDERS,
  ACTION_SAVE_CODEX_PROVIDER,
  ACTION_REMOVE_CODEX_PROVIDER,
  ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
  ACTION_LOGOUT_ACCOUNT,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_SAVE_GIT_IDENTITY,
  ACTION_SAVE_PERSONAL_AI_PROFILE,
  ACTION_START_ACCOUNT_AUTH,
  createAccountsActions
};
