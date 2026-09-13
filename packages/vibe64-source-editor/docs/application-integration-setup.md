# Application integration setup

## Request configuration from the conversation

In the main Vibe64 conversation, the assistant can end its reply with this exact
block after saving the integration in `integrations.json`:

````markdown
```vibe64-integration
{"integrationId":"gmail-business"}
```
````

Use the configured slot key, not the provider name. The only allowed field is
`integrationId`; do not include credentials, callback URLs or configuration.
Vibe64 renders a Configure card from the saved assistant message and opens that
session's development integration. A missing slot is reported in the panel.
Incomplete blocks, quoted examples and user messages do not become requests.

Configure opens settings. The person still explicitly configures Env and starts
the application's connection operation. Skip records a decision for that exact
saved request, requires normal assistant access and restores as Skipped after
reload. It does not disconnect the application account. Neither action
authorizes consent or marks connection setup complete. An application-reported
connected result with a verification time completes the exact associated request
on the server, provided its saved configuration still matches. Vibe64 then
continues the assistant using a persisted message identity. The card displays
completion separately from assistant delivery. Check continuation resumes a
pending delivery or inspects an uncertain delivery without blindly resending it.
Changing configuration before the first delivery requires a new setup request.
Reopening history restores the decision, not proof of a currently live connection.
Archived/inactive conversation views disable its actions. JSKIT and Laravel
applications do not parse this editor presentation format or return continuation
metadata; Vibe64 owns that association and delivery.

Vibe64 edits `integrations.json` and supplies administrator credentials through
project Env. The application owns provider registration, its callback routes,
account grants, refresh, storage and authorization. It must run independently
when supplied with its own source, Env and persistent state.

The same editor controls can invoke a Node application or a Laravel application.
Vibe64 does not infer a framework, implement its backend or supply an identity
for its users.

## Declare the application command

In the application's `genesis/stack.md`, declare exactly one command:

```markdown
## Integration setup

- Command with `nodejs` in `.`: `node` `scripts/integrations.js`
```

A Laravel application can instead declare the command it implements:

```markdown
## Integration setup

- Command with `php` in `.`: `php` `artisan` `integrations:setup`
```

These are examples of application-owned executables, not commands installed by
Vibe64. The selected runtime must be available on the host. Use `- Nothing.`
when the application has no setup command; the editor shows setup as missing.

## Request and response

The command reads one JSON request from stdin. For example:

```json
{"protocol":"vibe64.integration-setup.command.v1","requestId":"request-1","operation":"connect","integrationId":"calendar"}
```

Operations are `status`, `connect`, `cancel`, and `disconnect`. Cancellation
also supplies the exact `attemptId`. Connect may supply provider-specific
`verificationInput`, such as a resource ID needed for a read-only check. These
inputs must not supply an operator identity or raw credentials.
An operation-specific subject, such as PostHog's flag-evaluation user ID, is
check data only; it never selects the owner of the stored connection.
The editor renders provider-described verification fields before connect or
reconnect. Their values survive tab navigation by session and integration and
are sent only with Connect; they are not saved to source or Env. The application
must validate them before opening consent or making the verification request.

The command writes one JSON object to stdout, with the same protocol and
requestId. A completed check may return:

```json
{"protocol":"vibe64.integration-setup.command.v1","requestId":"request-1","status":"connected","grantedScopes":["requested-permission"],"verifiedAt":"2026-09-11T00:00:00.000Z"}
```

Connected accounts can explicitly run Connect again: the editor labels this
Reconnect for OAuth and Verify again for other credential methods. OAuth
replacement must preserve the existing grant until the new consent succeeds;
cancelling that attempt must leave the prior grant alone. API-key verification
uses the current Env value. A failed check must not advance `verifiedAt` or
claim a successful replacement. Retaining a previous verification record does
not restore an overwritten Env key or prove that the current key works.
After failed key-based re-verification of an existing connection, the editor
reads status again and retains the check error. Return `reconnect-required` when
the current binding differs from the successfully verified credential. This
status read must not perform another provider verification or advance its time.

A browser-consent operation returns immediately with:

```json
{"protocol":"vibe64.integration-setup.command.v1","requestId":"request-1","status":"pending","authorizationUrl":"https://provider.example/authorize?state=opaque-state","attemptId":"opaque-state","expiresAt":"2026-09-11T00:10:00.000Z"}
```

Persist the pending attempt in the application's private store. Status must
recover it after navigation or process restart. Other supported states are
`unconfigured`, `disconnected`, `reconnect-required`, and `cancelled`.
Disconnect reports `disconnected`; cancel reports `cancelled`, after which the
editor reads status again to retain any earlier working grant. The Disconnect
operation removes only the application's selected connection and pending attempts.
It does not revoke provider consent or keys, or delete configuration or Env.
Provider-side revocation is a separate action in the provider's account settings
and may affect other apps using the same registration or key. Safe status may
include `callbackUrl`, resolved and validated by the application from its current
bindings. The editor displays it as Configured callback URL with its own Copy
action, separately from the suggested default. Do not echo an unvalidated Env
value. Callback URLs must have no credentials, query or fragment; use HTTPS
except for local development loopback addresses. Times use ISO strings.

Connected or reconnect-required status may include `accountLabel`, a nonblank
string of at most 256 characters without control or formatting characters. The
application obtains it from verified provider account data. The editor displays
it as Connected account using escaped text. Omit it when the provider cannot
identify the account reliably, and after disconnection. It is display metadata,
not the application's login identity or an authorization input.

Do not return extra fields, tokens, private PKCE verifiers, provider response
bodies or credential values. Input and output are bounded at 32 KiB and the
command at 30 seconds. Exit nonzero on failure and close application resources.
The editor does not render failed command output as an account result.

## Framework ownership

For JSKIT applications, use `createConnectionService()` and the app's selected
store/reference resolver. Its `resumeAuthorization()` returns a surviving
pending attempt; the app maps runtime values into the protocol above. The
`@jskit-ai/connectors-core` setup-command guide provides a dispatch example.
JSKIT remains an optional JavaScript dependency.

For Laravel, implement the declared console command in that application and
bootstrap its normal application services. Read the same text configuration;
resolve administrator credentials through its normal environment/configuration
system. Use its chosen OAuth/API client and private persistence implementation.
The command and HTTP callback must share the same storage and application identity.
A Laravel app does not install JSKIT or import JavaScript runtime code. The
protocol above is the common contract, not a supplied PHP implementation.

The application command maps the same operations in either framework:

| Input operation | JSKIT application composition | Laravel application composition | Required output |
| --- | --- | --- | --- |
| `status` | `resumeAuthorization()` then `status()` when no attempt survives | Read the app's private pending attempt or connection record; validate current bindings | Pending consent metadata or safe account status; never start consent |
| `connect` with OAuth consent | `beginAuthorization()` | Use the app's OAuth client to create a persisted, expiring authorization attempt | `pending`, with the authorization URL and attempt identity; return without waiting for the browser |
| `connect` with API key | `connectApiKey()` | Resolve the current credential through app configuration and perform the provider's documented verification | `connected` and verification time only after success; preserve the previous record on failure |
| `cancel` | `cancelAuthorization()` | Consume the exact pending attempt for the authorized connection | `cancelled`; preserve an earlier working grant |
| `disconnect` | `disconnect()` | Remove the selected app-owned grant and pending attempts | `disconnected`; retain source configuration and Env |

The HTTP callback belongs to the same application services as the command. It
validates the initiating identity and one-time state, exchanges the authorization
code, verifies granted access, and commits the new grant only on success. The
next `status` reads that result. In JSKIT this is `completeAuthorization()`;
Laravel uses its own OAuth client and persistence. Neither callback returns
tokens to Vibe64. Client-credential and service-account providers have no browser
consent step: their Connect implementation obtains and verifies credentials
server-side and returns the same safe status contract.

For either framework, the command runs as an application-authorized setup
operator. It must check that operator's rights to the selected connection. An
editor user is not automatically an application user. Individual users connect
through the application's own authenticated account screens, never through a
shared administrator connection. Scope state by application, environment,
integration and the app's chosen account owner.

The editor's Prepare app user connection request action adds a reviewed draft
asking the chosen framework to implement that account screen. It does not run
the shared setup command or send the draft automatically. In Laravel, use the
application's existing authenticated controllers, CSRF protection, OAuth client
and per-user persistence; in JSKIT, compose the connection-service operations
described in its setup guide. Both must support status, reconnect, cancellation
and disconnect, preserve another user's grant, and reject a callback presented
under the wrong user. Account linking remains separate from application login.

## Callback and Env

Use the actual assigned application origin as the initial callback suggestion,
for example `https://sas-dogandgroom.hosting.vibe64.dev`, plus the implemented
callback path. Google Calendar suggests `/integrations/google/callback`.
The public editor receives the origin from its host; it never constructs it from
the dashboard address or project slug. Without an assigned origin, enter the
application's address explicitly.

Register the exact callback URL with the provider and save it under the Env name
referenced by `callbackUrlRef`. The editor's Set callback in Env action prefills
an editable form and never saves automatically. Existing keys require an explicit
replacement. The backend must actually implement the route; Env alone creates
no endpoint.

For a saved `clientSecretRef` or authentication `secretRef`, Set credential in
Env opens the matching key with a blank masked secret field. Enter and save the
credential there. The navigation URL contains only the key name and the secret
field selection; it never carries the credential. Updating a value does not
itself verify provider access: return to Integrations and use the application's
connection operation. Individual users' tokens still belong in the app's private
runtime store, not a shared Env value.

The callback must validate state and bind it to the initiating application
identity, use PKCE where supported, consume the attempt once, and keep tokens in
the application's private store. A domain change updates the provider's allowed
redirect URI and the app's callback Env value without inventing a new user identity.
Do not overwrite existing callback values merely because a host URL changed.
Check the connection after saving the new callback and reconnect if required by
the provider. Existing app-user identities must remain unchanged.

## Current editor boundary

The implemented editor setup command uses the selected session and development
Env. Production execution must use deployed code and production state and is not
yet implemented by this route. Do not interpret a development Connected result
as proof that production is ready. Provider approval, real consent, deployed
callback reachability and exported-app behavior require their own evidence.


## Incomplete application settings

An implemented command may return `status: "unconfigured"` with `setupIssue`
set to `credentials-missing` or `callback-invalid` for status/connect requests.
The editor displays its own fixed setup instructions for those codes. Omit raw
error text, Env values and provider responses. No other issue values are accepted.
A missing command has no issue code and remains a separate implementation task.
Cancellation and disconnect must still report their specified completion states;
never represent a failed disconnect as successful setup advice.

## Payment catalogue operations

Payment management extends this same application command. It does not introduce
an editor payment gateway. The app owns the provider client, credentials,
merchant mapping and transactional publication state. The editor owns the
request/response contract below and requires workspace-owner access for payment
management. When a host supplies production integrations, the same controls read
the published configuration without editing it and send the current `releaseId`
to that host. The host resolves the active published workspace and its release
Env under its publication lock, rejecting a stale release before execution. It
must not substitute the selected development session or caller-supplied paths.
`releaseId` is a host request field, not an application-command field: the app
receives the same payment operation envelope in either environment.

The payment environment (`sandbox`/`live`) is separate from the editor's
development/production source selection. Selecting production does not silently
select a live merchant, and a development workspace can explicitly target its
configured live merchant. Account/environment confirmation and reviewed-write
requirements apply in either source context. A changed release invalidates the
editor's displayed review; publication revalidates the provider/configuration
review in the application as well. Public source implements these controls;
production browser acceptance is separate from development fixture evidence.

Requests use `operation: "payments-preview"` or `"payments-publish"`, with
`integrationId` and `paymentEnvironment`. Publication additionally requires a
64-character lowercase hexadecimal `reviewId` from a previous preview. Do not
accept account IDs, prices, credentials, executable code or unreviewed provider
operations from the browser. A payment request cannot complete a chat connection
request or perform OAuth consent.

The application resolves the integration and merchant from the saved
`extensions.payments.environments[paymentEnvironment]`. Reject a mismatched
integration or missing environment. Preview is read-only. Publish rechecks the
review against current configuration/provider facts, performs the reviewed
changes, then returns a fresh preview. Never retry uncertain provider writes
blindly. The existing command timeout remains bounded; larger publications may
stop after partial progress and require app-owned inspection/recovery.

A successful response has exactly these fields:

```json
{
  "protocol": "vibe64.integration-setup.command.v1",
  "requestId": "echo-the-request-id",
  "status": "payments",
  "paymentEnvironment": "sandbox",
  "providerAccountId": "acct_example",
  "review": {
    "reviewId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "changes": [{"action":"create-price","planId":"pro","amount":1200,"currency":"USD","interval":"month"}],
    "drift": [],
    "removed": [],
    "pending": false
  }
}
```

The review ID shown above is illustrative, not an accepted default. `changes`
contains up to 200 entries. `create-product`/`rename-product` entries contain
`action`, `planId`, `name`; `create-price` entries contain `action`, `planId`,
`amount`, `currency`, `interval`. Amounts are positive integer minor units;
interval is `month` or `year`. No provider object IDs or secret values belong in
change display rows. `drift` contains up to 200 `{planId, reason}` entries;
`removed` contains up to 100 plan IDs; `pending` is a boolean, not the saved
provider request. The entire stdout response remains limited to 32 KiB.

The editor checks request identity, payment environment and saved merchant ID.
It displays drift, removed plans and incomplete requests, and disables publish
when drift or a pending request exists. Publishing requires a separate
confirmation naming the merchant and environment. Changing source, selection or
session invalidates the displayed review. A missing application command is
shown as implementation required; no framework is inferred from files.

### Payment command authority

On an authenticated host, the editor restricts these commands to the workspace
owner before preparing project Env or executing application code. Standalone
local use relies on the operator's access to that editor and application. The
command receives a validated selection, not the editor user's identity. There is no
`actor`, `role`, access token or administrator flag in the JSON request.

The application's command is a local administrator executable. Its authority
comes from the operator/host's permission to execute it with that application's
private Env and storage. Keep it separate from public web routes. In a JSKIT
composition, construct any administrator principal inside this trusted command
entry point, and supply the application's authorization policy to the checkout
service. For `history`, that policy must explicitly allow this administrator to
inspect the selected billable subject. Resolve the provider customer from app
storage; a typed subject or customer ID is never proof of permission.

An ordinary CLI operator with equivalent application access can invoke the same
command or libraries without Vibe64. A remote HTTP wrapper needs its own explicit
administrator authentication and authorization; copying command handling into a
public route does not carry the command's local authority with it. Customer
checkout, portal and account routes instead derive the actor from the app's
session and check access to its billable subject. They must never construct the
command's administrator principal from request fields.

Other technologies implement this same separation using their native command,
authentication and policy mechanisms. No Vibe64 identity system, shared payment
account or JavaScript runtime is required by their application.

### JSKIT application entry point

Use the application's existing server composition to load its payment
configuration, database and adapter. `@jskit-ai/payments-core/server/catalogue`
provides `createPaymentCatalogue`; it has no knowledge of this editor protocol.
The app's thin command translates the result:

```js
// request has already passed the app command's input validation.
// catalogue is composed for the server-validated integration and environment.
if (request.operation === 'payments-publish') {
  await catalogue.publish({ reviewId: request.reviewId });
}
if (request.operation === 'payments-recover') {
  await catalogue.recover({ reviewId: request.reviewId, providerId: request.providerId });
}
const preview = await catalogue.preview();
const displayOperation = ({ action, planId, name, amount, currency, interval }) =>
  action === 'create-price'
    ? { action, planId, amount, currency, interval }
    : { action, planId, name };
const changes = preview.changes.map(displayOperation);
process.stdout.write(JSON.stringify({
  protocol: request.protocol,
  requestId: request.requestId,
  status: 'payments',
  paymentEnvironment: preview.environment,
  providerAccountId: preview.providerAccountId,
  review: {
    reviewId: preview.reviewId, changes, drift: preview.drift,
    removed: preview.removed, pending: Boolean(preview.pending),
    ...(preview.pending ? { pendingOperation: displayOperation(preview.pending) } : {})
  }
}) + '\n');
```

Only enter this branch for `payments-preview`, `payments-publish` or
`payments-recover`. Keep stdout
for the protocol response. The executable is an administrator operation, not a
public HTTP endpoint. Other callers must pass the app's own authorization. A
standalone CLI can invoke the same catalogue library without this protocol or
any editor.

### Laravel application entry point

Keep PHP in the Laravel application. Its native command reads the same JSON
payment declaration and Env references, authorizes the caller, uses its own
provider SDK/client and transactional database, and returns this exact JSON
shape. It owns the same reviewed-change, environment isolation and uncertain
write semantics. It does not invoke Node or import JSKIT. This protocol and the
portable payment schema describe the shared behavior; see [Laravel implementation guidance](application-payments-laravel.md) for the
native ownership and acceptance requirements. Laravel runtime conformance
remains unproven.

## Payment readiness report

The same command also accepts `payments-readiness`. Its input has the normal
`protocol`, `requestId`, `integrationId`, `operation` and explicit
`paymentEnvironment`; it must not contain `reviewId`, credentials or app-user
identity. It is an authorized editor-management inspection, never a browser
checkout route. It is read-only and must not publish products, change provider
settings, create a checkout, charge a customer or approve a merchant.

Return the same request identity with `status: "payments-readiness"`, the selected
`paymentEnvironment`, the configured `providerAccountId`, and `checks`. Include
exactly one check for each ID: `credentials`, `account`, `charges`, `payouts`,
`catalogue`, `webhook`, `checkout`, `site`, `deployment`. Each check contains only
`id`, `status` and `detail`. Status is `passed`, `failed`, `unknown` or `manual`;
detail is nonempty plain text, at most 500 characters, without control characters.
There is deliberately no overall `ready` or `approved` flag. All existing 32 KiB,
30-second, Env, merchant-binding and source-change protections apply.

In a JSKIT app, explicitly compose `createPaymentReadiness` from
`@jskit-ai/payments-core/server/readiness` with the selected `adapter`, `catalogue`
and merchant `scope`. Optionally supply `inspectApplication`, an app-owned
read-only function returning evidence for `webhook`, `checkout`, `site` and
`deployment`, using the same status/detail shape. Missing or unavailable evidence
remains unknown/manual. It must never infer deployment identity from an editor
URL or consider successful API-key verification proof of website approval.

```js
if (request.operation === 'payments-readiness') {
  const report = await readiness.inspect();
  process.stdout.write(JSON.stringify({
    protocol: request.protocol, requestId: request.requestId,
    status: 'payments-readiness', ...report
  }));
  return;
}
```

Handle this branch before catalogue preview/publication in the earlier example.
The host already restricts payment management to project owners; an app exposing
these services through another entry point must authorize that entry point too.
Do not echo provider exception text or Env values as details. Checks describe
observed facts at inspection time, not promises of future availability. Reports
are not persisted approvals and must be refreshed after configuration or release
changes.

Laravel implements this exact JSON report with native service checks. It can use
provider facts for credential/merchant/payment/payout status and its own catalogue
comparison. It must not call JSKIT or execute Node to produce the report. Mark
checks requiring unavailable provider APIs or human review as manual, and missing
application proof as unknown. Do not fabricate success to populate every row.

## Reviewed catalogue recovery

For an unresolved catalogue write, `review.pending` is true and
`review.pendingOperation` is required. It has the same display shape as one
catalogue change: action, planId, and name for product operations; action, planId,
amount, currency and interval for price creation. Do not send tokens, raw pending
records or provider credentials. When pending is false, omit pendingOperation.

`payments-recover` accepts the selected integration/environment, the current
reviewId, and providerId: a product/price identifier of 1–200 letters, digits,
underscores or hyphens. The editor shows the pending operation, asks the owner to
copy the matching provider object ID, then confirms the account, environment,
operation and ID before execution. The application revalidates the review and
reads the object from the selected provider account. It must match the operation;
a price must be active, match the product and have the reviewed amount/currency/
interval. Only then may the app save the mapping and clear the pending write.
Return a fresh catalogue preview using status payments. Do not create a provider
object during recovery and do not expose a browser-supplied “nothing was created”
flag. If the original write cannot be resolved, keep it pending and explain the
need for administrator investigation.

JSKIT `catalogue.recover` now requires reviewId for its trusted CLI calls too.
The optional confirmedNotCreated path remains a trusted administrator operation
requiring actual provider inspection evidence, outside this editor command.
Laravel must implement the same reviewed mapping recovery through its own native
catalogue service and transaction storage. No editor service is required by an
exported application's ordinary administrator CLI.

### Billing history command

`payments-history` is a read-only operation for one application-owned billable
subject. Requests include `paymentEnvironment`, `subjectId`, `collection`
(`subscriptions` or `transactions`) and optional `after` (null or a provider
page cursor containing 1–200 letters, digits, underscores or hyphens). No review
ID or provider customer ID is accepted. The application must authorize the
trusted command caller for this subject and resolve its stored customer binding;
a subject typed into the editor is a selection, not authorization.

Return `protocol`, `requestId`, `status: "payments-history"`,
`paymentEnvironment`, `providerAccountId`, the exact `subjectId` and `collection`,
`items` (at most 20) and `nextCursor` (null when complete). Each item has `id`,
`kind`, provider `status` and UTC ISO `createdAt` with milliseconds. Subscription
rows use kind `subscription`. Transaction rows use `invoice` for Stripe invoices
or `transaction` for Paddle transactions, plus uppercase `currency`, `totalMinor`
and `paidMinor`. Amounts are decimal integer strings of at most 30 digits or null
when unknown; do not convert them to floating-point numbers or infer payment
from a transaction total. Return no email, raw metadata, provider payload,
credential or arbitrary link. Unknown fields are rejected.

A JSKIT application can map this operation to its authorized checkout service's
`history({ actor, subjectId, collection, after })`, then wrap that page in the
command envelope. Other frameworks implement the same selection and projection
using their own provider library. Do not use an app-user identity implicitly
for editor administration. The editor exposes this read-only selection through the existing payment panel
and setup routes. Host forwarding carries only the subject, collection and
cursor; it does not accept a caller-supplied provider customer mapping.

## Amplitude client registration

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

Confidence Flags and Confidence Exp reuse the project OAuth registration action.
The owner registers against the fixed Confidence MCP authority; the client ID
is saved in configuration and the secret/callback/recovery ID in development
Env. Existing values and uncertain-registration safeguards remain enforced.
Consent and callback execution belong to the application; this does not attach
Confidence tools to the Vibe64 coding assistant.

## Google Ads Search management

The existing command also supports the bounded `ads-*` operations documented in
[Application-owned Google Ads Search](application-google-ads.md). Public Vibe64
provides preparation and explicit review controls; the app owns all Google calls,
OAuth credentials and billing-account authorization. Campaign creation is paused;
launch is a separate reviewed action. This path currently uses development Env.
