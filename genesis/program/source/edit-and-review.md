# Source editing and change review

People can inspect and make focused source changes, see every file that differs
from saved project work, and inspect one exact file change at a time.

## Sources

- `src/components/studio/IntegrationsPanel.vue`
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

Integrations is a typed form over the selected session's `integrations.json`.
JSKIT owns configuration validation and provider field components. Vibe64 uses
the existing source path policy and agent-write lock, validates before writing,
requires the previously read file hash for replacement, and creates a missing
file exclusively. Creates and saves publish the ordinary source-file event.
The catalogue supplies forms for Google Calendar, Gmail, Drive, Sheets, Docs,
Slides, Search Console, Resend, Firecrawl, Airtable, Notion, Brevo, ElevenLabs,
GitHub API, Apify, Calendly, HubSpot, Linear, Pipedrive, GitLab API, Tally,
Contentful, Asana, Stripe, Replicate, Sentry, incident.io, Fireflies,
HeyGen, Perplexity, Supabase, Google Analytics, BigQuery, Paddle, Mailgun,
Fireworks AI, GatewayAPI, Polar, Storyblok, Oura, Twitch, Slack, Algolia, Twilio, Gong, PostHog,
Chargebee, Ashby, Lexware, Sevdesk, Apollo.io, Attention, Clay, Telegram, KLIPY, Mapbox,
Logo.dev, Google Maps Platform, WooCommerce, PrestaShop, ClickHouse, WordPress (self-hosted), WordPress.com,
n8n, Sanity, Inngest, Amplitude, Atlassian, Canva, Figma, Miro, AWS S3, AWS Athena, Amazon Redshift, Xero, Semrush,
Microsoft Outlook, OneDrive, Excel, Teams, OneNote, Word, PowerPoint and
SharePoint, and preserves other provider records and application extensions.
Microsoft forms identify delegated permissions and account types. The Directory
(tenant) ID field accepts an applicable audience keyword or a directory GUID;
the same setting selects runtime authorization and refresh endpoints. Changing
it requires reconnecting existing grants. Word and PowerPoint browse matching
files and folders and read file metadata, with no document editing or download
in these initial adapters. Excel identifies its required file write permission. New integrations
use the provider's first declared account mode; Oura exposes only individual
user accounts and defaults to daily-summary permission, with optional personal
profile and email permissions.
Twitch retains 23 permission choices and defaults to email/profile and followed
channel reads. Its application-specific Client ID, secret reference, callback
reference and ownership mode use the same file. Other permissions can be saved
without claiming that their operations are implemented. The runtime validates
Twitch tokens before data reads; startup and hourly validation of maintained
idle connections remains an explicit application responsibility.
Slack selects a connected user or an installed bot independently of application
ownership. Its form shows 52 user or 49 bot permissions from 57 distinct choices;
changing identity preserves compatible selections and removes incompatible ones.
The same parser rejects incompatible scopes in CLI configuration. Identity,
registration references and remaining permissions survive saving and reloading.
An individually owned bot connection still acts as a workspace bot, not a person.
The initial runtime lists conversations and checks identity; other saved scopes
do not imply implemented message operations or application login.
AWS S3 and Athena expose the same 18-region selector and explicit access-key ID,
secret-key and optional session-token references. S3 adds a bucket and local
read/write operation limits; the form explains that AWS policies decide actual
access. Athena adds a workgroup (default primary) and optional result location.
Clearing optional references removes them from the file. Both use signed backend
requests, without OAuth callbacks or a fallback to host credentials. S3 checks
listing before connection and can construct temporary GET/PUT URLs; Athena
checks workgroup metadata and exposes separate query lifecycle operations.
Saving fields does not contact AWS, issue a URL or run SQL. Managed AWS account
assignments, IAM provisioning and STS renewal remain host work.
Redshift selects its shared settings schema from the deployment type. Serverless
requires a workgroup name; provisioned requires a cluster identifier and accepts
an optional database user. Switching type removes inactive fields while retaining
the database, region and credential references; CLI mixed-mode fields are rejected
by the same schema. Its region selector has 34 choices, subject to AWS availability.
The shared-account runtime checks table metadata and offers explicit query start,
status, results and cancellation operations. It checks statement targets before
returning results or cancelling; application authorization still owns each query.
Saving does not execute SQL. Per-user Identity Center federation remains unfinished.
Xero exposes 24 permission choices with read-only defaults. New registrations
automatically select HTTP Basic client authentication while retaining ordinary
Client ID, secret-reference and callback-reference fields. The shared runtime
discovers tenant connections, checks organisation access before accounting reads,
and offers organisation metadata, contacts and invoice summary pages. The host
still authorizes which organisation each caller may use; data access does not
implement application login or managed registration assignment.
Semrush identifies its V4 API-key reference and supports shared or assistant
ownership. It exposes no OAuth fields for this key flow. The runtime reads
project pages and individual project metadata with validated IDs and provider
errors; captured OAuth permissions and managed account allocation remain unfinished.
OAuth forms edit app registrations and
permissions; API-key forms edit the credential reference. Reference fields reject
pasted HTTP/HTTPS URLs while preserving named environment and custom bindings.
Paddle exposes its
sandbox/live environment, Mailgun its US/EU API region, GatewayAPI its Global/EU
platform, Polar its sandbox/production environment, and Storyblok its five
space regions. Algolia adds a validated application ID and a separate optional
frontend key reference; clearing that optional field removes it from the saved
file. Its primary API-key reference remains for backend access. Twilio provides
US1, IE1 and AU1 region choices, validates separate Account and API Key SIDs,
and labels its primary credential as an API key secret reference. Gong provides
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
Mapbox edits a backend token reference and a separate optional public browser
token reference. Removing the optional value removes it from source. Backend
verification does not verify that browser token. Google Maps Platform similarly
edits separate server and optional browser key references. Its guidance explains
that runtime verification needs an explicit address and can incur geocoding usage.
Logo.dev edits a publishable
key reference; its browser library constructs public image URLs, with delivery
reported by image load/error events. It does not create a server connection grant.
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
and actual permissions. This is a provider-data connection, not app login.
n8n and Sanity use assistant-only MCP token configurations. n8n validates its
HTTPS server endpoint, including any installation path; Sanity uses a fixed
hosted endpoint. Both save token references and expose setup instructions.
Saving does not attach tools to an assistant or authorize a tool call. The
shared runtime passes tool names and arguments to the assistant host's policy.
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
and bringing the pane into view on compact screens. A ready source opens the
tool; settled missing or failed detail uses the normal environment fallback.
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
