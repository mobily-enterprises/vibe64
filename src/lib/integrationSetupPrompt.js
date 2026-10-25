import googleAdsSearchGuide from "@local/vibe64-source-editor/docs/application-google-ads.md?raw";
import integrationSetupGuide from "@local/vibe64-source-editor/docs/application-integration-setup.md?raw";
import laravelPaymentsGuide from "@local/vibe64-source-editor/docs/application-payments-laravel.md?raw";
import paymentSchema from "@jskit-ai/payments-core/configuration.schema.json";
import paymentConformance from "@jskit-ai/payments-core/conformance.json";
import paymentContract from "@jskit-ai/payments-core/docs/contract.md?raw";
import paymentConformanceGuide from "@jskit-ai/payments-core/docs/conformance.md?raw";

// The implementation prompt an AI session receives for one saved integration.
function integrationSetupPrompt({ id, integration, provider, configuration, configurationOnly }) {
  return [
    `Implement the saved integration ${JSON.stringify(id)} (${JSON.stringify(integration?.provider)}) from integrations.json.`,
    "Use this project's selected framework and existing backend composition. Keep credentials, connections, callbacks and refresh owned by this application so it runs independently of Vibe64.",
    ...(provider?.setup ? [
      `Selected provider setup instructions:\n\n${(provider.setup.stepsForSettings?.(integration?.settings || {}, integration?.authentication.method) || provider.setup.stepsByAuthentication?.[integration?.authentication.method] || provider.setup.steps || []).join("\n\n")}`,
      `Provider setup guide: ${provider.setup.urlForSettings?.(integration?.settings || {}, integration?.authentication.method) || provider.setup.urlByAuthentication?.[integration?.authentication.method] || provider.setup.url}`
    ] : []),
    configurationOnly
      ? "Use the saved public settings to implement this integration through the selected framework. Do not create a connection command, OAuth flow or provider verification request. For Analytics, preserve existing tag-manager and consent behavior, avoid duplicate tags, and do not send test tracking events."
      : integration?.accountMode === "per-user"
      ? "Implement connection settings inside this application's authenticated user account screen: status, connect, reconnect, cancel and disconnect. Derive each connection owner from the authenticated app user, isolate their grants, and bind OAuth callbacks to the initiating user. This configures individual accounts, not a shared administrator connection or a new application login method."
      : "Implement the Integration setup command using the documented application-owned contract, with safe status, connect, cancel and disconnect results.",
    ...(['stripe', 'paddle'].includes(integration?.provider) && configuration?.extensions?.payments ? [
      `Selected provider payment setup:\n\n${provider.paymentSetup.steps.join("\n\n")}\n\n${provider.paymentSetup.url}`,
      "Implement the saved extensions.payments contract as well as credential verification. Use the selected framework's existing billing owner; do not add a parallel billing system. Plans and Env references stay in integrations.json; customers, subscriptions, credits and catalogue mappings stay in this application's database.",
      "Implement authenticated billing-account reads, checkout and customer portal routes, raw-byte signed provider webhooks, current-state subscription reconciliation, feature enforcement and transactional renewal credits. Derive the billable subject from authenticated app membership. A checkout redirect is not payment proof. Keep sandbox/live accounts, mappings and credentials isolated.",
      "Extend the existing Integration setup command with payments-preview, payments-publish, payments-readiness, payments-recover and payments-history using the documented vibe64.integration-setup.command.v1 payment contract. Preserve other operations. Read the public application-integration-setup.md contract: paymentEnvironment and reviewed reviewId inputs; bounded payments results with providerAccountId, changes, drift, removed and pending. Preview must be read-only; publish must revalidate the review and retain partial-write recovery and historical price mappings.",
      "For JSKIT, compose payments-core and the optional payments-web component using normal app routes, storage and HTTP hooks. For Laravel, follow application-payments-laravel.md and the same portable configuration/operation semantics using native framework libraries. Do not add PHP to JSKIT or require Node payment execution from Laravel. Neither implementation may call Vibe64 to authorize customer billing.",
      integration?.provider === 'paddle'
        ? "Paddle needs a separate public client-side token and an app-owned Paddle.js checkout page; keep the private API key and signing secret server-side. Domain and merchant approval remain explicit provider steps."
        : "Stripe needs the environment's own webhook destination/signing secret and configured customer portal. Handle invoice payment failures and subscription lifecycle updates without granting unpaid renewal credits.",
      "Expose the app billing screen with plans, credits, subscription status, customer-scoped subscription/invoice/transaction history and management actions. Authorize history separately, resolve the customer from this app's subject binding and preserve provider status; invoice/transaction totals are not proof of payment. Use controlled fixtures for authorization, webhook signatures, retries, plan/credit behavior and management output; report unimplemented capabilities honestly. Do not apply catalogue changes to the provider or perform charges during implementation.",
      `Portable payment semantics (applies to every framework):\n\n${paymentContract}`,
      `Payment configuration JSON Schema (validate extensions.payments; no JSKIT runtime required):\n\n${JSON.stringify(paymentSchema, null, 2)}`,
      `Portable conformance instructions:\n\n${paymentConformanceGuide}`,
      `Portable conformance JSON (translate these fixtures into this framework's native tests; do not install a Node sidecar for another framework):\n\n${JSON.stringify(paymentConformance, null, 2)}`,
      `Public app-operation contract (apply its payment section as well as the command envelope):\n\n${integrationSetupGuide}`,
      `Native Laravel guidance (only when this project selects Laravel; other frameworks implement the same contract with their own libraries):\n\n${laravelPaymentsGuide}`
    ] : []),
    ...(integration?.provider === "google-ads" ? [googleAdsSearchGuide] : []),
    "Use the saved Env references without putting secret values in source or chat.",
    "Preserve the existing configuration and implement controlled tests. Do not register provider accounts, perform live consent, send real messages or deploy."
  ].join("\n\n");
}

export {
  integrationSetupPrompt
};
