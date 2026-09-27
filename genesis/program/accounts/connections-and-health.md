# Accounts, connections, and Studio health

People can connect the external accounts needed for agent and repository work
and see whether the Studio host is ready to support them.
Account status, native login/logout, model routing, Git identity, personal
profile and curated provider operations use actor-authorized named actions.
These are workspace account operations and do not require a project or coding
session. Canonical inputs reject caller-supplied users and enforce required
fields; existing account services retain credential ownership, revision checks
and native lifecycle rules.
The five `vibe64.accounts.ai-connections.*` actions own provider list/catalogue,
save/remove and model access. Standalone and hosted HTTP adapters dispatch the
same contracts. Owner authorization and any host management policy apply on
direct execution too. The existing store owns validation, credential writes,
runtime invalidation and change publication. HTTP field selection derives from
the action schema; a URL provider takes precedence over body input. Login
WebSockets retain their transport adapter and the four retired Helper endpoints
remain 410 notices with no operation to expose. Account actions have no direct
Colleague tool exposure until their bounded presentation is defined.

## Sources

- `packages/vibe64-accounts/src/server/actions.js`
- `packages/vibe64-accounts/src/server/inputSchemas.js`
- `tests/server/vibe64AccountActionDispatch.unit.test.js`
- `packages/vibe64-core/src/server/codexAuthState.js`

- `packages/vibe64-core/src/server/assistantRoutingStore.js`
- `packages/vibe64-accounts/src/server/assistantRoutingUpgrade.js`
- `packages/vibe64-accounts/src/server/assistantRoleUpgrade.js`
- `packages/vibe64-accounts/src/server/assistantHelperUpgrade.js`
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
- `packages/vibe64-accounts/src/client/studio/NativeProviderConnections.vue`
- `packages/vibe64-accounts/src/client/composables/useCodexProviderConnections.js`
- `src/components/studio/Vibe64AuthSettingsButton.vue`

- `packages/vibe64-accounts/bin/claude-auth-browser`
- `packages/studio-terminal-core/src/server/claudeRuntime.js`
- `packages/vibe64-accounts/src/client/studio/ProviderAccountsSetup.vue`
- `packages/vibe64-accounts/src/client/composables/useProviderAccountsSetup.js`

- `packages/vibe64-accounts/src/server/service.js`
- `packages/vibe64-accounts/src/server/registerRoutes.js`
- `packages/vibe64-core/src/server/terminalWebSocketRoutes.js`
- `packages/vibe64-core/src/server/localStudioRequest.js`
- `server/lib/browserLifecycle.js`
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
- `packages/studio-health/src/server/actions.js`
- `packages/studio-health/src/server/inputSchemas.js`
- `packages/studio-health/src/server/registerRoutes.js`
- `src/components/studio/StudioHealthScreen.vue`
- `src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue`

## Public contract

Native terminal and browser-lifecycle WebSockets require a browser Origin that
matches the request host, port and HTTP(S) scheme, including the host's forwarded
protocol. Authenticated hosted sockets cannot omit Origin; local command-line
clients retain the loopback-only exception. Authentication does not bypass this
check. Native incoming WebSocket messages are limited to 1 MiB; file attachments
use their separate upload API.

Model routing is a shared Accounts surface. Each workflow keeps Senior and Junior
in one orchestrator, with independent Helper and Router choices and a shared
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
the assignments remain shared across conversations. The workflow selector is the
first field; selecting it chooses which configuration to edit, without switching
Main chat. All five assignments belong to that workflow. Helper, Router and
Shared backup can use another orchestrator without becoming global settings.
Only connected orchestrators and retained saved assignments appear; a retained
disconnected workflow is marked Needs reconnection.
Catalogue failure after a connection has been observed retains its error; an
unconnected, unconfigured catalogue does not create a selectable workflow.
Auto identifies missing Senior, Junior or Router assignments. Opening configuration
from its disabled state brings the first missing assignment into view.
User-created temporary chats inherit Main instead of using a workspace default.
The retired optional `temporaryChatRole` field is ignored in older settings;
reads do not rewrite those files. New explicit routing saves omit it. Existing
conversation records need no format change or historical conversion.

After connecting an account, the form shows only optional suggested changes,
grouped by workflow with separate Current and Suggested model lines and the
suggested connection's access scope. Keep current routing leaves the connection
available. Apply saves only selected changes. Customize routing opens the full
workflow editor; the connection-result view has no workflow selector or audience
preview. Native login completion names Codex login or Claude login explicitly.

Accounts delegates saved and unsaved previews to the central terminal runtime,
using the same connection facts and purpose resolver as Send. Each assignment
shows "Collaborators" with the effective model, shared backup or access
restriction. There is no separate audience preview or explanatory role copy.
Member reads expose their own result and cannot save
or evaluate drafts. A foreign Backup moves both effective Senior and Junior even
without review. Review uses effective Senior; Auto resolves Router, Senior and
Junior through the same collaborator fallback policy, validating each purpose.
Connection identities never enter this response.
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

The form lists Router, Senior, Junior, Helper, then collaborator backup, with
separate role headings. Shared backup is labelled "Fallback for personal models";
accessible shared assignments retain their models when the backup changes.
Unsaved edits refresh cancellable access checks beneath each assignment;
stale replies are ignored. Conflicting saves preserve the draft. Migrated helper
conflicts require the owner's explicit acknowledgement of a valid Helper choice;
an unrelated edit keeps the migration evidence. Helper and Router assignments
replace the former per-account Helper model controls and endpoints. Native
helpers receive the central resolver's exact model; they do not read the retired
preferences or select an implicit model. Only the stopped-service upgrade reads
old helper choices and removes them after backup. Connection mutations reject
unupgraded helper settings rather than erasing that evidence.
Router appears first, below the outlined Review recommendations button. Its
review lists changed selections against the current draft for the selected
workflow, as `Orchestrator (model thinking)` in one compact line per role.
Unchanged roles are omitted and the button is disabled when there are no
changes. Apply to form uses the reviewed recommendations without
saving; Cancel preserves the draft. Save routing remains the persistence action.
A routing reload or workflow/viewer change discards an open recommendation review;
a conflicting revision prevents applying it.
Late setup defaults refresh an untouched form, while edited roles or proposal
checkboxes remain intact. Routing response caches include the host's actor,
role and project identity; logout and actor switches cannot reuse another
person's preview or configuration access. The standalone editor uses its local
identity through the same optional public host injection.

Recommendation values live in the checked-in `assistantRoutingScores.json`,
keyed by exact orchestrator/provider/model route and role. The shared routing
policy filters eligible choices before applying those scores. It prefers Astra
for Codex Senior and DeepSeek Flash for Junior, Helper and Router. Sol ranks
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
Messages for Claude Code. Setup requires the selected orchestrator's check to
succeed, then checks the other independently. Failure of that optional check
does not prevent connecting the selected orchestrator. Check saved key verifies
the server-held credential without returning it to the browser. Claude readiness requires its successful protocol
check; a failed Claude check leaves a working Codex connection usable. Older
keys must be checked again before they become Claude-ready. Only readiness and
redacted connection metadata reach the client. Provider URLs remain curated.
Claude's access reader applies the connection's scope: DeepSeek API access is
shared, while the GLM Coding Plan and native Claude subscription are personal.
The separate `zai` API connection declares workspace access; its setup requires
a pay-as-you-go account without a Coding Plan. Billing is not inferred from
successful protocol access.
The native GPT badge uses the runtime's authentication access policy: ChatGPT
login is Personal use; an OpenAI API key is Workspace use. Unreadable access
metadata leaves the badge absent instead of guessing from account storage scope.
External catalogue and access reads do not start a native Claude inference
process. Connection facts retain a safe identity from the existing owner:
Codex's login identity, curated key generation, native Claude account identity,
or OpenCode credential fingerprint. OpenCode retains scope and identity when a
particular model is disabled; model availability cannot change personal/shared
classification. Unknown or removed credentials have no usable identity.

Standalone and hosted editors compose the same AI Accounts screen, catalogue
validation, provider policy, connection store and runtime wiring. The local
Account settings dialog has You, AI Accounts and GitHub tabs. AI Accounts offers
Codex, Claude Code and OpenCode, including GPT, DeepSeek and GLM through Codex,
and Claude, DeepSeek and GLM through Claude Code,
and the current OpenCode provider catalogue. An AI connection request opens the
requested provider's setup. Hosts choose the API endpoint, credential context
and account-management authorization; they do not duplicate these forms or
provider operations.
Connection setup describes available models and directs role choices to Model
routing. Connecting GLM or a Zen key does not promise to replace saved defaults;
recommendations and their application belong to the shared routing flow.
Configured connections are grouped under Codex, Claude Code and OpenCode; empty
orchestrator groups are omitted. A curated key verified for both native
orchestrators has a separate row in each group. Manage opens that exact
orchestrator/provider pair. Configured engine membership remains visible during
a failed credential transition so reconnection opens the correct form. A
Claude-only key remains absent from Codex's group and usable catalogue. Included
Big Pickle retains its Default badge under OpenCode. Add connection lists only
orchestrators with missing provider connections, then their unconfigured
providers. Manage has no provider selector. Native expired/reconnecting
accounts and configured external pairs remain in Manage. OpenCode availability
comes from its refreshed catalogue; loading or failure is not treated as
exhaustion. When no supported connections remain, Add connection is disabled.
Adding an orchestrator for an existing shared key checks that saved key without
exposing replacement or disconnect actions. Shared keys remain one credential: removal
explicitly identifies its effect on both Codex and Claude Code. The regular Z.AI
recommendation is hidden for a connected regular API or Coding Plan key in
OpenCode, or a Coding Plan key verified for Codex or Claude Code.

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
eligible for Senior, Junior and shared Backup, but is not
recommended for Helper or Router; previews reject those helper purposes before
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
(`https://api.z.ai/api/v1`). The distinct `zai` pay-as-you-go option attempts
that same Responses endpoint and `https://api.z.ai/api/anthropic/v1/messages`
with its own key. Z.AI documents these compatibility endpoints for Coding Plan;
ordinary API account access and billing remain unverified pending a suitable
live key. Setup states that limitation. The regular `/api/paas/v4/responses`
route previously returned 404 and is not used as an inferred compatibility
endpoint. API and Coding Plan credentials, connection identities and routing
selections remain separate even though both use the `glm-5.3` model ID.
The existing GLM history handling applies to both routes. OpenCode keeps its
regular Chat Completions integration.
The browser submits only a provider id and key. Connections use the provider's
name automatically, and the browser cannot set an endpoint. The existing host Codex-management policy authorizes reads and
mutations, and lists never return keys.

A bounded request to the selected orchestrator's protocol checks a new key before changing a working
connection. The optional `codexDisabled` field records an unsuccessful Codex
check; absence means Codex remains enabled, as it was for every previously
saved key. `claudeReady` retains its independent opt-in meaning. The numbered
native-provider-readiness release boundary needs no historical conversion or
provider calls. Replacement or removal marks that provider unavailable, drains only
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
The global `vibe64.studio-health.read` action resolves the current actor without
requiring project access. HTTP and automation share that context; input cannot
supply a user or project. The health service receives the trusted actor for
account-readiness policy.
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
receive HTTP 410 with a reload instruction pointing to Helper in Model routing.
Those endpoints cannot recreate the retired preferences. Provider profiles
continue validating the resolved model's availability and supported thinking
controls; configuration changes do not rewrite already captured tasks.

The Helper assignment replaces the retired third chat role, preserving its exact
model, thinking, explicit-choice provenance and recommendation scores. It is a
background assignment only. Helper and Router execution respects each saved
thinking preference, including provider default; a task cannot silently force Low.
The restricted execution profile is `helper` across all three providers.
`assistantHelperUpgrade.js` owns the schema-4 conversion through the existing
verified publication engine and session inventory, including archived metadata,
helper ownership and pending cleanup references. New chat preferences use Junior;
already accepted work keeps its recorded destination and receipts.

The configuration view loads independent orchestrator catalogues concurrently,
then checks model-specific access in bounded batches. Catalogue assembly still
verifies pagination progress and a single revision. The client reuses the same
actor/project's configuration for 30 seconds when reopening the dialog;
connection changes invalidate it and saves reload it. Dispatch always resolves
current access and catalogue compatibility independently. Senior and Junior
continue sharing the workflow orchestrator selected above the role fields.
