# Source editing and change review

People can inspect and make focused source changes, see every file that differs
from saved project work, and inspect one exact file change at a time.

## Sources

- `src/components/studio/vibe64-session/Vibe64SessionFiles.vue`
- `src/components/studio/vibe64-session/Vibe64SessionFileArea.vue`
- `src/components/studio/ArchivedVibe64SessionDetail.vue`


- `src/components/studio/IntegrationsPanel.vue`
- `src/components/studio/GoogleAdsSearchPanel.vue`
- `packages/vibe64-source-editor/src/server/integrationSetupCommand.js`
- `packages/vibe64-source-editor/docs/application-google-ads.md`
- `src/composables/useVibe64Integrations.js`
- `src/pages/app/project/[slug]/dashboard/integrations/index.vue`
- `packages/vibe64-source-editor/src/server/service.js`
- `packages/vibe64-source-editor/src/server/starredFiles.js`
- `packages/vibe64-source-editor/src/server/registerRoutes.js`
- `src/composables/useVibe64StarredFiles.js`
- `src/components/studio/vibe64-session/Vibe64StarredFilesMenu.vue`
- `src/components/studio/vibe64-session/Vibe64StarredFilesList.vue`
- `packages/vibe64-terminals/src/server/repositoryHistory.js`
- `packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js`
- `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `src/composables/useVibe64SourceEditor.js`
- `src/composables/useVibe64SourceEditorFileSync.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue`
- `src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue`
- `src/composables/useVibe64RepositoryWorkspace.js`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64SessionRuntimeHost.js`
- `src/components/studio/repository/Vibe64RepositoryWorkspace.vue`
- `src/components/studio/repository/Vibe64RepositoryFileBrowser.vue`
- `src/components/studio/repository/Vibe64RepositoryDiff.vue`
- `src/components/SectionContainerShell.vue`
- `src/lib/vibe64RepositoryRealtime.js`
- `src/pages/app/project/[slug]/dashboard/changes/index.vue`
- `src/pages/app/project/[slug]/dashboard/repository/index.vue`

## Public contract

Files presents Repo, Drop Zone and Session as icon-labelled areas, separate from
folder navigation. Repo retains source editing, stars, explanations and selected
file sync. Drop Zone belongs to the selected session and lives outside its Git
source. Project members may list, preview, download, upload, create folders,
rename, edit text and delete files or directory trees there. Upload and file
drag-and-drop accept multiple files sequentially, up to 100 MiB each, and never
overwrite an existing item. Larger files placed there by the assistant remain
downloadable. Drag-and-drop upload is confined to Drop Zone. Unsaved text stays
in its area when switching tabs; uploads cannot discard it.

At compact and medium display widths, repository navigation starts hidden and
can be opened from the file toolbar. Browsing and editing take turns occupying
the workspace; opening a file hides navigation and search again. The editor
stays mounted so toggling navigation preserves its draft and position. Secondary
file actions live in a menu while Save and the filename remain visible. Drop Zone
and Session previews combine navigation and file actions into one compact row.
Expanded displays retain the existing source browser and toolbar.

Session exposes the complete regular-file runtime tree, including hidden files,
read-only to the workspace owner. Local loopback editor access acts as ownership.
Session History exposes the archived runtime tree under the same owner check;
archive browsing uses the session store's temporary extraction and cleanup.
Owners can also download the original archive directly without extraction. No Session
operation writes, including paths descending into its Drop Zone. Both areas use
relative paths and reject symbolic links and traversal beyond their root.

Every request runs in the resolved project request context. The hosted project
access gate verifies its authenticated caller on each request; the shared Files
boundary then checks the requested area and operation and resolves the session
from that project's store. Bodies cannot supply identity, project roots or an
alternative session. All Drop Zone mutations run under the session store's
mutation lease and recheck closing admission before touching files. These API
rules do not claim Unix or shell isolation.


An explicit integration request in saved assistant history can open the exact
development slot through the existing dashboard route. The route carries its
session and turn association. The panel ignores a selection for another session,
restores the requested slot on reload, and reports a removed slot. This only
selects configuration; connecting remains an explicit application setup operation.

Integrations is a typed form over the selected session's `integrations.json`.
Provider setup instructions can vary with the selected authentication method.
For Granola, API-key steps explain key creation and Env storage; OAuth steps
explain MCP client registration, callback and consent. The OAuth registration
request is shown only for OAuth, so API-key users are not asked to register a
client. These forms configure the project's connection; they do not grant the
editor access to provider data.
Configuration-only providers such as Google Analytics save public settings and
show Configured, without starting a connection command or claiming provider
verification. Direct setup requests for these providers are rejected before Env
preparation or application execution. Their assistant draft asks the selected framework to wire those
settings into the application; Analytics tracking and consent remain app-owned.
Removing configuration-only settings explains that application reload or deployment
is still needed and does not promise deletion of provider data or prior events.
Chat status recovery also recognizes these providers from the saved configuration.
It reports configuration-only guidance and hides Connect without invoking the
application setup command or fabricating a verified/completed request. Configure
opens the normal settings panel. Skip retains its ordinary explicit dismissal
meaning and does not imply that tracking works.
The chooser lists available services alphabetically and wraps provider names
and descriptions. Search filters both available services and configured slots
(by slot ID, display name or provider), including production configuration.
An empty search result has an explicit message; filtering never changes the
selected configuration form or its draft.
JSKIT owns configuration validation and provider field components. Vibe64 uses
the existing source path policy and agent-write lock, validates before writing,
requires the previously read file hash for replacement, and creates a missing
file exclusively. Creates and saves publish the ordinary source-file event.
The AI form uses JSKIT's static model catalogue and settings-dependent
authentication metadata. It defaults to public Big Pickle, saves administrator
keys as existing Env references, and supports app-owned individual-key
references. Selecting another provider clears the old credential reference.
Saving creates no AI request, OpenCode process, OAuth app or inference gateway.
The generated application's framework owns AI execution and private user-account
management; non-JavaScript apps need not install JSKIT to consume the text file.
The catalogue supplies forms for Google Calendar, Gmail, Drive, Sheets, Docs,
Slides, Search Console, Resend, Firecrawl, Airtable, Notion, Brevo, ElevenLabs,
GitHub API, Apify, Calendly, HubSpot, Linear, Pipedrive, GitLab API, Tally,
Contentful, Asana, Stripe, Replicate, Sentry, incident.io, Fireflies,
HeyGen, Perplexity, Supabase, Google Analytics, BigQuery, Paddle, Mailgun,
Fireworks AI, GatewayAPI, Polar, Storyblok, Oura, Twitch, Slack, Algolia, Twilio, Gong, PostHog,
Chargebee, Ashby, Lexware, Sevdesk, Apollo.io, Attention, Clay, Telegram, KLIPY, Mapbox,
Logo.dev, Google Maps Platform, WooCommerce, PrestaShop, ClickHouse, WordPress (self-hosted), WordPress.com,
n8n, Sanity, Inngest, Amplitude, Atlassian, Canva, Figma, Miro, AWS S3, AWS Athena, Amazon Redshift, Xero, Semrush, Wave, Zoho CRM, Zoho Books, Granola, Hex, Confidence Flags, Confidence Exp, Lightspeed, Databricks, Microsoft Fabric, dbt Semantic Layer, Firebase Cloud Messaging, Salesforce, Google Ads, LinkedIn, X (Twitter),
Microsoft Outlook, OneDrive, Excel, Teams, OneNote, Word, PowerPoint and
SharePoint, and preserves other provider records and application extensions.
Sentry now declares an assistant-owned MCP OAuth connection with an organization
slug and optional project slug. The application binds both consent and tool
requests to that resource. Its inline guidance distinguishes MCP credentials from
the application's error-reporting DSN. The owner can use the existing registration
action to save the client ID in configuration and its secret/callback in
development Env. Phone and desktop checks cover registration and connection
controls with controlled provider responses; coding-assistant attachment is deferred.
dbt Semantic Layer stores a GraphQL hostname, an exact decimal Environment ID
and a service-token reference. Its shared and assistant modes use no OAuth
registration. The runtime verifies environment metadata and browses metrics,
dimensions and saved-query metadata; warehouse execution and managed account
provisioning remain unfinished. Saving does not call dbt.
Microsoft Graph forms identify delegated permissions and account types. Outlook
retains six mail/calendar choices and required Mail.Read, with setup instructions
for registration, callback and Env. Its runtime reads folders, messages and bounded file attachments, sends approved
plain-text mail, sets read state, moves messages and creates personal calendar
appointments. Inline instructions distinguish accepted mail from delivery and
exclude recurrence, invitations, outgoing attachments and a full mail-client UI. OneDrive
retains five file-permission choices and explains how to reduce the initial
selection to reading only. Its instructions cover registration, Web callback,
Env, expiry and shared/per-user consent. The adapter browses nested folders,
returns private short-lived download links and uploads up to 5 MB with explicit
conflict behavior. Native framework clients own larger/resumable transfers; no
file-manager UI or app-folder automation is provided. OneNote retains five notebook
permissions and explains clearing organizational permissions for personal accounts
and optional writes for listing only. Its runtime traverses notebooks, sections and pages, returns bounded HTML content,
and creates/appends escaped text. The app owns safe rendering and write approval;
no rich-text editor, attachments or page replacement is supplied. The Directory
(tenant) ID field accepts an applicable audience keyword or a directory GUID;
the same setting selects runtime authorization and refresh endpoints. Changing
it requires reconnecting existing grants. Word and PowerPoint browse matching
files and folders and read file metadata, with no document editing or download
in these initial adapters. Excel verifies a connection by listing drive files without a workbook ID. Its
required Files.Read permission supports browsing; optional Files.ReadWrite is
needed for worksheet/range reads and cell writes. The JSKIT adapter supports
bounded A1 values/formulas and explicit persistent or temporary workbook sessions;
the generated app owns workbook selection, authorization and presentation. Inline
guidance explains personal-account session restrictions, uncertain writes and
the absence of a spreadsheet designer. All-file permissions remain explicit optional
choices. Its setup instructions explain registration, Web callback, secret
Value, Env bindings and the distinction between shared and per-user consent. New integrations
use the provider's first declared account mode and shared grant-specific defaults; Oura exposes only individual
user accounts and defaults to daily-summary permission, with optional personal
profile and email permissions.
Twitch retains 23 permission choices and defaults to email/profile and followed
channel reads. Its application-specific Client ID, secret reference, callback
reference and ownership mode use the same file. Inline guidance covers registration,
secret rotation, callback/domain changes, eligibility, reward ownership and
revocation. Current Hype Train status replaces the retired events label.
The project runtime provides stream/channel reads, chat, polls, predictions,
rewards, schedules, clips, analytics and WebSocket subscription operations.
The application owns its EventSub socket, reconnection and event deduplication;
there is no editor event gateway. The runtime validates Twitch tokens before
operations; startup and hourly validation of maintained idle connections remains
an explicit application responsibility.
Slack selects a connected user or an installed bot independently of application
ownership. Its form shows 52 user or 49 bot permissions from 57 distinct choices;
changing identity preserves compatible selections and removes incompatible ones.
The same parser rejects incompatible scopes in CLI configuration. Identity,
registration references and remaining permissions survive saving and reloading.
An individually owned bot connection still acts as a workspace bot, not a person.
The runtime lists conversations, reads bounded history and user profiles, and
posts text/thread messages with the selected identity. Optional Signing Secret
references remain in text configuration while values live in application Env.
Inline setup distinguishes OAuth redirects from app-owned event/interaction
routes. The application verifies signed callbacks, binds installations and owns
action authorization and deduplication. Other saved scopes do not imply additional
operations or application login.
AWS S3 and Athena expose the same 18-region selector and explicit access-key ID,
secret-key and optional session-token references. S3 adds a bucket and local
read/write operation limits; the form explains that AWS policies decide actual
access. Athena adds a workgroup (default primary) and optional result location.
Clearing optional references removes them from the file. Both use signed backend
requests, without OAuth callbacks or a fallback to host credentials. S3 checks
listing before connection and can construct temporary GET/PUT URLs; Athena
checks workgroup metadata and exposes separate query lifecycle and catalog/schema
browsing operations. Athena setup explains SQL/IAM workgroups, the additional
Athena/Glue discovery grants, result storage and the Save → Env → Connect handoff.
A successful connection does not establish table or query-result access.
Saving fields does not contact AWS, issue a URL or run SQL. Managed AWS account
assignments, IAM provisioning and STS renewal remain host work.
Redshift selects its shared settings schema from the deployment type. Serverless
requires a workgroup name; provisioned requires a cluster identifier and accepts
an optional database user. Switching type removes inactive fields while retaining
the database, region and credential references; CLI mixed-mode fields are rejected
by the same schema. Its region selector has 34 choices, subject to AWS availability.
The shared-account runtime checks table metadata and offers database/schema
discovery plus explicit query start, status, results and cancellation operations.
Inline guidance names the required Data API and credential actions and the
Save, Set credential in Env, then Connect account sequence. It checks statement targets before
returning results or cancelling; application authorization still owns each query.
Saving does not execute SQL. Per-user Identity Center federation remains unfinished.
BigQuery separates the saved execution/billing project ID from its OAuth client
registration. Inline setup explains query-job IAM, dataset sharing and the fact
that consent and a successful project-list check do not prove dataset access.
The application runtime exposes dataset/table discovery, table schema, query
submission, paged results, job inspection and cancellation. These operations use
the configured project; the application must authorize SQL and job access and
handle query costs. Credential values remain in Env. Desktop and compact form
checks cover rejected project IDs, saved references, setup guidance and a
controlled OAuth connection/reconnection/disconnection flow. Deployment-owned
identity federation is not yet implemented or covered by those checks.
Xero exposes 24 permission choices with read-only defaults. New registrations
automatically select HTTP Basic client authentication while retaining ordinary
Client ID, secret-reference and callback-reference fields. The shared runtime
discovers tenant connections, checks organisation access before accounting reads,
and offers organisation metadata, contacts and invoice summary pages. The host
still authorizes which organisation each caller may use; data access does not
implement application login or managed registration assignment.
Semrush identifies its V4 API-key reference and supports shared or assistant
ownership. It exposes no OAuth fields for this key flow. Inline guidance distinguishes
V4 reports from the separate optional V3 Env credential, which enables regional
domain overview and organic/paid keyword pages for domains, URLs and subfolders.
The same V3 key supports campaign discovery, available dates and organic/paid
position pages; campaign IDs come from discovery and harvested data remains a
provider prerequisite. Captured OAuth support remains incomplete. V3 keyword
pages translate application limit/offset inputs to the provider result-window
contract; application code owns further pagination and report-unit usage. The runtime reads project pages,
creates/renames/deletes projects, and retrieves keyword metrics and bounded
backlink reports. Guidance explains report-unit usage, application-owned pagination
and authorization, permanent provider deletion versus local disconnect, and that
checking project access does not verify every report entitlement. Managed account
allocation remains outside this project-owned credential flow.
Wave exposes 32 permission choices with four read defaults, the same registration
references, and shared, personal or assistant ownership. Its setup panel explains
the provider subscription and approval requirements. Runtime reads cover the
connected user, businesses, customers and invoice summaries. Wave refresh keeps
the original callback URL; changing it requires reconnection. Additional selected
permissions do not add operations, and saving does not initiate consent.
Microsoft Fabric retains an exact tenant GUID and GraphQL API endpoint. Its
user-consent and service-account modes use different resource scopes; changing
mode removes incompatible scopes and the service mode omits the callback.
Service credentials cannot be assigned per-user ownership. Client IDs and tenant
IDs require GUIDs, and credentials remain references. Saving configuration makes
no provider request. The runtime verifies the root GraphQL type; optional schema
discovery needs introspection enabled in Fabric. Explicit document execution can
include mutations and must be authorized by the application. Inline setup explains
exact documents/variables, partial-error uncertainty and the absence of automatic
table dashboards, pagination or subscriptions.
Databricks uses the shared OAuth flow selector for user consent or a service
principal. Its file records the workspace URL, client ID, secret reference and
grant-specific permissions. User consent requires a callback reference; service
accounts omit it and cannot use personal ownership. Switching flows removes
incompatible values, and the same JSKIT validation applies to CLI edits.
Configuration editing does not request a token, execute SQL or run a job.

Lightspeed stores the required X-Series domain prefix, registration references
and 49 permission choices, initially selecting 16 reads. Shared, personal and
assistant ownership use the same file. The runtime binds grants to that store,
persists rotating refresh tokens and reads bounded product, customer and outlet
pages. Changing the prefix requires reconnection; saving does not initiate consent.

Confidence Flags and Exp use separate assistant registrations and grants with
four identity/refresh scope choices. They share OAuth infrastructure and use
different MCP paths. The form preserves each connection's references and
permissions independently; neither saving nor identity consent authorizes
arbitrary tools. Production flag evaluation and warehouse setup are separate.

Hex selects its standard, EU or HIPAA workspace endpoint and persists four
identity/profile/email/refresh scope choices. Assistant ownership and client
references use the same form and file contract. The runtime uses the selected
issuer and MCP resource; changing endpoint requires reconnection. Identity
permissions do not authorize every tool. Registration, consent and tool
attachment remain separate from saving the form.

Granola saves an API key reference with shared or assistant ownership. Permissions
belong to the key in Granola; the form has no OAuth registration or permission
fields. The runtime verifies access by listing notes and supports bounded note,
folder and transcript reads. Its separate MCP connection is not implemented.

Zoho Books exposes eight data centers, an optional organisation ID, and thirteen
permission choices, with organisation, contact and invoice reads selected initially.
The same schema validates and persists these values for CLI and UI users. Leaving
the organisation ID empty permits discovery in the application runtime; saving the
form does not connect an account or choose an organisation.

Zoho CRM exposes seven data centers, three CRM environments and twelve permission
choices with five read defaults. It uses ordinary registration references and
shared, personal or assistant ownership. The runtime verifies the current CRM
user and reads lead, contact, account and deal pages. Token API domains must match
the selected region and environment; a settings change requires reconnection.
The host owns organisation policy and consent; saving configuration does not
connect to Zoho or grant managed access.
OAuth forms edit app registrations and
permissions; API-key forms edit the credential reference. Reference fields reject
pasted HTTP/HTTPS URLs while preserving named environment and custom bindings.
Paddle exposes its
sandbox/live environment, Mailgun its US/EU API region, GatewayAPI its Global/EU
platform, Polar its sandbox/production environment, and Storyblok its five
space regions. Storyblok's inline instructions distinguish Public and Preview
tokens and app-owned preview/cache permissions. Its runtime retrieves lists and
individual stories, including requested relation/link/asset metadata; the app
maps content to native components and owns cache refresh. It does not create a
site, publish content or attach the coding assistant.
Algolia adds a validated application ID and a separate optional
frontend key reference; clearing that optional field removes it from the saved
file. Its primary API-key reference remains for backend access. Twilio provides
US1, IE1 and AU1 region choices, validates separate Account and API Key SIDs,
and labels its primary credential as an API key secret reference. Its separate
optional account Auth Token reference is for application-owned signed callbacks.
Inline setup explains sender numbers/services, POST webhook configuration and
the distinction between API-key revocation and removing provider callbacks.
The application owns SMS/voice behavior, TwiML handlers and event deduplication;
the editor does not receive those callbacks. Gong provides
an access key, a secret reference and an optional company API origin. It rejects
unrelated hosts and restores the default Gong origin when the field is cleared.
PostHog records a numeric project ID, EU/US region and public project-token
reference. Its credential hint explains that the token is publishable and cannot
read private analytics. Runtime verification uses the token; it cannot confirm
that the separately saved project ID matches that token.
Chargebee validates a site name without a URL or domain suffix and pairs it with
an API-key reference; its guidance distinguishes test/live sites and the
transactional read permission required by the customer-list operation.
Ashby and Lexware edit API-key references with provider-specific setup guidance;
Lexware's Public API key remains a private credential. Sevdesk labels the same
reference field as an API token reference and links to its token-reveal steps.
Telegram labels its credential as a bot token reference and explains bot ownership;
KLIPY edits its own app-key reference and links to Partner Panel setup. Both use
the shared file configuration. Runtime verification reads bot information or
trending clips, with credentials attached only by the backend runtime.
Mapbox offers backend geocoding with a separate optional public browser token,
or browser-only maps with a required public Env reference and no backend
credential or setup command. Its shared settings metadata drives both the editor
and server guard. Removing an optional value removes it from source. Backend
verification does not verify the browser token. Native app SDK composition owns
map rendering; JSKIT also supplies bounded directions with GeoJSON results. Google Maps Platform similarly
edits separate server and optional browser key references. Its guidance explains
that runtime verification needs an explicit address and can incur geocoding usage.
Logo.dev edits a publishable
key reference; its browser library constructs public image URLs, with delivery
reported by image load/error events. It does not create a server connection grant.
The editor shows Configured without account controls, and rejects setup commands
for this configuration-only provider before preparing Env or invoking the app.
WooCommerce and self-hosted WordPress preserve HTTPS installation paths and
validate the site's URL alongside its consumer key or username. The matching
secret or Application Password remains an environment reference. WordPress
runtime verification reads the authenticated user, rather than public posts;
WooCommerce product verification does not establish order permission.
PrestaShop similarly preserves the HTTPS store's installation path and saves a
Webservice API key reference. Its setup instructions identify GET permissions
and multistore key association. The runtime uses Basic authentication with an
empty password, verifies product reads, and returns explicit product/order
pages without modifying the store. No OAuth registration is needed.
ClickHouse saves the HTTPS database endpoint, optional username and password
reference. Its Authentication selector distinguishes Basic credentials from
No credentials. Switching to No credentials removes the username and password
reference; switching back starts with empty fields. Empty password references
are omitted from the file. Both modes require runtime verification, and changing
mode or destination invalidates an existing connection. The runtime performs
fixed SELECT queries with typed parameters for table, column and bounded row
reads. It does not expose arbitrary SQL or establish an application's login.
WordPress.com has its own OAuth registration and permission form. User, site
and post permissions default on; the remaining five permission families default
off. The runtime reads the authenticated profile to check the token's client
and actual permissions. The optional JSKIT adapter also creates draft posts or
pages, retrieves and edits them, and performs explicitly confirmed deletion and
restoration. Inline guidance explains publication and permanent-deletion effects;
the application owns its authoring screens and action authorization. Media supports
paged reads, bounded multipart upload, metadata edits and confirmed permanent
deletion, retaining per-file upload errors for application handling. Comments
support paged reads, replies, explicit-status moderation and confirmed deletion;
the site controls visibility and moderator permissions. Stats returns the site's
summary/visits, while taxonomy supports category/tag management and assignment
of existing IDs to posts. Batch combines bounded reads from one site and retains
individual resource errors; it does not support grouped writes. This
is a provider-data connection, not app login.
n8n and Sanity offer assistant-only MCP token configurations. n8n also has an
explicit Discover OAuth settings action: it reads public instance metadata,
updates the draft's authority and advertised scopes, and enables the common
OAuth form. It does not register, connect, write source or access Env. The
request is bounded, and a response for another selection or edited draft is
ignored. OAuth instructions explain callback policy, one client-registration
POST, client ID, secret/callback Env references and consent. The registration
panel uses the discovered endpoint and selected scopes. Changing the MCP URL
requires matching discovery again. n8n preserves HTTPS installation paths;
Sanity uses a fixed hosted endpoint. Both expose token setup instructions.
Saving does not attach tools to an assistant or authorize a tool call. The
shared runtime passes tool names and arguments to the assistant host's policy.
The n8n Register client and connect button calls its source-editor registration
route. It saves the draft and Env, then invokes the application’s normal Connect
operation. An uncertain failure requires explicit review before another attempt. Under the existing session write lock it checks
the draft's base hash, an unused own registration and unused Env keys, then sends
one n8n client-registration request. It delegates private values to the project's
normal Env service before saving public configuration. The client ID is also
saved as a nonsecret Env value for recovery if source saving fails. The shared
session lock already supports nested operations; no second token store or lock
is introduced. After provider creation, local failure is reported without a
retry or secret response. Controlled browser verification covers registration through pending consent;
a real temporary project Env test covers nested locking, masking and dotenv
materialization. A controlled registration failure keeps the registration button
disabled until explicit recovery acknowledgement; a subsequent successful
attempt resumes consent. Switching to personal-token mode hides discovered
OAuth permissions and displays the six token setup and rotation steps. Static
permission controls of other providers remain unchanged. Provider calls remain
controlled fixtures.
Amplitude instead uses an assistant OAuth registration, with US/EU region
selection and separate read, write and refresh permissions. Its form saves the
client ID, secret/callback references and chosen scopes. The JSKIT setup helper
can register a confidential client explicitly; saving this form does not invoke
that helper or begin consent. The runtime binds consent and token requests to
the selected regional resource and verifies tool discovery before saving a grant.
Atlassian uses an assistant OAuth registration for Rovo MCP v2 and exposes 32
product/profile permission choices. Jira and Confluence read/search permissions
start selected; writes, deletes and administration start unselected. The form
preserves independently chosen permissions and credential references across
reload. The runtime uses its v2 resource and authorization server, verifies tool
discovery and delegates exact tool/site authorization to the assistant host.
It does not reuse old v1 grants or provide application login.
Canva uses a hosted client metadata URL and a callback reference. New Canva
registrations explicitly select authentication without a client secret; the
form hides that field and validates the metadata URL. It exposes 16 permissions
and starts with profile, design and folder reads. The shared JSKIT helper builds
the public client metadata document, which the host must serve at the configured
URL; neither saving nor building metadata publishes it or obtains Canva's
callback approval. Changes to client authentication invalidate existing grants
and pending consent. Runtime grants remain encrypted text files.
Figma and Miro use assistant OAuth registrations with client IDs and secret/callback
references. Figma's single MCP permission can expose writes; its setup guidance
requires approval for new clients, and the host authorizes exact tools and arguments.
Miro starts with board reads and separately offers writes, identity and email scopes.
Its consent flow selects a team; reconnecting selects a different team. These
definitions use the shared forms and runtime. Saving does not register clients,
connect accounts, configure app login or attach tools to a chat.
Inngest edits separate Signing Key and Event Key references and an optional
ASCII branch name. Clearing the branch removes it from source. Metadata
verification uses only the Signing Key; it does not validate the Event Key or
run a workflow. The runtime sends an event only after application policy
authorizes its name and payload. A delivery receipt does not prove completion.
Apollo.io guidance requests saved-account search permission and explains its
workspace-wide key limits. Attention guidance uses organization administrator
key creation and replacement steps.
Clay identifies its Public API key separately from its legacy workspace key.
Verification reads user/workspace identity. Query creation and each next-page
request are explicit authorized operations because Clay advances a stateful
search iterator. Its form stores only the key reference; no OAuth callback
or registration is required for this flow.
Known provider settings
use shared schema validation and defaults on save; custom provider records remain
editable without installing their runtime in the editor. Each provider has
setup instructions. Secret values remain outside the source;
the form records their references. A saved configuration is distinct from an
account grant verified by the application runtime.
An outside change reloads a clean form or preserves and flags a dirty draft.
Leaving the page or changing sessions warns before discarding unsaved edits.

The source browser lists, searches, opens, edits, and saves allowed project
files inside the selected session source. It rejects paths outside that source
and reports concurrent changes rather than silently overwriting them. The
source editor publishes successful creates and saves with project, session,
path, hash, and originating-tab identity. In a visible editor, a foreign create
refreshes the file tree, while a foreign save refreshes a clean matching file
or warns without overwriting a dirty draft. A hidden editor admits no new file
revalidation reads; foreign creates mark its tree for one refresh on return,
including when no file is selected. Changing source discards that pending tree
refresh. Reads already in flight may finish.
An assistant turn becoming idle refreshes the visible tree's already-loaded
directory pages and selected file. Hidden editors coalesce that work until
return. This adds no recursive watcher or continuous tree polling. Tree refresh
keeps the previous tree visible until replacement pages are ready, preserving
expanded folders, selection and editor position; concurrent local edits are
never replaced. The existing Refresh action uses the same path.

The selected file header and file-row actions offer Star and Download. Downloads
return the saved file's original bytes and filename, including binary files and
files too large to edit. An unsaved selected file offers Download saved file or
Save & download; a failed save does not download a supposedly saved draft.
Source containment, excluded-path and symlink protections also apply to downloads.
The download handler awaits Fastify's streamed reply so its async completion
cannot send an empty response before the file stream starts. Route verification
checks original bytes over real HTTP, including nonempty binary, text, large and
genuinely empty files.
Opening a binary or oversized file from a chat link or the file browser shows
its filename and a Download action. That selection stays outside the editable
buffer, autosave and text-file observation. Opening another text file restores
editing; changing sessions discards the selection and ignores pending file-read
results. Download failures show their error message and leave retry available.

Stars are personal and project-scoped, not Git changes or shared project settings.
The server stores at most 100 paths per authenticated account in private project
runtime state, with serialized atomic updates. Stars follow the account across
devices and sessions and retain their insertion order. Missing or excluded files
remain listed as unavailable in the selected session until unstarred. Availability
checks touch only the bounded starred paths, never the whole source tree.
The collapsible Starred section and chat's searchable star picker share one
client state. The file browser shows one filename per row, with an ellipsis for
long names and the full path on hover and in each button's accessible name.
More than four stars start collapsed.
The picker is a popover on larger screens and a bottom sheet on
compact screens, with a compact search field and Close on one row and no
redundant heading. Opening a star uses normal Dashboard Files navigation without
clearing the chat draft. Toggle failures roll back only the affected star and
show action feedback without shifting the list. Once pending changes settle,
a failed batch rereads saved stars to restore authoritative ordering without
losing successful changes. Newer edits supersede an in-flight reread; reconciliation
remains pending until a current read succeeds. Successful toggles alone do not
add a read or generate toasts. Opening the picker
reloads saved stars, so other-device changes appear without background polling.
Selected-file observation follows the active session and editor pane.
Retaining an inactive session does not retain its file connection; returning to the
editor reconnects and revalidates the selected file through the existing sync
owner. Events from a replaced connection do not update the current editor.
Successful revalidation clears its own previous error even when the file is
unchanged or has a local draft, without hiding a failed tree load or another
file's failed open. Switching to Preview retains the selected dashboard tool
inactively; returning to Files keeps its selected file and draft. A cold Preview
does not mount a source tool, and explicitly choosing another dashboard tool
still unmounts the previous one.

When its source is not yet known, opening Files or another source-backed tool
directly waits for the selected session's initial detail read. The Project pane
shows its existing loading skeleton during that wait, keeping the requested route
and bringing the pane into view on compact screens. A loaded session opens Files even when its repository is unavailable, keeping
Drop Zone and owner Session access useful. Other source-backed tools still need
a ready source; failed session detail uses the normal environment fallback.
Navigating elsewhere while detail loads is respected. Only the active session
host hydrates or redirects the
shared tool route; a retained hidden host waits until reactivation to reconsider
its source and the current route.

A source explanation is temporary assistance for a selected code range or file.
A matching cached answer can appear without starting a provider conversation;
its first follow-up starts an independently owned conversation through the same
verified low-cost execution profile. The server retains source, account, profile,
and conversation authorization. The browser submits the explanation identity
and question, not a provider thread or model configuration. Failed conversations
offer regeneration instead of another follow-up; unavailable assistants leave
the existing answer readable with generation and follow-up actions disabled.
Stop targets the selected explanation. Closing keeps its answer visible and
disables conflicting actions until cleanup is acknowledged. Failed cleanup
retains the answer and reports action feedback so Close can be retried. Changing
session or unmounting releases the old stream's pending browser state; a late
Stop response, cleanup result or streamed event cannot reopen that explanation
or overwrite a newer request, including a follow-up in the same conversation.
Hiding a retained editor does not cancel an explanation the person started;
its answer remains available when they return.

The Repository presents the session's complete current changes against saved project
work, even when those changes are already committed inside the session. It can
open an exact changed file without exposing staging mechanics to the user.
Current changes opens outside the dashboard navigation shell, using the full
project pane like Files. Back to dashboard restores the last dashboard page;
a direct link returns to Env when there is no previous dashboard page.
Current changes refreshes when an assistant turn becomes idle and when Vibe64
observes editor, Save, or repository-status events, so work completed during a
turn appears without a manual reload. Arbitrary filesystem writes that produce
none of those events are not promised to appear immediately.
Current Changes first renders from the last locally proven canonical version
while Vibe64 checks the configured GitHub, managed-Git, or local-repository
authority in the background. Save remains unavailable until that authority
check succeeds. The initially selected file difference comes from the same
immutable worktree snapshot as the file list.

Switching away from a retained session retires its History and Current Changes
readers and realtime listeners. Late responses cannot start further review work.
Returning starts a fresh read; transient History paging and version details
reset. This does not tear down chat or session-wide status tracking.

History file paging and differences belong to the selected commit. Selecting
another version clears the previous version's loading and error state. Late
results from that previous selection cannot change the new view or prevent it
from loading more files.
Closing version details retires that selection, including a pending file list;
its later response cannot start an unused diff behind the closed dialog.
After Save, History refreshes before a separate authority-check result is applied,
including a check already in flight. A check for the displayed version does not
load it again; a newer version still refreshes the list, and a failed check does
not discard the successfully refreshed history.
A replaced Save request does not keep the current authority check busy after
the latest History response has arrived.
Loaded history and version files remain usable if a later page fails, and the
same page can be retried without discarding earlier content. A failed first load
offers an explicit retry. Once a version's file list arrives, its files are
selectable while the independently owned first diff is still loading.
In both History and Current Changes, a selected filename is literal, not a Git
search pattern, even when it contains wildcard or colon characters. Whitespace,
tabs and literal backslashes remain part of the exact filename through listing,
selection and diff requests. An exact file diff never includes descendant files,
including when a deleted file has been replaced by a directory; Git submodule
entries remain independently readable.
The full-screen history view scrolls its file list independently from the diff,
so long versions keep later files and their Load more action reachable without
moving the selected difference out of view.
Desktop Current Changes also scrolls its file list and selected difference
independently. In short windows, status notices and the review pane can scroll
below the fixed heading without collapsing the pane. Dashboard navigation owns
its own scrolling, so reaching a lower section does not shift the page content.

## Implementation map

- The source-editor service owns explanation cache lookup, temporary conversation
  creation and cleanup. `useVibe64SourceEditor()` owns the selected explanation,
  request generation, streamed messages and acknowledged Close state;
  `Vibe64SourceExplanationPanel` presents the answer, follow-up, cancellation
  and recovery controls. An answered cache record does not need a thread id to
  enable its first follow-up.
- Source explanations use a lock for their own conversation rather than holding
  the session source lock while awaiting an answer. Source edits, previews and
  other explanations can proceed; a second turn in the same explanation receives
  an explanation-specific busy response. Session renewal admission still applies.
- Server interruption stays outside the conversation lock. If a new message
  has not received its provider turn identity, Stop waits for that exact message's
  identity or startup failure; it never reuses the previous message's turn. After
  its provider acknowledgement, Stop compares the targeted assistant message and
  provider turn before publishing state; it cannot overwrite a newer turn or restore an
  explanation that has already been deleted.
- `runSessionWorkOperation()` admits each Current Changes, file-diff, work-state,
  or update-check request as one managed job. Canonical Save uses one managed
  checkpoint-and-summary job before commit naming and one managed
  publish-and-reconcile transaction under the project source lock.
  `sessionWorkOperationCommand.js` performs each operation's exact Git work
  inside its admitted child instead of paying managed-host admission cost for
  every individual Git command. It loads the Genesis compiler only for Save,
  so update checks and other inspections avoid that compiler startup cost.
- `refreshWorkState(observedWork)` accepts the complete work-state snapshot
  already returned by Current Changes. The runtime host also projects Save and
  Update task events directly from the mounted realtime session, so visible
  progress does not wait for repository inspection behind an active source
  lock.
- Current Changes calculates its initial selected-file difference inside the
  file-list managed job, reusing that job's exact worktree tree instead of
  admitting and scanning the worktree a second time.
- Concurrent update checks for one session share the same exact server
  operation, and repeated repository refresh events collapse into one bounded
  follow-up Current Changes inspection.
- History validates its pinned Git snapshot once per files or diff request. When
  that exact commit is selected, its object resolution is reused; older selected
  commits still receive their own resolution and reachability checks.

Firebase Cloud Messaging uses the shared service-account credential mode. The
form stores a reference to private JSON and an explicit target project ID.
Server/native mode needs no browser fields; web-push mode requires public API
key, app ID and VAPID key. Switching back removes those three fields. Adding
this provider does not create an OAuth registration or callback. Saving still
only writes the session's text configuration; provider verification and
notification sending are separate application-runtime operations.


Salesforce stores the environment and matching My Domain URL alongside ordinary
client and secret/callback references. Production includes Developer Edition;
Sandbox requires its sandbox domain. Invalid URLs and mismatched environments
cannot be saved. Shared, individual and assistant ownership use the same form,
with explicit API/refresh permissions. Saving remains a source-file operation;
OAuth consent and org API access are verified by the application's runtime.

Google Ads uses project-owned Web OAuth and an optional manager customer ID;
Google Cloud API access approval belongs to the account owner. The public editor's
GoogleAdsSearchPanel edits `extensions.googleAdsSearch[integrationId]` separately
from OAuth settings, preserving consent when campaign copy changes. Shared-account
owners can discover accounts/goals, prepare a Search plan, validate it, create it
paused and separately review launch, pause and bounded reports. Existing
integrationSetupCommand owns the `ads-*` transport and rejects unexpected display
fields; the generated application's command owns all provider requests, refresh,
authorization and credentials. JSKIT supplies the reusable Search service; other
frameworks implement the same portable JSON/Env and documented command contract.
Conversion tag snippets display as text and are installed by the app's own consent
and tracking implementation. Billing, website and advertiser readiness remain
manual confirmations. Current editor management uses development Env, which may
connect to a real Ads account. No account provisioning, PMax/Demand Gen, automatic
coding-assistant tools, Online registration or advertising gateway is added.

LinkedIn saves its confidential Web OAuth references and the four captured
permission choices. OpenID and profile are required by shared configuration
validation and shown checked/disabled in the shared fields; email and member
publishing are optional and initially off. The same file supports shared,
per-user and assistant ownership. Its JSKIT runtime reads member
userinfo, accepts missing optional email fields, and requires reconnect at
ordinary access expiry unless LinkedIn supplied an approved refresh grant.
Approved text publishing derives the author from the connected member and needs
the publishing grant; media/organization publishing and application login remain
outside this adapter. Token refresh cannot expand granted permissions. Saving the form
does not perform consent or activate a managed gateway.

X (Twitter) stores an app-only bearer-token reference for shared or assistant
access, with no OAuth registration or permission fields. Its setup explains
that a real public username is required for runtime verification. The runtime
reads public profiles, post pages and recent search with author/media expansions,
while preserving large string IDs and explicit query pagination; this
credential does not authenticate individual app users or authorize posting.
Saving remains a text-file edit. The application owns its token, query permissions,
attribution and display; Vibe64 does not allocate managed tokens.

Self-hosted WordPress retains its site URL, username and Application Password
reference. Inline guidance now distinguishes successful account verification
from WordPress capabilities needed to edit, publish or trash content. The
application runtime can read/create/update/trash posts and pages; creation
defaults to draft, updates preserve omitted fields and trash cannot force permanent
deletion. The app owns review decisions and resource authorization. Media operations
include metadata reads/edits, bounded multipart uploads and explicitly confirmed
permanent deletion. User operations include reads, creation with explicit roles,
profile updates and permanent deletion with a replacement author. WordPress
capabilities remain authoritative. Uploads and follow-up content writes are
separate actions; failures do not trigger retries or automatic cleanup. No
WordPress.com behavior changes.

TikTok's form labels its OAuth identifier Client key and keeps the secret and
static HTTPS callback as backend references. Basic profile permission is required;
profile details, statistics and video metadata permissions are optional. Shared,
individual and assistant ownership edit the same portable file. Its JSKIT runtime
verifies the creator, rotates refresh tokens and reads explicit video pages;
declined optional permissions remain unavailable. Saving does not perform consent,
post videos, create application login or activate a managed registration.

Wix stores an account ID and API-key reference for shared or assistant ownership.
The form validates these with the same JSKIT schema used by CLI consumers and
preserves them across reload. Its runtime reads explicit site pages under that
account credential. It has no callback or per-user OAuth registration, and saving
does not create, publish or change a Wix site.

Snowflake stores an account URL, optional role, exact warehouse/database/schema
defaults and confidential OAuth registration
references in the same text file. Editing the role updates its required OAuth
permission; clearing it restores default-role access with refresh selected.
Shared, per-user and assistant ownership survive reload with the exact settings.
The runtime lists bounded database metadata pages and supports parameterized SQL,
explicit polling/partitions/cancellation and warehouse create/resize/resume/suspend/delete.
It sends the configured role and requires new consent after account or role changes.
The application owns query, handle and warehouse authorization. Defaults do not
restrict resource access; Snowflake grants do. Inline instructions explain registration
SQL, Env references, data and warehouse privileges, callback changes and billing.
Registration provisioning belongs to the target Snowflake account; saving the
form neither provisions it nor runs SQL. Managed assignment remains unfinished.

Gemini Enterprise stores the project ID, location and engine ID with Google OAuth
registration references. The location selector supports global, US and EU engines;
CLI configuration uses the same validation. Shared or assistant ownership and all
fields survive reload without rewriting other providers or extensions. The runtime
checks engine metadata and searches explicit document pages as the connected
Google account. Search/source permissions remain separate from metadata access;
this initial fragment provides no app-user Google identity or managed gateway.
Saving configuration does not provision Google resources or retrieve documents.

Workday stores the REST API, token and authorization endpoints for the same tenant
with confidential registration references. The authorization host may differ from
the API host. Only personal account ownership is available, and permissions are
configured as functional areas in Workday rather than selectable URL scopes.
The editor and CLI reject mismatched tenant endpoints and preserve all fields on
reload. The runtime checks the connected worker and reads Staffing v7 pages;
Workday domain permissions determine visible records. Saving does not contact
the tenant, create a registration or implement application login. The managed
gateway remains unfinished.

Shopify accepts the permanent myshopify.com store domain and either an installed
organization app's client ID/secret reference or an existing Admin API token
reference. An organization grant has no callback field. New registrations use
the provider's declared first grant type, so service-only providers start with a
usable credential shape. The Shopify runtime reads and changes individual products
through the pinned GraphQL API; saving configuration makes no provider requests.

Its shared Assistant permissions panel stores access enablement, a default and
all captured per-action choices in `assistantPolicy`, outside credential settings.
Changing Manage all permissions clears individual overrides. Disabled access
disables the permission selectors while preserving their values; re-enabling and
file reload restore them. Normal Shopify scopes remain separate. The CLI uses the
same strict policy validation, and policy changes do not invalidate the store grant.

An application composes assistant tools with the shared runtime's assistant
execution mode. The existing host authorization callback owns real approvals;
the runtime requires an explicit approved result for Ask each time and denies
Never allow. The editor's actual Connect/approval journey, workspace-level
availability, store creation/claiming, other merchant consent and the remaining
variant/discount operations are not implemented by this configuration panel.

Wiz stores a service-account client ID/secret reference, a token endpoint,
optional comma-separated CI/CD policy names and a BLOCK/AUDIT/DISABLED findings
filter. Its client-credentials registration has no callback. Shared validation
rejects invalid policy lists and raw secrets; clearing policies restores tenant
defaults. Both captured endpoints round-trip, while the form explains that Auth0
execution still needs a compatible runner. The JSKIT scanner runs an installed
Wiz v1 CLI on a host-authorised source snapshot and returns its revision, policy
verdict and report. The editor does not execute scans from this form. Workspace
access, scan scheduling, security findings and managed assignment remain host
work, separate from the coding-agent implementation.

## Application-owned integration setup declaration

The public Genesis boundary inspects the opaque `Integration setup` Stack
section as `vibe64.integration-setup.v1`. It accepts exactly one command:

```markdown
## Integration setup

- Command with `nodejs` in `.`: `node` `scripts/integrations.js`
```

An application using another framework declares its own executable and arguments.
The parser preserves exact argv, validates runtime identifiers and relative paths,
and computes an operation hash. Missing setup or `- Nothing.` is unconfigured;
conflicting inspection diagnostics block it. Inspection executes no command.
The command adapter implements bounded capture through the existing execution
service. The project-scoped POST route
`/sessions/:sessionId/integrations/:integrationId/setup` accepts operation,
attempt ID, verification inputs and an optional editor setup-request association.
That association contains the originating turn, request fingerprint and current
configuration hash. Authenticated request context supplies the actor; body actor
fields are ignored. Session and integration selection come from
route parameters; the server selects the development environment. The service
validates the request and inspects configuration, the declared command and runtime
availability under the source lock before preparing Env. Missing setup, invalid
selection and a busy source therefore do not provision resources. Env preparation
uses the project service outside that lock; the service then reacquires the lock
and repeats inspection before executing the application command. Missing declarations remain
unconfigured. Personal account connect/cancel/disconnect belongs to the
application and is refused here.
When an editor request is supplied, the service checks normal assistant access,
its saved slot/request identity and configuration hash both before Env preparation
and before command execution. An already-decided request cannot run another connect command. Status can reread
the application's live state and return the original saved decision. A connected result must include an application verification timestamp
before the session store records completion. A concurrent Skip remains Skipped.
A newly completed decision publishes a session refresh through the existing
core publisher; status restoration emits nothing. The event contains no provider
result or credential metadata. The association never enters the application command protocol, and this operation
does not deliver an assistant continuation. The Configure card supplies this association through the route. The shared
Integrations model attaches it only to the matching development slot and session,
never production. A returned decision reloads the conversation. Subsequent
explicit account reconnection omits a decided request association.

`runApplicationIntegrationSetup` also accepts a host-selected release source root
and private Env-file reference. It reuses the same file policy, provider
configuration checks, Genesis operation inspection and bounded command protocol.
After the command returns, it rereads the configuration and rejects a changed
file with a conflict response. This catches external CLI edits and command-owned
source edits that bypass the editor lock; it never repeats the command to recover.
It does not select a deployment, read session state or prepare development Env.
The hosting caller owns release selection and coordination for the entire call.
`readApplicationIntegrations` supplies the same validated file snapshot to a
hosted release reader and the development form. An absent file yields an empty
configuration; malformed or unsafe source is still rejected. Production hosting
may expose that snapshot through its own project routes.

A host-supplied production API path enables the shared panel's Development and
Production selector. Production configuration is read-only and names its release;
the command body carries that release ID, including status after cancellation.
Production operations require the host's owner flag and do not depend on a
development session or its suspended source operations. The server independently
authorizes them. Returning to Development restores its tab-memory draft. The
chosen environment and slot are remembered per project; live connection state
is reread. Release changes invalidate old command responses and dismiss dialogs.
Every setup request requires its selected slot to exist in the current configuration;
a release that removes that slot clears its displayed connection without probing it.
Production Env links lead to Deploy with no development prefill; the panel
explains that Env changes must be published to affect the running release.

The Integrations panel checks saved shared-account configuration through this
route and displays application-reported state. Unsaved configuration cannot
connect. Pending consent opens in a separate provider tab and can be checked or
cancelled; cancellation refreshes status so an older grant remains visible.
If that status read fails, the panel retains the cancelled result and reports
the failure. Check connection can recover the existing grant without starting
another consent attempt. The focused client cancellation fixture covers both
the successful refresh and failed-read recovery; it does not perform live consent.
After failed key-based re-verification of an existing account, the panel rereads
application status while preserving the verification error. This lets an Env
credential replacement report Reconnect required instead of inheriting the old
key's Connected label. The recovery read does not complete a chat setup request
or make another Connect call. If status also fails, the original error remains.
Selecting a saved connection after reload checks the application again. Results
from a chat-associated Connect first recover application status under the same
source write lock used to start consent. A surviving pending attempt is returned
without another Connect call; an already verified connection can complete the
request. Disconnected or reconnect-required state proceeds to Connect. Missing
setup or incomplete bindings remain actionable setup guidance. Ordinary account
management without a chat request keeps its explicit reconnect behavior. Results
from a different session, integration or configuration revision are ignored.
Disconnect requires confirmation and keeps configuration. Individual-user
configuration explains that connection belongs to the application's own screen.

Focused service tests exercise the real Genesis inspector with a controlled
command runner: exact source, argv, runtime and Env; unchanged configuration;
production/personal-account rejection; missing integration/declaration; and source
lock refusal, with no Env preparation for refused requests. A configuration change
to personal ownership during Env preparation prevents command execution. Route tests prove that request-body executable, Env, source path,
and session overrides are not forwarded. These are fixture checks, not proof of
a live provider connection.

Sources: `packages/vibe64-genesis/src/server/integrationSetup.js`,
`packages/vibe64-genesis/src/server/index.js`, and
`tests/server/vibe64IntegrationSetup.unit.test.js`.

The adapter uses `vibe64.integration-setup.command.v1`: one JSON object on stdin
with `protocol`, `requestId`, `operation` and `integrationId`. Operations are
`status`, `connect`, `cancel` and `disconnect`. Connect may include provider
`verificationInput`; cancel requires `attemptId`. The caller resolves and
checks project access, source, runtimes and environment before invocation. The
application command runs as its authorized setup operator; it must not interpret
an editor user ID as an application user. Individual end-user consent uses the
application's own authenticated routes.

One JSON response echoes `protocol` and `requestId` and reports a known `status`.
Optional metadata is limited to `grantedScopes`, `verifiedAt`, `callbackUrl` and
`accountLabel`. The last is bounded, escaped display text from a verified
provider response, available only for connected or reconnect-required status.
It does not identify the application's authenticated user or grant permissions.
Pending consent includes `authorizationUrl`, `attemptId` and `expiresAt`. The
application persists that attempt and completes its own HTTP callback. Returning
pending must not keep the command waiting for browser consent. Status can return
the same pending attempt after navigation; cancellation uses its exact ID.

Responses are capped at 32 KiB; commands have a 30-second bound. Unexpected
fields, invalid metadata and mismatched responses fail. Failed command output
and execution exceptions are not returned to the browser. Tokens remain in the
application store. Disconnect reports disconnected; cancel reports cancelled
without claiming the previous live grant was removed. The editor must refresh
status after cancellation to display any preserved connection.

Sources: `packages/vibe64-source-editor/src/server/integrationSetupCommand.js`
and `tests/server/vibe64IntegrationSetupCommand.unit.test.js`.


Connection UI evidence: three focused `integrations.spec.ts` browser cases pass
at compact, medium and expanded widths against a fresh build. They exercise
Google Calendar pending consent restoration after reload, cancel/status recovery,
connected status and confirmed disconnection, plus Resend verification failure,
retry and reconnect. Provider setup responses are controlled fixtures; the test
uses the source service for configuration persistence. This does not prove
application command implementation, live authorization or production execution.


Callback setup consumes optional `dashboardContext.applicationPublicUrl` from the
host. `src/lib/integrationCallbackUrl.js` accepts an application origin and the
provider's suggested callback path, or the registration-specific convention.
It does not derive an origin from the editor location. A user may edit the
suggestion. Set callback in Env navigates with public `prefillKey`/`prefillValue`
parameters; `EnvPanel.vue` fills its normal Add form without writing. Saving uses
its existing environment/session-scoped command. The suggestion is not evidence
of an implemented callback or a registered provider redirect URL.

The callback Copy action uses the browser clipboard and reports failure without
claiming success. Env's prefilled form detects a present record using the existing
Env resource and labels the action Replace value. It does not save on navigation;
the normal explicit command remains the only writer.

`packages/vibe64-source-editor/docs/application-integration-setup.md` documents the application-owned command
and callback contract for JavaScript and Laravel applications. It describes the
same inputs and outputs without installing PHP code in JSKIT or inferring a
framework command. The examples require application implementation and do not
claim production setup support.


Configured OAuth client secrets and API-key/service-account references offer a
Set credential in Env link. It selects the exact referenced Env key and a blank
masked secret field; users explicitly save through the existing development Env
operation. Secret navigation never accepts a credential value from query input.
Unsaved integration configuration must be saved before this handoff.
Production setup guidance explicitly maps credential/callback Env steps to
Open production Env and the published application's environment.


The editor remembers integration selection and catalogue search separately for
each project/session through its existing browser-storage utility. Returning from
Env or reloading restores that selection; connection status is requested from the
application again, never restored as a saved Connected claim. Configuration and
credentials are not stored with this navigation preference. Session navigation retains unsaved configuration drafts in tab memory, keyed
by the session API path. Returning restores the draft and compares its baseline
with the current file; late save/reload results remain scoped to their request.
Drafts are not written to browser storage. Page unload prompts when a draft is
unsaved because a full reload would discard that memory.

While provider consent is pending, returning focus or making the editor tab
visible rechecks the application's status. Hidden/inactive views and unsaved
configuration do not run this check, and disposal removes the event listeners.
Returning from a provider does not itself prove success; a failed check retains
the pending attempt with its error and retry action. Connected accounts do not
trigger this pending-consent refresh on every focus event.

Connected accounts expose Reconnect for OAuth and Verify again for other
credential methods through the same Connect operation. Required verification
inputs remain available for the new check. Cancelling OAuth replacement asks
the application for status again, so a preserved prior grant remains Connected.
Key verification uses current Env credentials; a failed check preserves the
last verification record and displays its error, not an assertion that the
new key works or that an overwritten key has been restored.

Disconnect confirms removal of this project's development connection and pending
consent. Both confirmation and disconnected status distinguish this local action
from provider-side revocation. Configuration and Env remain; the provider's own
revocation controls can affect other apps sharing that registration or key.
Changing the selected integration or project/session context dismisses pending
discard, removal and disconnect confirmations so they cannot target another
account. Callback overrides and copy feedback reset with that context.


The setup result accepts only fixed `credentials-missing` and `callback-invalid`
issue codes on an unconfigured result. The panel supplies actionable text for
those settings problems, distinct from a missing application command. Arbitrary
issue strings and issue codes attached to Connected results are rejected by the
command adapter; raw execution failures remain redacted.

The compact integration browser fixture covers Google missing-credential and
invalid-callback guidance plus Resend missing-key guidance, followed by recovery
into the existing connection flow. These checks use controlled app-operation
responses; they do not establish real provider consent.

The development connection panel labels granted permissions using the selected
provider's metadata, retaining unrecognized scope identifiers verbatim. Its
last-verified timestamp comes from the application's status result; checking
local readiness does not imply a new provider verification. Missing timestamps
are omitted. Requested permissions remain in the separate configuration form.

When an application reports missing integration setup code, Prepare setup request
uses the existing session composer prefill operation to append a framework-neutral
request to the current draft. The user reviews and sends it normally. Only the
saved integration identifier/provider are included, never credential values.
The action follows assistant access and source-operation availability and is
unavailable with unsaved configuration. This is a composer handoff, not an
automatically submitted setup task or a completed chat-card lifecycle.

Callback setup displays the application's reported callback separately from the
suggested URL. Each has an explicit Copy action. When they differ, the screen
explains the required Env and provider redirect update; it does not overwrite
the configured URL or claim that the provider already accepts the suggestion.

Amplitude and Atlassian setup display a manual OAuth client registration request
before a Client ID is available. Provider metadata owns the registration endpoint;
Amplitude selects its US/EU endpoint from the form's region. The read-only JSON
uses the project name, suggested callback and currently selected permissions.
Miro uses the same registration-request panel for its MCP client endpoint,
with the selected board/identity scopes and exact application callback. Inline
instructions distinguish MCP registration from REST API apps, explain Env
credential handoff and team selection, and keep discovery separate from tool use.

Copy actions copy only public registration metadata and never submit a provider
request. Missing callback input leaves the request empty. Instructions map the
successful response's client_id to Client ID and client_secret to the project's
existing Env reference. The application still owns registration and consent;
the ordinary Prepare setup request action does not perform registration.

Individual-account configuration offers a reviewed request for the application's
own authenticated account connection screens. It requires user-derived grant
ownership and keeps app login separate. Saving this mode and preparing its draft
do not invoke the shared account setup command or connect the builder's account.

Teams exposes required team/channel/profile reads, selected optional channel
send and all-user-profile reads, and optional channel-message read and chat
read/write. Its inline guide covers Entra registration, Web callback and Env,
explains how to clear optional permissions, and distinguishes granted permissions
from the corresponding channel/chat operations implemented by the runtime.

Providers may describe text inputs needed for their verification operation.
The connection panel renders these inputs before connect/reconnect and sends
them only with Connect. Values remain in tab memory by session and integration,
including navigation away and back; they are not configuration or Env values.
The application validates them before provider consent or requests. Sheets,
Docs and Slides supply their document identifier fields through provider metadata.
SharePoint supplies its site-search term. Its permission form includes required
site/profile reads, initially selected optional site write and file read, and
optional site manage, full control and file write. Inline instructions explain
how to clear optional permissions for search-only use, register a Web callback
and transfer secret Value through Env. It accepts organizational accounts only;
site-write consent enables the documented file/list operations, while extra scopes
do not add site provisioning or administration.

PostHog supplies its flag-evaluation identity, Maps its geocoding address and X its public
username. Maps and X explain potential provider charges beside their check input.
Connect remains unavailable while a required verification input is blank. The
application validates the supplied value; the editor checks only its presence.

Callback setup shows a missing-address explanation when it cannot suggest a
URL. The person can enter the full application callback explicitly. Suggested
values remain separate from the app-reported configured callback, and moving
to Env never overwrites a saved value without an explicit save/replacement.

The callback form follows changes to its supplied application origin until the
person types an override. Later origin changes preserve that override and never
rewrite the saved Env reference. The mismatch guidance calls out provider redirect
updates and possible reconnection. A focused form-state fixture covers these
transitions, including a missing origin; it does not claim host URL selection
or provider callback reachability.

Production integration credential and callback links carry the same draft-prefill
parameters as development links to the Online production Env page. Credentials
carry only the key and secret flag; callback suggestions can include the public
URL. Each Env page owns the explicit save operation.

Provider setting metadata can identify additional Env credentials. The integration
panel provides an Env shortcut for each configured reference as well as the
primary credential. Algolia uses this for its optional frontend search key, with
a publication notice. Values remain in Env; clearing the optional reference
removes its shortcut, without deleting the Env value.
AWS connections use the same metadata for access key ID and optional session
token shortcuts alongside the secret access key. All three point to the selected
project's Env entries; the integration file contains only their references.


Canva setup renders a public client metadata document through the catalog's
existing metadata builder. The current client URL, display name and callback
suggestion feed a read-only JSON field and copy action. Invalid or incomplete
inputs show guidance instead of a usable document. The application owns hosting
the JSON and obtaining callback approval; the editor neither publishes the
metadata nor automatically attaches assistant tools.

Notion configuration distinguishes Application data (REST) from Hosted assistant
tools (MCP). The shared provider settings constrain authentication and account
modes; changing credential family creates a fresh registration. Setup text may
resolve from settings before the authentication-specific fallback, so MCP
registration instructions do not show REST client setup. Runtime and form
compilation are fixture-checked; the controlled browser journey verifies all
three modes, their guide links, saved settings and connection lifecycle.

Connection lifecycle commands suppress the generic success snackbar because
the panel already displays their resulting connection state. This includes
automatic status reads; they no longer show “Completed.” on opening or
refreshing an integration. Error feedback remains enabled. Provider setup
links can resolve from connection settings before the existing authentication
fallback, so Notion links to the internal, public or MCP guide as appropriate.


Pipedrive uses the shared API-token and project-owned OAuth configuration forms.
Each mode supplies six inline setup instructions and its own official guide
link. OAuth guidance explains Developer Hub registration, the single project
callback, Env secrets and private-app draft/live installation limits. The
JSKIT runtime retains the provider-returned company API address privately with
each grant; it is not a shared project setting. Controlled browser checks cover
both credential modes, errors, cancellation, reconnect, disconnect and reload.


New integrations select all required permissions as well as recommended ones.
Required checkboxes remain disabled so users cannot clear permissions the
provider adapter needs for verification. Oura's daily permission is required:
its provider would otherwise interpret an omitted scope parameter as all scopes.
The application still respects permissions declined during provider consent.


Oura's per-user configuration provides the app-user wiring request, Client ID,
secret/callback Env links and six inline setup steps. Consent happens in the
application account screen, not the editor. The controlled browser review
verifies that boundary, required daily permission and registration reload;
the JSKIT runtime tests independently verify consent and refresh behavior.

Paddle's project configuration exposes sandbox/live selection, its backend Env
key reference, six inline credential steps and the captured assistant permission
categories. The rendered review covers failed credential verification, retry,
disconnect and persistence of the environment and webhook policy after reload.
These controls configure the app's merchant connection; they do not provision
merchant accounts or certify production payment readiness.


### Payment declarations

The Stripe/Paddle integration detail renders `PaymentConfigurationPanel.vue`.
It edits `extensions.payments` in the same integration draft and preserves the
existing Save/conflict/navigation lifecycle. Shared payment schema validation
runs before client submission and in source-editor Save. Env buttons navigate
to the existing Env editor; no payment secret is put in the declaration. The
host's application address supplies suggested billing/webhook URLs. These
screens do not execute payment operations or mark checkout ready. Paddle has a
separate public client-token Env reference and entry action; its inline steps
explain that this browser token is distinct from the private backend API key.

Sources: `src/components/studio/PaymentConfigurationPanel.vue`,
`src/components/studio/IntegrationsPanel.vue`,
`src/composables/useVibe64Integrations.js`,
`packages/vibe64-source-editor/src/server/service.js`


Payment preview/publication uses the existing Integration setup command runner.
The request adds an explicit payment environment and publication review ID;
response parsing accepts only bounded catalogue display fields. Source-editor
preflight validates the saved payment binding, requires owner access and checks
the returned merchant ID. The existing post-command source hash check remains.
`useVibe64Integrations` keeps reviews separate from account-connection state,
clears them when selection/source changes, and never retries publication on
failure. `PaymentConfigurationPanel` displays changes and requires publication
confirmation. Development controls only are exposed in this increment.

Sources: `packages/vibe64-source-editor/src/server/integrationSetupCommand.js`,
`packages/vibe64-source-editor/docs/application-integration-setup.md`

Native Laravel application guidance is documented in
`packages/vibe64-source-editor/docs/application-payments-laravel.md`; it defines app-owned configuration,
provider composition and conformance requirements without a PHP implementation
in the JavaScript framework. Native runtime conformance is not yet established.

Payment catalogue setup also offers a draft action under the existing assistant
and owner controls. `IntegrationsPanel` adds saved payment requirements and imports
the public `application-integration-setup.md` and `application-payments-laravel.md`
as text; those canonical documents travel in the draft rather than being assumed
to exist in the app. Payment schema, semantics and conformance examples come from
the canonical static payments-core package exports and are included for every
framework. They are data and instructions, not a requirement for Laravel to run
JavaScript. The draft asks for customer-scoped provider history with separate
authorization and preserves invoice/transaction distinctions. The action is disabled for dirty,
busy or production state. `PaymentConfigurationPanel` emits `prepare`; the parent
uses the existing `requestAssistantDraft` boundary and never sends automatically.
Stripe setup instructions include failed-payment/action-required invoice events.

The payment branch of `integrationSetupCommand.js` accepts `payments-readiness`
with the same environment and owner checks as catalogue management. Its result
requires all nine bounded check identities and rejects an overall approval flag.
`useVibe64Integrations` stores it as the current payment result;
`PaymentConfigurationPanel` renders the check statuses and explanations. A new
readiness report replaces a catalogue review, so publication requires previewing
again. Application-owned evidence and JSKIT/native composition are specified in
`packages/vibe64-source-editor/docs/application-integration-setup.md` and included in the payment setup draft.

Catalogue recovery uses the existing payment management command and owner/scope
checks. The parser requires a bounded pendingOperation display record for pending
reviews and validates payments-recover reviewId/providerId inputs. The payment
panel confirms merchant, environment, pending action and object ID. The app must
verify evidence and return a fresh review; the UI does not save provider mappings
itself. The public operation guide includes both JSKIT composition and native
Laravel requirements for this same recovery contract.

Payment management also works against a host-selected published release, while
its configuration stays read-only. The owner reviews its catalogue using that
release's environment; a release change discards previous reviews and results.

The application-command parser accepts a bounded `payments-history` page for an
explicit billing subject and collection. It rejects mismatched subject/environment,
extra fields, numeric monetary totals and oversized pages. App authorization and
customer mapping remain mandatory. The existing setup routes forward subject, collection and page cursor. The
payment panel uses the shared command owner to request history, hides results
when the selection changes and displays a skeleton while requesting a page.
The app remains the customer-data and authorization owner.

Billing-history load failures render inside the reserved results area, with
retry through the existing view action, rather than inserting an error above
the catalogue. Starting a new read clears old results; the selected account and
collection must match before any returned rows are displayed.

The dashboard section shell renders its content slot once at a stable location.
Compact navigation uses a Vuetify select over the same route links; changing
viewport width only replaces navigation controls, not the active form.

Payment configuration shows field-specific repair instructions for invalid
merchant bindings and missing Paddle token or tax category. The shared payment
validator supplies these errors; the editor does not duplicate provider validation.

Integration implementation drafts include the selected provider setup steps and
guide URL from the same definition used by the setup screen, including its
settings/authentication-specific variant. They do not copy secret values.

Stripe and Paddle payment-event/checkout steps are public provider metadata
(`paymentSetup`), consumed by both the payment form and implementation draft.
The editor does not maintain a separate copy of those instructions.

S3's provider metadata requires read access in both configuration validation and
the permission controls. Its inline instructions name the project's Env handoff,
Connect action, browser CORS setup and temporary-credential renewal. The editor
uses that shared metadata rather than defining AWS permissions itself.


Amplitude setup can register a new confidential OAuth client at its selected US
or EU authority. The workspace owner explicitly supplies the application callback
and permissions. The existing registration action saves the client secret,
callback and recovery ID in development Env before saving the public client ID
in project configuration, then starts the application’s connection command.
Existing Env values are preserved, and uncertain registration or local-save
failures require inspection before retrying. This does not attach Amplitude
tools to the editor’s coding assistant.

Atlassian uses the same explicit project OAuth registration operation as Amplitude.
Its button uses the fixed Rovo MCP v2 registration authority and selected product
permissions, then saves only references/client ID in configuration and credentials
in development Env. Owner, file-hash, unshared-registration and existing-Env checks
apply before a provider request. Ambiguous results require operator review before
retry. Manual registration remains available. No editor tool attachment is added.


Tally's app-owned runtime creates draft forms, reads and updates native blocks
and status, and reads paginated submissions as well as form metadata.
Verification only lists forms; reading answers is an explicit application action.
The app authorizes each form, joins questions and answers and owns retention or
import deduplication. Public Vibe64 continues to store only text/Env setup.


Telegram provides app-owned plain text sending, chat actions and explicit update
polling in addition to bot verification. Verification does not consume updates.
The app owns its bot, chat authorization, single polling worker, durable offset
and deduplication/recovery; neither public Vibe64 nor Online runs that worker.

Confidence Flags and Confidence Exp reuse the project OAuth registration action.
The owner registers against the fixed Confidence MCP authority; the client ID
is saved in configuration and the secret/callback/recovery ID in development
Env. Existing values and uncertain-registration safeguards remain enforced.
Consent and callback execution belong to the application; this does not attach
Confidence tools to the Vibe64 coding assistant.


Sanity's builder-context connector supports explicit OAuth client registration
and account consent in addition to API-token credentials. The existing registration
action uses Sanity's fixed MCP authority, saves credentials in development Env
and starts the application's setup command. Owner, source-hash, unshared-client
and existing-Env checks apply; uncertain results require inspection before retry. The public editor edits
the same app-owned client/secret/callback Env contract. No generated-app login or
central Vibe64 registration is introduced. Assistant attachment remains deferred;
the host must authorize project/dataset/tool arguments when explicitly wired.

Granola OAuth uses the same explicit project-owned client registration action.
It invokes the existing JSKIT Granola helper at its fixed authority, saves the
client ID to project configuration and secret/callback/recovery ID to development
Env, then starts the app-owned connection command. API-key mode remains separate.
Neither flow attaches Granola tools to Vibe64 coding assistants.
Granola scope choices are method-specific: API keys expose no OAuth identity
permissions; entering OAuth selects its recommended identity/refresh choices.
Shared configuration validation rejects OAuth-only permissions in API-key mode.

Hex uses the same explicit OAuth registration action, selecting its fixed
Standard/Europe/HIPAA authority from the saved endpoint settings. Returned secrets
use development Env and client IDs use project configuration; the generated host
owns consent, tool policy and execution. No notebook UI or coding-assistant
attachment is provided by registration.

HeyGen uses the same explicit project registration action at its fixed MCP
authority. API-key profile/voice reads expose no OAuth identity scopes. MCP
media tools consume the connected account plan; the app/host owns per-tool
approval, polling and rendering. Registration does not attach editor tools.

SharePoint uses its project grant for library/folder browsing, temporary file
download links, bounded uploads and scalar list-item edits. File transfer reuses
the OneDrive Graph implementation. List updates require ETags and surface conflicts;
site-collection creation, complex field editors and admin tooling remain excluded.

Teams now reads channels, messages/replies and existing chats and sends plain text
through the selected delegated grants. Inline guidance requires app approval and
separate read/send consent. Team/chat creation, membership administration, message
editing, attachments and meeting bots remain excluded.

Miro and n8n setup explicitly separate a configured MCP connection from deferred automatic coding-chat attachment. Existing project-owned MCP calls can return authorized board or workflow results to a wired host; no embedded board/workflow designer is provided.

Notion Application data setup describes page/block reads, data-source queries and bounded page/property/block writes, with separate Read/Insert/Update content capabilities and page sharing. Hosted MCP remains a distinct credential family; automatic editor attachment is deferred. JSKIT runtime and native-framework composition use project-owned configuration and Env.

Oura setup includes optional heart-rate permission alongside per-user daily data. Sleep/readiness/activity and separately consented heart-rate operations use explicit pagination; the application owns charts and synchronization. No health-data gateway is introduced.

Perplexity setup points to the app-owned native-client answer/stream recipe using the existing saved slot and private Env reference. Vibe64 edits configuration; the application authorizes requests, owns the SDK/rendering/budgets and pays the provider directly. No inference gateway or second credential copy is added.

Pipedrive supports ordinary CRM record reads and basic create/update operations. API-token users supply the company subdomain; OAuth always uses its consent-bound company address. Setup explains registration-side CRM permissions and separate app authorization. Pipeline administration and a full CRM dashboard are outside this connector.

Replicate setup explains model API inputs, explicit paid prediction submission, polling/cancellation and output retention. The project owns the token in Env, job ownership and media presentation; the editor does not execute models or provide a media studio.

Resend setup explains Full-access key storage in project Env, DNS-verified senders, opted-in contact segments, HTML unsubscribe links and draft review before explicit broadcast sending. The generated app owns contacts, templates, recipient authorization and delivery UI; public Vibe64 provides configuration, not a shared mail service. Transactional recovery composition retains its application-owned idempotency key.

The Integrations catalog groups available services by editor-owned categories,
with counts and collapsible groups. Search matches service names, descriptions
and category titles, exposes matching groups and omits empty ones. Clearing search
restores the person's expanded groups. Configured entries remain separate and
searchable in Development and Production. Vendor icons are bundled locally and
shared by available services, configured entries and the selected detail. Their
sources are recorded alongside the assets; no third-party logo request is made
while browsing. The generic AI integration represents several vendors and uses
an AI symbol. Unknown future providers remain available under Other services.

Presentation sources: `src/lib/integrationCatalogue.js`,
`src/components/studio/IntegrationServiceLogo.vue`, and
`src/components/studio/IntegrationsPanel.vue`.
