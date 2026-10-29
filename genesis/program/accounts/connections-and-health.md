# Accounts, connections, and Studio health

People can connect the external accounts needed for agent and repository work
and see whether the Studio host is ready to support them.
Account status, native login/logout, model routing, Git identity, personal
profile and curated provider operations use actor-authorized named actions.
These are workspace account operations and do not require a project or coding
session. Canonical inputs reject caller-supplied users and enforce required
fields; existing account services retain credential ownership, revision checks
and native lifecycle rules.
The Account settings **You** tab also offers an Appearance choice (Light, Dark,
System). It is a per-browser convenience in `src/lib/appearance.js`, read once
at startup as Vuetify's default theme and applied with `theme.change`; it is
not an account operation and writes no server state.
The five `vibe64.accounts.ai-connections.*` actions own provider list/catalogue,
save/remove and model access. Standalone and hosted HTTP adapters dispatch the
same contracts. One AI management policy, the account runtime's
`requireAiManagement` (default: only the workspace owner; a host may replace
it), decides Claude and Codex sign-in, curated provider keys, saved
connections, model access and model routing save/preview/`canConfigure`, and
the action enforces it on every lane, including direct execution. The existing store owns validation, credential writes,
runtime invalidation and change publication. HTTP field selection derives from
the action schema; a URL provider takes precedence over body input. Login
WebSockets retain their transport adapter. Model routing read/preview/save
have bounded Colleague presentations. `useModelRouting` owns main chat's
selection (`mainChatSelection`: the owner's effective Senior, else its
recommendation), which session creation and renewal dialogs share. The existing connection list also supplies
an owner-only assistant projection of regular Z.AI saved connection, preferred
provider, default model and model-access mode, without key hints, fingerprints,
other connections or credential paths. Its HTTP result remains the original
complete sanitized UI list. Missing regular Z.AI and unavailable storage are
distinct; a Coding Plan does not satisfy this check. Saved facts do not prove
current credentials, credit, entitlement, Senior routing or Colleague selection.
Registration, key entry and paid-model consent remain human UI operations.
Regular Z.AI verification identifies temporary overload and insufficient balance
without exposing raw provider text. Failed verification never replaces a saved
key; overload calls for a later retry rather than credential replacement.
The list read goes through the same AI management policy. Hosted context freshly resolves the actor and rejects missing
authentication before execution; standalone retains its original authorized
loopback/no-login lane. Other account actions remain excluded.

## Sources

- `packages/vibe64-accounts/src/server/actions.js`
- `packages/vibe64-accounts/src/server/inputSchemas.js`
- `packages/vibe64-accounts/src/server/routingAssistantContracts.js`
- `tests/server/vibe64AccountActionDispatch.unit.test.js`
- `packages/vibe64-core/src/server/codexAuthState.js`

- `packages/vibe64-core/src/server/assistantRoutingStore.js`
- `packages/vibe64-accounts/src/server/assistantRoutingUpgrade.js`
- `packages/vibe64-accounts/src/server/assistantRoleUpgrade.js`
- `packages/vibe64-accounts/src/server/assistantHelperUpgrade.js`
- `packages/vibe64-core/src/server/stateUpgrades/20260926-assistant-role-names.js`
- `packages/vibe64-runtime/src/shared/assistantRouting.js`
- `packages/vibe64-runtime/src/shared/assistantRoutingScores.json`
- `packages/vibe64-runtime/src/shared/assistantLabels.js`
- `packages/vibe64-accounts/src/client/composables/useModelRouting.js`
- `packages/vibe64-accounts/src/client/studio/ModelRoutingForm.vue`
- `packages/vibe64-accounts/src/client/studio/ModelRoutingRow.vue`

- `packages/vibe64-accounts/src/server/aiConnectionStore.js`
- `packages/vibe64-accounts/src/server/aiConnectionService.js`
- `packages/vibe64-accounts/src/server/aiConnectionRuntime.js`
- `packages/vibe64-accounts/src/server/opencodeCatalogPages.js`
- `packages/vibe64-accounts/src/server/assistantProviderPolicy.js`
- `packages/vibe64-accounts/src/server/zaiConnectionVerifier.js`
- `packages/vibe64-accounts/src/client/studio/AiConnectionDialogs.vue`
- `packages/vibe64-accounts/src/client/studio/AiConnectionRow.vue`
- `packages/vibe64-accounts/src/client/studio/AiProviderManage.vue`
- `packages/vibe64-accounts/src/client/studio/AiSetupAdvanced.vue`
- `packages/vibe64-accounts/src/client/composables/useAiConnectionManager.js`
- `packages/vibe64-accounts/src/client/composables/useAiConnections.js`

- `packages/vibe64-core/src/shared/curatedCodexProviders.js`
- `packages/vibe64-core/src/server/codexProviderConnections.js`
- `packages/vibe64-accounts/src/client/studio/NativeProviderConnections.vue`
- `packages/vibe64-accounts/src/client/composables/useCodexProviderConnections.js`
- `src/components/studio/Vibe64AuthSettingsButton.vue`

- `packages/vibe64-accounts/src/client/onboarding/aiOnboardingProviders.js`
- `packages/vibe64-accounts/src/client/onboarding/aiOnboardingEvents.js`
- `packages/vibe64-accounts/src/client/onboarding/useAiOnboarding.js`
- `packages/vibe64-accounts/src/client/onboarding/AiOnboarding.vue`
- `packages/vibe64-accounts/src/client/onboarding/AiSetup.vue`
- `packages/vibe64-accounts/src/client/onboarding/AiTeamSetupCard.vue`
- `packages/vibe64-accounts/src/client/onboarding/AiOnboardingHost.vue`
- `packages/vibe64-accounts/src/client/onboarding/AiOnboardingMark.vue`
- `packages/vibe64-accounts/src/client/onboarding/AiOnboardingSetUpPill.vue`
- `packages/vibe64-accounts/src/client/studio/AIAccountsSetup.vue`
- `src/App.vue`

- `packages/vibe64-accounts/bin/claude-auth-browser`
- `packages/studio-terminal-core/src/server/claudeRuntime.js`
- `packages/vibe64-accounts/src/client/studio/ProviderAccountsSetup.vue`
- `packages/vibe64-accounts/src/client/composables/useProviderAccountsSetup.js`

- Main: `packages/vibe64-accounts/src/server/service.js`
- `packages/vibe64-accounts/src/server/registerRoutes.js`
- `packages/vibe64-core/src/server/terminalWebSocketRoutes.js`
- `packages/vibe64-core/src/server/localStudioRequest.js`
- `server/lib/browserLifecycle.js`
- `packages/vibe64-accounts/src/server/Vibe64AccountsFeature.js`
- `packages/vibe64-accounts/src/client/composables/useAccountAuthSessions.js`
- `packages/vibe64-accounts/src/shared/authOutput.js`
- `packages/vibe64-accounts/src/shared/gitIdentityInput.js`
- `packages/vibe64-execution/src/server/engines/helperClient.js`
- `packages/vibe64-runtime/src/shared/assistantSelection.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js`
- `packages/vibe64-terminals/src/server/codexAccountPreparation.js`
- `packages/vibe64-terminals/src/server/codexAssistantCatalog.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/openCodeConversationAccounts.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-terminals/src/server/agent/sessionAgentManager.js`
- `packages/studio-health/src/server/service.js`
- `packages/studio-health/src/server/actions.js`
- `packages/studio-health/src/server/inputSchemas.js`
- `packages/studio-health/src/server/registerRoutes.js`
- `src/components/studio/StudioHealthScreen.vue`
- `src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue`

## Public contract

The native provider connection store exposes its existing private `read(providerId)`
to the terminal service for optional DeepSeek balance, GLM pay-as-you-go balance
and GLM Coding Plan quota reads.
This is a server-only credential lookup; account responses never include the key.
Usage collection, normalization and display belong to the conversation subsystem.

Native terminal and browser-lifecycle WebSockets require a browser Origin that
matches the request host, port and HTTP(S) scheme, including the host's forwarded
protocol. Authenticated hosted sockets cannot omit Origin; local command-line
clients retain the loopback-only exception. Authentication does not bypass this
check. Native incoming WebSocket messages are limited to 1 MiB; file attachments
use their separate upload API.

Colleague exposes the canonical Model routing read, preview and save actions
without project selection. Their assistant results contain assignments,
recommendations, effective viewer/collaborator routes and access/availability
metadata, not account identities, credentials, provider error details or private
runtime context. The ordinary HTTP read retains its full UI result. `view: "main"`
returns only main chat's selection (the owner's saved Senior, read from the
routing store without any live catalogue; only an unsaved setup builds the full
view for its recommendation); **Start an AI session** uses it. Supplying
`engineId` and `choiceRole` requests the same role's choices as a 20-item page,
optionally filtered by `choiceSearch` and advanced through `choiceOffset` and
`nextOffset`. `includeOtherModels` includes the UI's other connected choices.
Choice variants are limited to 100 with their full count; identifiers are exact
and selecting a choice still requires native validation.

The session Custom picker requests `allConnectedModels` through the capability
HTTP route. The session agent manager collects each connected provider's model
pages, retaining catalogue revision checks and ordinary access validation.
Its selected provider also uses the existing model-page query. Apply submits
that provider view's revision, not the warmed full-engine revision; the two can
differ for Claude's inexpensive external-provider catalogue. Pending or failed
provider reads block Apply. Native discovery, access checks and the server's
exact stale-revision rejection remain unchanged.

Preview and Save take the same structured workflow/role selection contract.
A null assignment explicitly disables the role; omitted assignments are preserved.
They keep the service's owner policy, revision guard, route/access validation,
atomic persistence and realtime events. A preview does not write. A stale save
must be reread and reviewed, not silently repeated. A successful save changes
future workflow decisions; it does not retarget active agents, session chat modes
or Colleague's own model. Historical Helper review remains explicit; Colleague
reports that review is required without clearing it on the person's behalf.

Models (the routing file) is a shared Accounts surface with two setups. The
owner setup has Senior, Junior, Router, Colleague, Fix it with AI, Explain &
check and Quick helper; the team setup (`nonOwner`) has only the four helpers.
Main chat (Auto, Senior, Junior, review, Deslop) resolves through the owner
setup, whose Senior and Junior share one tool; a non-owner's helpers resolve
through the team setup. The one exception is a non-owner in their own practice
project (a lesson is private to its learner): `assistantRoutingSetupValues`
resolves main chat through the team setup, with Colleague as Senior and Junior
and Quick helper as Router, so a personal plan is never reached. Dispatch knows
the lesson from the practice request scope or the practice runtime, never from
input. Each role holds an exact selection, `null`
(off), `{ follows: role }`, or nothing. Saves are atomic and revision-checked in
private installation state at `ai-connections/routing.json` (schema 5);
unreadable settings are preserved for recovery and older formats require the
explicit stopped-service upgrade. Only the owner saves either setup; the team
setup refuses personal (`ownerOnly`) selections per field. The server validates
changed assignments against their destination catalogue; an unrelated edit
preserves unchanged unavailable references and their recommendation
provenance. Execution validates its actual destination again. A save changes
future work only; it does not retarget active agents or a person's own
Colleague choice.

The read view returns, per setup and role, the saved value, whether it is
configured, the effective selection (following `follows`), the followed role,
the recommendation, the choices with access and tool, and any error, plus the
host's `team` facts (`available`, `ownerName`, `memberCount`) and the viewer's
decisions. Preview evaluates a draft for both setups without writing.
`preferProvider: { setup, modelProviderId, engineId }` restricts that setup's
recommendations to one provider in one tool when it offers a valid choice; AI
onboarding's Use as main AI and the team card use it. Successful sign-in, key
setup and session creation fill absent owner roles from recommendations;
repeating setup preserves every saved choice, including an explicit off role.

`ModelRoutingForm` renders Models wherever it is opened: AI setup's Models
summary and Review models, the connection dialogs, and the owner-only chat-mode
overlay. Rows (`ModelRoutingRow`) are grouped Main chat and Helpers, each with
the role's exact purpose copy, a model picker and a separate thinking picker;
the team setup shows Helpers only and lists no personal choices. A following
role is one line ("Same as Senior · Opus 5.5 · High") with Change; an explicit
row of a following role offers "Use Senior's model". The tool appears in the
selection only when it differs from the model's default (`routingRunsInChoices`
groups choices by provider, model and billing). A per-row Advanced opens only
for a subscription model, which states its fixed tool ("Runs in Claude Code —
required by your Claude plan."), or for a key model connected in several tools,
which offers Runs in radios with Recommended on the default: the card's own tool
when it can run the model, else OpenCode. Changing model keeps the row's tool
when the new model runs there. The Owner (you) | Team members switch appears only
to the owner, when the team setup has a value or the screen opened on it; the
team view explains that main chat runs on the owner's setup with owner
approval, and an empty team setup offers Add a DeepSeek key. Non-owners read the
team setup with a note pointing to Colleague's own model menu.
Review recommendations lists differing roles for the visible setup as one
compact line each; Apply to form changes only the draft and Save persists.
Unsaved edits refresh a cancellable preview ("Checking access…"); stale replies
are ignored, a conflicting revision keeps the draft with Reload current
choices, and viewer changes discard open reviews. Response caches include the
host's actor, role and project identity.

After connecting an account, the form opens in proposal mode with one checkbox
per changed owner role (Current and Suggested lines with access); custom
assignments start unchecked, Keep current models closes without saving and
Configure AI setup opens the full form. Proposals come from global
recommendations, or, for AI setup's Use as main AI, from a preview preferring
that provider in the tool it is connected through. Saves submit only actual
edits, so untouched absent roles stay absent.

Recommendation values live in the checked-in `assistantRoutingScores.json`,
keyed by exact orchestrator/provider/model route and the scored roles Senior,
Junior, Router and Quick helper. Colleague, Fix it with AI and Explain & check
recommend following another role, except the team's Colleague, scored as
Senior. Every role prefers Claude/Anthropic, then Codex/OpenAI, then DeepSeek,
then GLM; ties prefer Claude Code, then the saved value, then the stable route
key. A score row may name a role's thinking (Claude Code's Opus recommends
Medium for Junior); otherwise Router and Quick helper recommend Low and the
others High. Unlisted models use their provider's lowest tier; unknown
providers use the JSON default 2, and OpenCode Zen's free Big Pickle is never
offered. Recommendations never change saved assignments without an explicit
save.
These priorities apply only to qualified routing choices. Codex currently admits
native OpenAI models, DeepSeek Flash, and GLM 5.3 through Z.AI Coding Plan. Both
external routes passed managed Astra → coding model → Astra tool-history and
interruption checks; GLM uses the existing history adapter without another
transport component. DeepSeek Pro shows Compatibility pending until its
cross-model history is verified. A saved
unqualified route reports an actionable error and is never silently replaced.
Credential connectivity and Claude's protocol check do not establish Codex
round-trip history compatibility.

Curated external keys are independently saved and checked against Responses for
Codex and Messages for Claude Code. Setup validates only the selected
orchestrator. Check saved key reads only that pair's server-held credential,
without returning it to the browser. Failed validation leaves the prior working
key and every other orchestrator/provider untouched. Readiness and redacted
metadata reach the client; provider URLs remain curated.
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

Standalone and hosted editors compose the same AI Accounts screen
(`AiSetup` with `inline`, the onboarding stage itself), catalogue
validation, provider policy, connection store and runtime wiring. The local
account button opens a menu with Account settings and, while an onboarding host
can open for this viewer, Redo onboarding. The Account settings dialog has You,
AI Accounts and GitHub tabs. Inline, `AiSetup` reads its own onboarding
state, has its own Back and Done (finishing returns to the overview, not to
Colleague), offers no Set up later, and its exposed `openProvider` sends a
native or curated provider to its card's Manage (when configured) or connect
step, and a catalogue provider with revision, `opencode` or an unknown id to the
manager's key editor, picker or Add a connection; a route's `providerId`
without revision does the same once connections are read. AI Accounts offers
Codex, Claude Code and OpenCode, including GPT, DeepSeek and GLM through Codex,
and Claude, DeepSeek and GLM through Claude Code,
and the current OpenCode provider catalogue. An AI connection request opens the
requested provider's setup. Hosts choose the API endpoint, credential context
and account-management authorization; they do not duplicate these forms or
provider operations.
Connection setup describes available models and directs role choices to Model
routing. Connecting GLM or a Zen key does not promise to replace saved defaults;
recommendations and their application belong to the shared routing flow.
Advanced lists configured connections under Claude Code, Codex and OpenCode;
empty orchestrator groups are omitted. A curated key verified for both native
orchestrators has a separate row in each group. Manage opens that exact
orchestrator/provider pair. Configured engine membership remains visible during
a failed credential transition so reconnection opens the correct form. A
Claude-only key remains absent from Codex's group and usable catalogue. Vibe64
includes no AI: OpenCode Zen appears only with the person's own Zen key, as an
ordinary removable connection. Add a connection lists only
orchestrators with missing provider connections, then their unconfigured
providers. Manage has no provider selector. Native expired/reconnecting
accounts and configured external pairs remain in Manage. OpenCode availability
comes from its refreshed catalogue; loading or failure is not treated as
exhaustion. When no supported connections remain, Add connection is disabled.
Adding an orchestrator requires its own independent key entry and verification.
The same key may be entered deliberately for several pairs; no key is copied.
Removal confirms the exact owning orchestrator/provider.

AI onboarding is owned by the client `onboarding/` module of
`packages/vibe64-accounts` and composes these same setup components in their
embedded mode; it has no connection implementation of its own.
`aiOnboardingProviders.js` is the only place for provider ranks, copy, each
plan's official name and price with any budget advice beneath it,
the monogram shape, sign-up URLs, the orchestrator and provider id each card connects
through, and which saved connections count as that provider. DeepSeek and GLM
connect as curated Codex providers (`deepseek`, `zai-coding-plan`). The GLM card
also carries the one free option (`free`): GLM-4.7 Flash with a free Z.AI
account, free on Z.AI's regular API. It connects through OpenCode (`zai`) as a
card of its own, shown inside the GLM card, with `AiOnboardingKeyConnect`: the
same AI connections save route, using the live catalogue's provider revision
and server-side key verification.
`AiOnboardingHost` takes the AI connections endpoint, whether the viewer can
configure AI and an actor key; the local editor mounts it in `src/App.vue` and
hosts mount it once with their own endpoint and owner check. It opens on
`requestVibe64AiOnboarding`, and opens by itself at most once per page load
only when the viewer can configure AI, account status, curated providers and
OpenCode connections loaded without error, no AI is set up, no dialog is open, the route is not Learning, and Set up later is not
active. Set up later is a 24-hour per-browser snooze,
`vibe64.aiOnboarding.snoozedUntil:<actorKey>`; there is no server state or state
upgrade. The mounted host sets `aiOnboardingAvailable`; the local account
menu's **Redo onboarding** appears only then. AI Accounts, being the same
screen, shows the onboarding cards while nothing is set up by the host's rule
(`aiIsSetUp`): Claude and Codex sign-ins and curated
keys count only while connected; an added OpenCode connection, including the
free GLM-4.7 Flash option, counts while connected. The local Account settings
dialog closes on a request and names its account button as `returnFocus`, where
the host returns focus when the flow closes; while AI Accounts is busy it sets
`aiOnboardingBlocked`, and requests are refused rather than stacked over it. Regular Z.AI stays
reachable through Advanced → Add a connection → OpenCode as well. Success requires the chosen
provider connected and its orchestrator's workflow available. The Colleague
model bridge, registered by the mounted Colleague, reads and switches
Colleague's selection through the existing model selection; the exported
`AiOnboardingNudge` in the Colleague panel and Colleague's no-usable-model
warning dispatch the same request while setup is needed, as does the exported
`AiOnboardingSetUpPill` that account menus place in the top bar. On success the
bridge's `sayHello` sends one ordinary Colleague message and settles on its
reply, the failed turn's or conversation's error, or 15 seconds; the success
check appears only after a reply (or when the person continues anyway), and a
failure offers Retry and Check connection. **Start building** asks the bridge
to `reveal` Colleague with its composer focused. At the end of first-time setup (not a redo,
not inline, not in Learn) the success screen, and the phone dock, also offers
**Take a 5-minute tour** while the injected Learning controller has
`openOrientation`; it asks that controller to start the course's orientation
lesson and closes the flow with reason `tour`. Accounts names no lesson. Embedded,
`NativeProviderConnections` shows only the key form under the flow's own step
title, and `ProviderAccountsSetup` shows nothing before the first attempt; when
the sign-in tool cannot run it shows a warning with Try again, Choose another
AI and Details, and disables the sign-in button. Redo never removes a
connection and changes routing only through `ModelRoutingForm`: with a Senior
model in use, a plain "Use [provider] / Keep [current] for building" choice
calls its exposed `applySuggested`, which saves every suggestion for that
connection through the normal save; with none in use it applies the
suggestions without asking. Its `plain` mode names roles and models by their
display names. A card with configured connections (`aiOnboardingRows` matches the
manager's rows to the card by native, curated and OpenCode ids) offers
**Manage**: `AiSetup` creates one `useAiConnectionManager` (route following
off), provides it, and opens `studio/AiProviderManage.vue` with that card's
rows, each an `AiConnectionRow` (sign-in or key change, Z.AI or Zen model
access, Remove). The dialogs behind those actions are the moved
`studio/AiConnectionDialogs.vue`, shared with AI Accounts. A card whose rows
exist but no longer work shows Reconnect, which opens its connect step; cards
with connections lead a configured setup. Once anything is configured, the collapsed
`studio/AiSetupAdvanced.vue` under the cards holds only plumbing: Add a
connection, Refresh, Other connections (rows no card or free
option matches, such as OpenCode Zen, with their model access) and every row
by orchestrator; those other rows also count in the Connected strip. Who may
use a connection is left to the host: `AiSetup` takes `owner-notice` and
`change-where` props (generic local defaults) and a `connection-access` slot
(`{ connection, card, place }`, place `badge`, `card` below a connected card's
name, `row` or `success`) that the onboarding shell and host forward; Manage,
Advanced and each row pass it on. Manager rows carry the neutral `ownerOnly` and
`modelProviderId` for it.

Main AI is the card whose provider matches the owner setup's effective Senior;
`aiOnboardingMainAi` labels it "DeepSeek, via Claude Code" when the Senior's
tool is not one of the card's native tools. The crown stays the static mark of
Claude's card. `connectedEngine` finds the tool a card's provider is actually
connected through (the card's own tool first, then Claude Code, Codex,
OpenCode); verification, Use as main AI (a `preferProvider` preview for that
provider and tool, saving Senior, Junior, Router and Quick helper) and
Colleague's switch use it. Colleague's switch passes the exact owner Colleague
selection to the bridge's `select(assistantSelection)`. The DeepSeek card
connects through Claude Code.

`AiTeamSetupCard` appears in the overview for the owner when the host reports a
team, the owner Senior is a connected Claude subscription model and the team
setup has no configured role; Not now snoozes it per viewer for seven days in
browser storage, and a `focus="team"` opening (the project list's Set up team AI
via the account dialog's `section: "team"`) shows it regardless, or opens Models
on Team members when there is no card to offer. Add a DeepSeek key runs the
DeepSeek connect step inside Claude Code and, once DeepSeek works there,
`fillTeamSetup` previews the team setup with `preferProvider` DeepSeek in Claude
Code and saves its absent roles; the card then reads Team AI is ready with a
one-line summary and Review team models. The overview's Models summary lists
Senior, Junior and, with a team, Team members' Colleague, with Review models.

`AiPersonalUse` (exported with `personalUsePlan`) is the single explanation of a
personal-use plan. It maps `anthropic`, `openai` and `zai-coding-plan` to the
plan and the provider whose terms make it personal, and renders an amber
lock-icon **Personal use** chip (`chip`, or `badge` without a link inside list
options), a `note` sentence, or a bare `link`; each link opens the same
explanation dialog. Models marks available `ownerOnly` choices with the badge
and shows one note per personal provider the owner draft routes to. The provider key editor and the GLM Coding Plan
form use it too; hosts reuse it in the `connection-access` slot.

OpenCode connections retain the existing versioned file at
`<systemRoot>/ai-connections/connections.json`. Native Codex and Claude login
keep using the existing host account context; curated Codex provider homes stay
under `<systemRoot>/ai-connections/codex`. Moving the implementation does not
copy keys, change file formats or merge separate installations' account stores.
The nested development editor preserves native credential context while keeping
its own runtime state.

The connection store supplies no account-free model. OpenCode Zen's free Big
Pickle is never offered: the catalogue omits it even under a Zen key, a keyed
Zen connection recommends `claude-haiku-4-5`, and its model check skips it.
Without a connected AI, Colleague, sessions and background helpers (prompt
hints, titles, Router) find no available routing and report setup instead of
falling back. The numbered upgrade `20261022-free-model-retirement` unsets
routing roles that named Big Pickle (`freeModelRetirementUpgrade.js`) and keeps
a Colleague chat bound to it as a previous conversation
(`vibe64-colleague/src/server/freeModelUpgrade.js`); the historical routing V2
upgrade restates the original included row for its frozen interpretation.
Managed OpenCode Helper turns retain native tool definitions while the
trusted session registry and execution plugin deny tool execution in restricted
non-project workloads. Routing admits any available connected model for Router
and Helper as well as Senior, Junior and shared Backup. Catalogue availability,
account access and the actual execution profile remain authoritative; accepting a
routing assignment does not grant a Helper coding access.
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
JSKIT supplies native protocol endpoints, model capabilities, Codex catalogue/
thread configuration and Claude's provider environment. The shared Codex
configuration facility interprets live catalogue responses and reasoning options,
projects native model labels, and formats configured-only catalogue rows without
performing discovery. This subsystem retains offered choices, product labels,
recommended effort, account policy, credential storage and verification before
replacement. Its curated filtering and preferred defaults use the original native
row identity/default fields; native metadata alone never grants connection access.
The browser submits only a provider id and key. Connections use the provider's
name automatically, and the browser cannot set an endpoint. The existing host Codex-management policy authorizes reads and
mutations, and lists never return keys.

The connection store delegates Codex's private `config.toml` serialization and
Responses key probe to JSKIT's existing Codex configuration owner, and its
Messages key probe to JSKIT's Claude process/account owner. These operations
retain the original single bounded request, native response validation and
sanitized failure wording. Vibe64 still authorizes the curated provider/key,
checks only the selected orchestrator, serializes changes by that exact pair,
and publishes that pair's connection generation. Codex and Claude records live
under `ai-connections/<engine>/<provider>`; OpenCode retains its original store.
Every runtime lookup names its intended orchestrator. Regular GLM API and Coding
Plan remain separate providers; existing model and billing/access policies stay
with their exact routes. Subscription credentials and native history retain the
host's original HOME, including existing Claude API history; new saved records
do not copy keys or claim a historical native binding has been restored.

Codex provider mutation uses the existing native owner to enumerate trusted
loaded thread/provider identities, pause selected goals, stop selected turns,
unsubscribe selected observers and prove those threads are not loaded before
publishing. Filtered observation journals and context generations preserve other
threads' work, queues and shared server. Unknown inventories or retained native
subscribers block publication with explicit retry guidance. Genuine account,
socket and execution changes retain the original whole-runtime lifecycle.
Intentional account changes do not bypass the native account identity guard.

The new explicit `20261009-independent-provider-credentials` upgrade is prepared
for later stopped-service execution. It appends after the existing assistant-
workflow boundary without inserting into or reordering the published ledger
prefix, including installations that have already applied that workflow. Its existing verified publisher owns private
before/after copies and exact retry. It clears all three providers from both
curated stores, the original OpenCode store and generated native credential
files, including isolated Codex helper config and exact managed OpenCode
`verify-<UUID>` auth files left when a key check crashes before its normal cleanup.
It preserves unrelated provider
configuration, native history/subscription credentials, project files and saved
routing. Removed routes remain unavailable until independently reconnected.
The historical routing helper freezes the original shared-store flag inventory
so older upgrades preserve original choices before this new reset. No request,
read or startup migrates or copies credentials.

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
reach the server through localhost. The user pastes the browser's
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
JSKIT owns this native status interpretation and cache. Vibe64 supplies the
managed command, credential context and capture policy; the common conversation
runtime uses the same reader through its supplied execution facility.
The cache is keyed by the exact command, environment and credential context, so
Vibe64 has one Claude status reader: the terminals service's, with the inputs
Claude conversations run with. Accounts, assistant readiness and a conversation's
account identity all read through it, so one account costs one status read per
cache period. Accounts still reports a credential context the host refused
without running Claude Code.
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
browser log messages in the short Health summary. Without runtime packs, Health
checks the person's own tools: a plain non-zero exit shows the tool's own output
rather than the command line, and the browser checks are named for the installed
Playwright instead of pinned versions.

Each Claude Code, Codex or opencode process resolves its program when it starts,
so a program installed after Vibe64 started is used after **Check again** without
a restart. AI Accounts reads the status's `missingTools` list to mark a missing
orchestrator in Add connection and to show the install warning before the
OpenCode provider catalog would try to start a missing program; the setup
cards read it too and say "Needs [program] on this computer" before a choice.
`operatorCliInstall` picks each official install line by the server's
`process.platform` (the CLI runs there): the shell installers on macOS and
Linux, PowerShell installers for Claude Code and Codex on Windows and
`npm install -g opencode-ai` for opencode, which has no PowerShell installer.

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
by opening or creating a session or sending its first message. A connected-only
capability read (model routing and session setup) with no connected OpenCode
connection returns the configured answer and never starts the temporary
service.

The host may contribute redacted connection metadata that identifies the
preferred new-session provider, and restricts a connection to
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
while current Zen ids independently control which models are presented. A keyed
Zen connection's recommended model therefore remains connected and available
when other models rotate or a prior session selection is no longer enabled.

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
current access and catalogue compatibility independently. Missing roles and denied
access fail before native catalogue discovery;
eligible destinations still require the current catalogue before dispatch.
Senior and Junior
continue sharing the workflow orchestrator selected above the role fields.

OpenCode native provider configuration is cached for the shared server lifetime.
Credential mutation validates the selected provider first, then enters the existing
shared owner acquisition fence before publishing the private store. Pending starts
are drained. Other-provider users, unowned common-driver users and unconfirmed native
terminals refuse the change before Stop or write, with close/retry guidance. When
only owned selected users remain, original cleanup and verified shared process exit
retire that cache before publication; the existing database and native IDs survive.
The default store remains usable independently; its optional private publication
facility is supplied only by the server composition, never browser or action input.

Claude credential mutation uses the existing manager's terminal opening fence before
its reconnect marker and private-key publication. Pending PTY openings drain first;
selected bindings and live PTYs without a confirmed provider binding refuse before
marker, runtime invalidation or key writes. Known other-provider PTYs stay running.
The server-private prepare/publication continuations place the existing marker and
write operations within that same fence; no HTTP/action input supplies them.
