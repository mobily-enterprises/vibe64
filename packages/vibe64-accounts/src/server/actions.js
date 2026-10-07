import { modelRoutingTool } from "./routingAssistantContracts.js";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
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

const ACTION_READ_CODEX_PROVIDERS = "vibe64.accounts.codex-providers.read";
const ACTION_READ_MODEL_ROUTING = "vibe64.accounts.model-routing.read";
const ACTION_READ_MODEL_ROUTING_WORKFLOWS = "vibe64.accounts.model-routing.workflows.read";
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

function createActions({ accounts } = {}) {
  if (!accounts || typeof accounts.getStatus !== "function") {
    throw new TypeError("createActions requires the Vibe64 Accounts API.");
  }

  return Object.freeze([
    {
      id: ACTION_READ_MODEL_ROUTING_WORKFLOWS, version: 1, kind: "query", input: accountsReadInputValidator,
      output: null, idempotency: "none", audit: { actionName: ACTION_READ_MODEL_ROUTING_WORKFLOWS }, observability: {},
      execute: (input) => accounts.readModelRoutingWorkflows(input)
    },
    {
      extensions: { assistant: modelRoutingTool("read") },
      id: ACTION_READ_MODEL_ROUTING, version: 1, kind: "query", input: modelRoutingReadInputValidator,
      output: null, idempotency: "none", audit: { actionName: ACTION_READ_MODEL_ROUTING }, observability: {},
      execute: (input) => accounts.readModelRouting(input)
    },
    {
      extensions: { assistant: modelRoutingTool("preview") },
      id: ACTION_PREVIEW_MODEL_ROUTING, version: 1, kind: "query", input: modelRoutingInputValidator,
      output: null, idempotency: "none", audit: { actionName: ACTION_PREVIEW_MODEL_ROUTING }, observability: {},
      execute: (input) => accounts.previewModelRouting(input)
    },
    {
      extensions: { assistant: modelRoutingTool("save") },
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
  ].map((definition) => withVibe64ActionContext({
    ...definition, extensions: definition.extensions || { assistant: { exclude: true } }
  }, { projectScoped: false })));
}

function createAiConnectionActions({ aiConnectionService, requireAiManagement = () => null } = {}) {
  if (!aiConnectionService || typeof requireAiManagement !== "function") {
    throw new TypeError("AI connection actions require the connection service and host management policy.");
  }
  return Object.entries(aiConnectionInputValidators).map(([operation, input]) => withVibe64ActionContext({
    id: `vibe64.accounts.ai-connections.${operation}`,
    version: 1, kind: ["list", "catalog"].includes(operation) ? "query" : "command",
    input, output: null, idempotency: "none",
    audit: { actionName: `vibe64.accounts.ai-connections.${operation}` }, observability: {},
    extensions: { assistant: operation === "list" ? {
      description: "Read the owner's saved regular Z.AI API connection status for account setup, without a project. Returns only saved connection, preferred-provider, default-model and model-access policy facts. A missing connection is null; unavailable means the host has no connection store. This does not verify current credentials, balance, model entitlement or running conversations. Regular Z.AI and a Personal Coding Plan are separate connections. Use Model routing read for actual future workflow assignments and offered choices; the preferred provider/default model is not the Senior assignment or Colleague's model. The person must register, enter the key and consent to paid models in AI Accounts. Never request a key in chat or infer setup completion from a quiz answer.",
      output: { mode: "replace", schema: createSchema({
        ok: { type: "boolean", required: true },
        unavailable: { type: "boolean", required: true },
        error: { type: "string", maxLength: 512, required: false },
        zai: { type: "object", nullable: true, required: true, schema: createSchema({
          modelProviderId: { type: "string", enum: ["zai"], required: true },
          connected: { type: "boolean", required: true },
          preferred: { type: "boolean", required: true },
          defaultModelId: { type: "string", maxLength: 512, required: true },
          modelAccessMode: { type: "string", enum: ["recommended", "all"], nullable: true, required: true }
        }) }
      }) },
      transformResult(result) {
        if (result.ok !== true) return {
          ok: false, unavailable: false, zai: null,
          error: "Saved AI connection status could not be read. Open AI Accounts for details."
        };
        const connection = result.connections.find(row => row.modelProviderId === "zai");
        return { ok: true, unavailable: result.unavailable === true, zai: connection ? {
          modelProviderId: "zai", connected: connection.connected === true,
          preferred: connection.preferred === true,
          defaultModelId: String(connection.defaultModelId || "").slice(0, 512),
          modelAccessMode: ["recommended", "all"].includes(connection.modelAccess?.mode)
            ? connection.modelAccess.mode : null
        } : null };
      }
    } : { exclude: true } },
    async execute(input) {
      if (operation === "list" && input.vibe64User && input.vibe64User.role !== "owner") {
        throw Object.assign(new Error("Only the workspace owner can read saved AI connection status."), {
          code: "vibe64_owner_required", statusCode: 403
        });
      }
      const denied = await requireAiManagement({ vibe64User: input.vibe64User });
      if (denied) return { ...denied, statusCode: 403 };
      return aiConnectionService[operation](input);
    }
  }, { projectScoped: false }));
}

export {
  createAiConnectionActions,
  ACTION_PREVIEW_MODEL_ROUTING,
  ACTION_READ_MODEL_ROUTING, ACTION_READ_MODEL_ROUTING_WORKFLOWS, ACTION_SAVE_MODEL_ROUTING,
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
  createActions
};
