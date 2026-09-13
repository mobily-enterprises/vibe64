# Laravel application payments: ownership and implementation guide

This is guidance for an application's coding agent. It is not a PHP package in
JSKIT and does not change Vibe64's own technology selection. PHP source,
Composer dependencies, routes, migrations and tests belong to the Laravel app.
Vibe64 edits the portable declaration and invokes the app's explicit command;
ordinary Artisan and HTTP use must work without an editor.

## Inputs and durable owners

Read `integrations.json` from the application source. Interpret
`extensions.payments` against the static draft-07 schema published with
`@jskit-ai/payments-core` and its `docs/contract.md`. These are documents, not a
Node runtime requirement. Obtain the schema as static project documentation;
do not invoke JavaScript merely to parse or validate JSON. Preserve unrelated
integration extensions. Reuse the project's existing PHP JSON Schema validator
if available, or implement the declared constraints through its validation owner.
Do not invent a second authoritative plan file or copy plans into configuration
that the editor can no longer update.

- Source owns logical plans, minor-unit amounts, currencies, monthly/yearly
  recurrence, feature names, renewal credits and merchant/Env references.
- The app's environment owns private keys and webhook signing secrets. Paddle's
  public client token is the only payment credential intended for the browser.
- The app's database owns customer mappings, subscriptions, processed business
  references, credit allocations and published product/price mappings.
- The app's authentication and authorization own the billable subject. Choose
  the existing workspace/organization model when billing is shared by its
  tenants; do not silently attach shared billing to the current user's model.

Choose a durable application identity and explicitly select `sandbox` or `live`
on the backend. Never infer the merchant, subject, currency, amount or provider
price from a browser's assertion. A domain is not an application identity.

## Use the existing Laravel billing owner

Inspect the application's Laravel version, Composer lock and existing billing
implementation before adding anything. Laravel documents maintained Cashier
integrations for both providers: [Cashier Stripe](https://laravel.com/docs/13.x/billing)
and [Cashier Paddle](https://laravel.com/docs/13.x/cashier-paddle). Use the docs
matching the app's actual versions; the linked versions are reference material,
not an instruction to upgrade the application.

For an app that already uses Cashier, extend that owner for provider customers,
checkout, portal and verified webhooks. Do not run two independent webhook
controllers that both update the same subscription or grant the same allowance.
If the app needs both providers, review each package's model/table/configuration
ownership before composing them; do not assume the packages can be installed
unchanged on one billable model. Keep provider-specific clients scoped to the
selected merchant and environment instead of changing a global client during a
request served by a long-lived worker.

Cashier is a useful provider integration, not an implementation of this entire
payment contract. Reviewed catalogue publication, app feature policy and the
usage-credit ledger remain explicit application work. The app can reuse native
framework/client facilities while implementing those domain operations itself.

## Configuration and cached deployments

Read the declared Env references while constructing Laravel configuration, then
use the resulting configuration in services and commands. Laravel warns that
cached configuration changes how `.env` and `env()` behave; calling `env()`
arbitrarily inside controllers will not reliably read a cached deployment's
values. Follow [Laravel configuration caching](https://laravel.com/docs/13.x/configuration#configuration-caching).

Rebuild the app's cached configuration and restart affected long-lived workers
through its existing deployment mechanism when the payment declaration or Env
changes. Configuration reads must not create provider objects. Validate missing,
blank and `MISSING` bindings as setup errors without logging their values.
Expose only a deliberately constructed public checkout configuration; never
return the entire parsed configuration or process environment.

## Checkout, portal and verified events

For Stripe, use the app's server-side subscription Checkout and customer portal
integration. Derive the customer from an immutable application customer binding;
select the published price for the logical plan and environment. Keep retries
bound to a stable app request ID. Follow the installed Cashier version's
supported Stripe API/webhook version, not the version chosen for a Node app.
[Stripe-specific Cashier setup](https://laravel.com/docs/13.x/billing#configuration).

For Paddle, initialize the app-owned checkout page with its public client token
and matching sandbox/live selection. Keep its API key and signing secret on the
backend. The provider account and checkout domain must be approved for live use;
listing products does not establish that approval. Use the app's customer portal
integration for self-service billing. [Paddle Cashier configuration](https://laravel.com/docs/13.x/cashier-paddle#configuration).

Implement the project's advertised `/integrations/<integrationId>/webhook`
route through its existing verified webhook owner, or explicitly change the
advertised URL and provider destination together. Do not merely display an
unimplemented suggested route. Preserve raw request bytes for signature
verification, narrowly configure any necessary CSRF exception, and retain the
framework/provider verification middleware. Use the installed library's actual
supported customization API; do not add a redirect from a webhook endpoint and
assume providers will follow it safely.

A verified event is an input to reconciliation, not unrestricted authorization
from its metadata. Resolve its customer through the merchant/environment-bound
application mapping. Under the subject's transaction, load current provider
subscription facts, validate the supported price/quantity shape, update state
and record the receipt. If a provider read or transaction fails, leave the event
retryable. Duplicate and older deliveries must not resurrect canceled access or
award a second allowance. A success-page redirect never grants access.

## Feature and credit policy

Match the portable contract deliberately instead of relying on a framework's
broader `subscribed` convenience predicate. The initial JSKIT contract grants
features only for a known plan with active status and an unexpired period. It
does not implicitly grant trial or grace-period access. If the product needs a
different policy, change the shared contract and both implementations explicitly.

For the initial recurring-plan policy:

1. Award the plan's renewal credits once per paid invoice/transaction reference.
   A second delivery ID for the same renewal must not award them again.
2. Credits expire at that paid period's end. Debit allocations with the nearest
   expiry first, inside a transaction that prevents concurrent overspending.
3. Store a unique business-operation reference and its requested units. A retry
   with the same inputs returns its prior result; different inputs conflict.
4. Refund a failed application's debit at most once. Restore only allocations
   that have not expired; report expired units separately.
5. Keep monetary refunds and credit refunds distinct. Do not invent automatic
   chargeback/monetary-refund clawbacks; those policies are not yet implemented
   in the initial shared runtime.

Use native application migrations, transactions and unique constraints. Test
locking with the selected database; an in-memory fixture alone does not prove
concurrent production behavior. Scope records by application, integration,
merchant, payment environment and billable subject. Keep event and grant/debit
identities scoped too. Do not put this runtime state into the editor database.

## Catalogue and the editor command

Implement the JSON request/response contract in
[application integration setup](application-integration-setup.md#payment-catalogue-operations)
using a native Artisan command. The command owns input validation and app
composition; the editor supplies only the selected operation, integration,
payment environment and preceding review ID. It is an administrator executable,
not a new publicly callable HTTP endpoint.

Preview compares source plans, durable provider mappings and current provider
facts. Return create-product, rename-product and create-price proposals. Flag
dashboard drift rather than overwriting it. Keep sandbox and live mappings
separate. Preserve old prices for existing subscriptions and explicitly report
removed logical plans.

Publish rechecks the review. Before each remote mutation, persist a pending
operation in the app database; after a known success, store its mapping and clear
the intent. A crash or timeout must leave recoverable uncertainty. Do not add an
automatic retry that could duplicate Paddle objects. An authorized app CLI can
inspect the provider and reconcile the pending result without Vibe64. Keep the
editor's 30-second command bound and 32-KiB response bound visible when a larger
catalogue cannot complete in one operation.

## Required native acceptance cases

- [ ] Hand-written JSON produces the same plans as editor-written JSON.
- [ ] Configuration cache and worker restart preserve the selected Env bindings.
- [ ] Non-members cannot access another subject's checkout, portal or credits.
- [ ] Raw signature mutation, expired delivery and wrong environment are rejected.
- [ ] Duplicate renewal deliveries grant once; old events cannot restore access.
- [ ] Concurrent debit requests cannot overspend; expired refunds stay expired.
- [ ] Preview is read-only; publish rejects a stale review and preserves partial work.
- [ ] No stdout/HTTP response includes backend credentials or pending-operation secrets.
- [ ] Artisan and ordinary app HTTP routes work with no editor service available.

These are implementation requirements, not results already established for a
Laravel app. Current evidence is limited to JSKIT/package and controlled public
editor fixtures. A real Laravel composition and live-provider acceptance have
not been run in this detour.
