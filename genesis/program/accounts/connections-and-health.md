# Accounts, connections, and Studio health

People can connect the external accounts needed for agent and repository work
and see whether the Studio host is ready to support them.

## Sources

- `packages/vibe64-core/src/server/codexAuthState.js`

- `packages/vibe64-core/src/server/assistantRoutingStore.js`
- `packages/vibe64-accounts/src/server/assistantRoutingUpgrade.js`
- `packages/vibe64-accounts/src/server/assistantRoleUpgrade.js`
- `packages/vibe64-core/src/server/stateUpgrades/20260926-assistant-role-names.js`
- `packages/vibe64-runtime/src/shared/assistantRouting.js`
- `packages/vibe64-runtime/src/shared/assistantRoutingScores.json`
- `packages/vibe64-accounts/src/client/composables/useModelRouting.js`
- `packages/vibe64-accounts/src/client/studio/ModelRoutingForm.vue`

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

- `packages/vibe64-accounts/bin/claude-auth-browser`
- `packages/studio-terminal-core/src/server/claudeRuntime.js`
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
- `packages/vibe64-terminals/src/server/agent/sessionAgentManager.js`
- `packages/studio-health/src/server/service.js`
- `src/components/studio/StudioHealthScreen.vue`
- `src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue`

## Public contract

Model routing is a shared Accounts surface. Each workflow keeps Senior and Junior
in one orchestrator, with independent Intern and Router choices and a shared
Backup across connected orchestrators. Thinking choices and Personal/Workspace
scope appear with each exact route. Saves are atomic and revision-checked in private installation state at
`ai-connections/routing.json`; unreadable settings are preserved for recovery.
The store's version-3 format keeps independent Router and shared Backup fields
and helper-conflict evidence alongside those choices. Senior/Junior assignments
must belong to their workflow engine. Old-format files require the explicit
stopped-service upgrade; ordinary reads do not change them.
The server validates changed assignments against their destination catalogue;
an unrelated edit preserves unchanged unavailable references and their original
recommendation provenance. Execution validates its actual destination again.
The chat-mode menu also opens this same form in an owner-only overlay without
navigating to AI Accounts. It initially selects the chat's saved workflow;
the assignments remain shared across conversations.

Accounts delegates saved and unsaved previews to the central terminal runtime,
using the same connection facts and purpose resolver as Send. Owners see Owner
and Collaborator results; member reads expose their own result and cannot save
or evaluate drafts. A foreign Backup moves both effective Senior and Junior even
without review. Review uses effective Senior; Auto requires direct access to all
three of Router, Senior and Junior. Connection identities never enter this response.
OpenCode catalogue refreshes always use the clean catalogue process, including
when a managed chat process is running; runtime output limits and defaults must
not invalidate a verified provider connection. Pages are combined only at one revision, including models
outside the default provider page. A catalogue failure stays visible and does
not erase saved choices. Neither reading nor previewing persists configuration.
Successful native sign-in, API-key setup and explicit new-session creation
initialize missing roles for usable orchestrators from the same recommendations.
The read-only setup preview shows exactly those proposed assignments. First
creation can be initiated by a collaborator using included OpenCode; this internal
initialization accepts workflow IDs, never user assignments. Editing or disabling
roles remains owner-only. Repeating setup
preserves every saved choice, including an explicit empty role. A workflow needs
usable Senior and Junior before initialization; a disconnected engine does not get
a profile merely because independent helpers are available elsewhere. Routing
setup failures are reported separately from a successfully connected key.
Native Codex and Claude authentication retain that routing result in the current
auth session, so the protected completion read includes it after the terminal
closes. The login component emits the confirmed account to its existing parent,
which opens the routing proposal and carries any setup warning. Immediate login
completion uses the same path as realtime or polling completion. Overlapping or
cancelled login reads cannot reopen the proposal, and refreshing ordinary account
status does not imply a new successful login. This adds no saved account format.

The form separates planning/coding, independent assistance and collaborator
backup. Unsaved edits refresh a cancellable preview with a stable loading area;
stale replies are ignored. Conflicting saves preserve the draft. Migrated helper
conflicts require the owner's explicit acknowledgement of a valid Intern choice;
an unrelated edit keeps the migration evidence. Intern and Router assignments
replace the former per-account Helper model controls and endpoints. Native
helpers receive the central resolver's exact model; they do not read the retired
preferences or select an implicit model. Only the stopped-service upgrade reads
old helper choices and removes them after backup. Connection mutations reject
unupgraded helper settings rather than erasing that evidence.
Late setup defaults refresh an untouched form, while edited roles or proposal
checkboxes remain intact. Routing response caches include the host's actor,
role and project identity; logout and actor switches cannot reuse another
person's preview or configuration access. The standalone editor uses its local
identity through the same optional public host injection.

Recommendation values live in the checked-in `assistantRoutingScores.json`,
keyed by exact orchestrator/provider/model route and role. The shared routing
policy filters eligible choices before applying those scores. It prefers Astra
for Codex Senior and DeepSeek Flash for Junior, Intern and Router. Sol ranks
above GLM for Junior; Luna ranks above GLM for economical assistance. Claude's
listed native aliases use corresponding tiers. Other eligible models receive
the JSON default scores, with included Pickle ranked last. Saved eligible
choices win score ties; exact route ordering makes other ties stable. Scores
change recommendations, never saved assignments or execution destinations.
These priorities apply only to qualified routing choices. Codex currently admits
native OpenAI models, DeepSeek Flash, and GLM 5.3 through Z.AI Coding Plan. Both
external routes passed managed Astra → coding model → Astra tool-history and
interruption checks; GLM uses the existing history adapter without another
transport component. DeepSeek Pro shows Compatibility pending until its
cross-model history is verified. A saved
unqualified route reports an actionable error and is never silently replaced.
Credential connectivity and Claude's protocol check do not establish Codex
round-trip history compatibility.
New-credential success refreshes the catalogue and opens one proposal with
independent checkboxes for each affected workflow/role. Native login and API-key
setup identify the actual connected engines; credentials are never copied.
Proposals include only workflows with eligible Senior and Junior models.
Changes to custom assignments start unchecked. Saves submit only actual edits,
so untouched absent roles do not become deliberately disabled. Customize carries only selected
proposals into the normal form; Keep current routing closes without saving.
Adding a lower-priority provider does not replace a better choice.

Curated external keys are checked separately against Responses for Codex and
Messages for Claude Code. Claude readiness requires its successful protocol
check; a failed Claude check leaves a working Codex connection usable. Older
keys must be checked again before they become Claude-ready. Only readiness and
redacted connection metadata reach the client. Provider URLs remain curated.
Claude's access reader applies the connection's scope: DeepSeek API access is
shared, while the GLM Coding Plan and native Claude subscription are personal.
External catalogue and access reads do not start a native Claude inference
process. Connection facts retain a safe identity from the existing owner:
Codex's login identity, curated key generation, native Claude account identity,
or OpenCode credential fingerprint. OpenCode retains scope and identity when a
particular model is disabled; model availability cannot change personal/shared
classification. Unknown or removed credentials have no usable identity.

Standalone and hosted editors compose the same AI Accounts screen, catalogue
validation, provider policy, connection store and runtime wiring. The local
Account settings dialog has You, AI Accounts and GitHub tabs. AI Accounts offers
Codex, Claude Code and OpenCode, including GPT, DeepSeek and GLM through Codex
and the current OpenCode provider catalogue. An AI connection request opens the
requested provider's setup. Hosts choose the API endpoint, credential context
and account-management authorization; they do not duplicate these forms or
provider operations.
Connection setup describes available models and directs role choices to Model
routing. Connecting GLM or a Zen key does not promise to replace saved defaults;
recommendations and their application belong to the shared routing flow.

OpenCode connections retain the existing versioned file at
`<systemRoot>/ai-connections/connections.json`. Native Codex and Claude login
keep using the existing host account context; curated Codex provider homes stay
under `<systemRoot>/ai-connections/codex`. Moving the implementation does not
copy keys, change file formats or merge separate installations' account stores.
The nested development editor preserves native credential context while keeping
its own runtime state.

The connection store supplies included OpenCode Big Pickle, with no Codex login
required. Live native OpenCode checks show that its free provider rejects the
restricted, tool-free profile used by Router and background helpers. Pickle remains
eligible for Senior, Junior, explicit Intern chat and shared Backup, but is not
recommended for Intern or Router; previews reject those helper purposes before
sending. Another connected model is needed for Auto and background assistance.
New OpenCode keys are checked against the complete trusted provider
catalogue and verified before replacing a working connection. The browser cannot
supply a network route, verification model or access policy. Only redacted
metadata is returned. Existing model-access restrictions,
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
The existing `<systemRoot>/auth/codex/status.json` marker owns a random local
`loginId`, written atomically after native authentication succeeds. Each
successful Vibe64 sign-in replaces it; status reads, token refreshes, runtime
retirement retries and server restarts preserve it. Failed or cancelled sign-in
attempts do not replace an existing identity. Logout removes the marker.
Existing connected markers without an ID are repaired once by the stopped-service
`20260923-codex-login-id` state upgrade, never by an account read. Invalid existing
IDs block the upgrade instead of being replaced silently. This ID is local
bookkeeping, never an OpenAI account/workspace ID, and is neither written
to native `auth.json` nor supplied to OpenAI authentication requests.
The upgrade command, ledger, backup and authoring contract are documented in
`docs/state-upgrades.md` and the runtime-release Program.
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

Older clients reaching the retired native or OpenCode helper-setting endpoints
receive HTTP 410 with a reload instruction pointing to Intern in Model routing.
Those endpoints cannot recreate the retired preferences. Provider profiles
continue validating the resolved model's availability and supported thinking
controls; configuration changes do not rewrite already captured tasks.
