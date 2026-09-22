# Accounts, connections, and Studio health

People can connect the external accounts needed for agent and repository work
and see whether the Studio host is ready to support them.

## Sources

- `packages/vibe64-accounts/src/server/aiConnectionStore.js`
- `packages/vibe64-accounts/src/server/aiConnectionService.js`
- `packages/vibe64-accounts/src/server/aiConnectionRuntime.js`
- `packages/vibe64-accounts/src/server/assistantProviderPolicy.js`
- `packages/vibe64-accounts/src/server/zaiConnectionVerifier.js`
- `packages/vibe64-accounts/src/client/studio/AiConnectionsSettings.vue`
- `packages/vibe64-accounts/src/client/studio/FreeAiSelector.vue`
- `packages/vibe64-accounts/src/client/studio/freeAiStarters.js`
- `packages/vibe64-accounts/src/client/composables/useAiConnections.js`

- `packages/vibe64-core/src/shared/curatedCodexProviders.js`
- `packages/vibe64-core/src/server/codexProviderConnections.js`
- `packages/vibe64-accounts/src/client/studio/CodexProviderConnections.vue`
- `packages/vibe64-accounts/src/client/composables/useCodexProviderConnections.js`
- `src/components/studio/Vibe64AuthSettingsButton.vue`

- `packages/vibe64-core/src/server/nativeHelperModel.js`
- `packages/vibe64-accounts/bin/claude-auth-browser`
- `packages/studio-terminal-core/src/server/claudeRuntime.js`
- `packages/vibe64-accounts/src/client/studio/HelperModelSettings.vue`
- `packages/vibe64-accounts/src/client/studio/ProviderAccountsSetup.vue`
- `packages/vibe64-accounts/src/client/composables/useProviderAccountsSetup.js`

- `packages/vibe64-accounts/src/server/service.js`
- `packages/vibe64-accounts/src/server/registerRoutes.js`
- `packages/vibe64-core/src/server/terminalWebSocketRoutes.js`
- `packages/vibe64-accounts/src/server/Vibe64AccountsFeature.js`
- `packages/vibe64-accounts/src/client/composables/useAccountAuthSessions.js`
- `packages/vibe64-execution/src/server/engines/helperClient.js`
- `packages/vibe64-runtime/src/shared/assistantSelection.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/opencodeTerminal.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/studio-health/src/server/service.js`
- `src/components/studio/StudioHealthScreen.vue`
- `src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue`

## Public contract

Standalone and hosted editors compose the same AI Accounts screen, catalogue
validation, provider policy, connection store and runtime wiring. The local
Account settings dialog has You, AI Accounts and GitHub tabs. AI Accounts offers
Codex, Claude Code and OpenCode, including GPT, DeepSeek and GLM through Codex
and the current OpenCode provider catalogue. An AI connection request opens the
requested provider's setup. Hosts choose the API endpoint, credential context
and account-management authorization; they do not duplicate these forms or
provider operations.

OpenCode connections retain the existing versioned file at
`<systemRoot>/ai-connections/connections.json`. Native Codex and Claude login
keep using the existing host account context; curated Codex provider homes stay
under `<systemRoot>/ai-connections/codex`. Moving the implementation does not
copy keys, change file formats or merge separate installations' account stores.
The nested development editor preserves native credential context while keeping
its own runtime state.

The connection store supplies included OpenCode Big Pickle, with no Codex login
required. New OpenCode keys are checked against the complete trusted provider
catalogue and verified before replacing a working connection. The browser cannot
supply a network route, verification model or access policy. Only redacted
metadata is returned. Existing model-access restrictions, helper preferences,
Zen checks and runtime invalidation apply equally in both editions. All account
management routes use the host's management policy before reading or changing
connection state; request bodies cannot supply the acting user.

Codex provider setup offers GPT, DeepSeek and GLM. GPT keeps its existing
ChatGPT device login and OpenAI API-key flow. The curated catalogue owns the
DeepSeek API route and Z.AI's dedicated Coding Plan Responses route
(`https://api.z.ai/api/v1`). Regular Z.AI API keys remain an OpenCode option;
the regular `/api/paas/v4/responses` route returned 404 in the compatibility check.
The browser submits only a provider id and key. Connections use the provider's
name automatically, and the browser cannot set an endpoint. The existing host Codex-management policy authorizes reads and
mutations, and lists never return keys.

A bounded Responses request checks a new key before changing a working
connection. Replacement or removal marks that provider unavailable, drains only
its owned runtimes, and updates its private native configuration and auth
generation. Failure to prove process exit leaves the transition unavailable for
retry. Each curated provider has a separate home under the installation's
private `ai-connections/codex` state; OpenAI's credential home stays independent.
Disconnect removes credentials while retaining native conversation history.

The setup form uses the shared Accounts command feedback, clears unsaved keys
when changing providers, and keeps an in-flight save open. The shared AI Accounts list composes this form in both editions. DeepSeek is a
workspace-use API connection; the GLM plan is owner-only. Provider definitions
follow the official [DeepSeek Codex guide](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)
and [Z.AI Codex guide](https://docs.z.ai/devpack/tool/codex).
The native fixture verifies Vibe64's routing and lifecycle against a local
Responses server; it does not establish live provider availability or quota.

The owner can connect a Claude subscription through the existing Accounts flow.
The unmodified CLI runs `claude auth login --claudeai`. Its browser-opener
invocation writes an atomic private JSON handoff, giving the UI a Continue to
Claude button without parsing terminal prose. The handoff uses the pinned CLI's
hosted manual-code callback, so a browser on another machine never needs to
reach the VPS through localhost. The user pastes the browser's
authorization code into the guided form, which forwards it to the owned login
terminal. Claude performs the exchange and stores its own credentials. Realtime
completion rereads `claude auth status --json`; a failed login offers Try again,
and the native terminal remains available for recovery. Vibe64 neither reads
OAuth tokens nor implements a replacement OAuth client. Login and logout retire
the account's owned Claude processes before changing authentication.
The CLI's signed-out JSON response is a normal disconnected state even though
its exit code is nonzero.
Account status reads share one native query and reuse its public result for up
to 30 seconds while native credential and account-file metadata is unchanged.
Changes invalidate the result immediately; failures are not cached. The wrapper
does not read those files' contents. On macOS, where credentials can live in the
keychain, only concurrent reads are shared.
Model and allowance reads reuse a running process owned by the current account.
When no such process exists, a temporary query publishes cached results only
after verified process exit. Failed cleanup stays owned for retry
before another query or authentication change; a failed query whose process
stopped does not block switching accounts.
Starting sign-in again returns the existing matching login session before
requesting another managed execution. A closing login reports that it is still
finishing, so retries cannot wait for a resource scope that was never launched.

The Accounts surface reports required providers, guides supported sign-in, and
keeps credentials in host-owned storage. The session picker names Codex and
Claude explicitly, with their model in the description. Connected choices have
no recommendation badge; the preferred choice still controls initial selection.
Native Codex availability comes from the Accounts service's sign-in state,
including disconnection and required reconnection. Overall AI readiness accepts
any connected assistant, including included OpenCode or Claude; missing Codex
authentication does not fail readiness. Studio Health consumes this aggregate
AI status and the project's required repository connections rather than forcing
a Codex/GitHub pair for every project. With no connected AI, the
session picker directs the user to account setup before creating a session.
Studio health performs read-only checks
of workspace access, account readiness, command-line tools, Genesis, and the
managed browser runtime. Failures identify the concrete host capability that is
missing without attempting project-specific repairs.
The managed launcher relies on cgroup v2 CPU accounting and does not assign the
deprecated `CPUAccounting` property. Launcher deprecation output must not precede
version output and make installed runtimes appear unavailable.
The browser check validates the pinned Chromium installation and launches its
headless shell within the bounded health job, rather than starting desktop
browser services. Execution failure reasons take precedence over incidental
browser log messages in the short Health summary.

Account sign-in completion arrives through actor-scoped realtime refresh hints
when available. The hint contains only the session identity and status version;
the browser rereads the protected auth-session endpoint for output and account
state. A bounded fallback check remains available for missed events, but
repeated failures back off instead of keeping the browser in a tight retry
loop.

Account sign-in and sign-out are account-wide operations and do not require a
selected project. The login terminal uses the same workspace scope as its HTTP
routes, including code submission and terminal recovery, while preserving the
signed-in user's account access checks. Connected Codex status includes the ChatGPT email from the
selected account's local identity token when available, without exposing tokens,
starting a runtime, or changing the authentication generation. Missing identity
metadata and API-key connections remain usable without an email. The connection
surface shows a Disconnect action for connected accounts and sign-in choices for
disconnected accounts. The setup title, connection status and Refresh action
share one wrapping header row, with an optional Close control at the top right.
Codex device sign-in uses a single-column Prepare / Connect flow. The code
and adjacent Copy action share a responsive surface; Continue to ChatGPT is
the primary authorization action. Each step keeps its reference screenshot
behind an optional help disclosure. Copy feedback is announced in place,
code preparation reserves a skeleton region. The authorization step omits a
repeated introduction and routine waiting message once its code is ready.
The settings link and continue action share a wrapping row. Previous step and
Cancel login sit beside the overall sign-in status, and the terminal uses its
existing surface-class seam for a distinct themed background. Active sign-in replaces disconnected warning chrome
with a neutral status; the existing session polling, authorization URL, API-key
choice and terminal recovery continue to own authentication.
When Codex authentication changes, Vibe64 retires active and
detached owned Codex runtimes before accepting the new account state. It reports
success only after process exit is verified; a runtime that cannot be proven
stopped leaves the account transition visibly unsuccessful rather than allowing
an old credential-bearing process to survive silently.
If isolated temporary runtime removal finishes before thread deletion, cleanup
reconciles the removed runtime's ownership records without reconnecting to its
old account. The same reconciliation works on a later status retry in the
running server. When the shared process has a verified exit and retained exit
proof, a helper already durably marked `cleanup_required` can be detached from
its stopped client without blocking the account transition. Its history and
ownership record remain for the next connection's ordinary cleanup retry; this
does not claim deletion or resume the old account's work. An unverified exit or
failure to persist that cleanup state still fails the transition. A successful
sign-in status refresh clears the earlier login error in the browser.

An ordinary account read automatically retries a persisted `reconnecting`
transition through the same live status and runtime-retirement path, including
after a server restart. Concurrent status readers share that recovery, while
sign-in completion waits for an existing read before checking the new
credentials. Failed retirement leaves the transition pending for a later read;
settled account reads remain local. Recovery happens when account status is
requested, without adding a background timer. A confirmed `reconnect_required`
state still requires a new sign-in.

The assistant-capability service can read the complete provider registry from
the pinned OpenCode runtime without a project or configured provider
credentials. It starts a temporary OpenCode service, gives only native Zen's
non-secret `public` identity so paid definitions are not hidden, reads the
native provider and agent APIs, proves that service stopped, and removes its
private state. Provider data is allowlist-sanitized before caching: consumers
receive exact provider ids, native defaults, safe model capabilities and limits,
definition revisions, and whether Vibe64's one-key connection flow is
compatible, but never raw environment names, credentials, request options,
headers, costs, or upstream connection state. Malformed and empty registries
fail instead of becoming an authoritative empty catalogue.

For OpenCode Zen, Vibe64 also reads Zen's official public `/v1/models` endpoint
and reconciles those current ids with the pinned runtime's complete sanitized
metadata. A newly advertised id missing from that runtime receives only a safe
id-and-label fallback until OpenCode supplies its metadata; an actual key check
still decides whether it works. The bounded request sends no provider
credential, neither catalogue operation reads a saved owner key, and a failed
or malformed response remains a retryable catalogue failure instead of
exposing stale Zen models. This live Zen result shares the existing short-lived
catalogue cache; it is loaded only by explicit full-catalogue operations, never
by opening or creating a session or sending its first message.

The host may contribute redacted connection metadata that marks a connection
as built in, identifies the preferred new-session provider, and restricts it to
one recommended model or a finite enabled-model allowlist. The sanitized
catalogue retains other live model records with a locked status and
host-supplied explanation, while selection resolution and the session selector
expose only available models. A
generic owner-authenticated model-access operation delegates a warned unlock or
relock to the host; a host may reserve more involved account-management actions
for its own management surface. The public Accounts service owns the provider policy and protected connection
store. Runtime admission checks that policy again, so a durable selection cannot
bypass a later restriction.

Zen's rotating model roster never makes its saved connection stale. Provider
revision checks still protect connection setup and other provider definitions,
while current Zen ids independently control which models are presented. The
host's recommended Big Pickle entry therefore remains connected and available
when paid models rotate or a prior session selection is no longer enabled.

The short-lived private-credential-free catalogue snapshot is independent of
credential-bearing assistant runtimes. Replacing or removing a connection
still retires those runtimes, but does not discard an unexpired catalogue and
force an otherwise redundant cold discovery.

A host may ask Vibe64 to verify one exact OpenCode provider, model, and API key.
Vibe64 first checks that provider and model against the same current catalogue,
including Zen's live model ids for the native Zen provider, then runs one
finite, tool-free request with a tiny output allowance
in isolated temporary credential storage. Provider rejection is distinct from
a stale catalogue or unavailable managed execution, error details do not expose
the submitted secret, and the temporary credential state is removed on every
outcome. No provider URL override is required: the pinned OpenCode runtime owns
its native provider destinations.

Native helper-model preferences belong to the connection, outside project source,
at `<systemRoot>/ai-connections/<provider>-helper-model.json` for Codex and Claude.
Claude's Recommended choice is Haiku. Both use the same Helper model dialog;
Claude also accepts models without a thinking control. An empty model ID means
Recommended and resolves the code default at execution time. Account management
authorization also protects reads and writes of this preference. The account
API offers live models supporting low thinking, rejects unavailable choices,
and preserves unreadable settings instead of replacing them. Each new economy
profile captures the saved choice; existing profiles and the main assistant are
unchanged. The shared Helper model dialog is also available to hosts for their
own connection-owned preferences through an explicit endpoint.
