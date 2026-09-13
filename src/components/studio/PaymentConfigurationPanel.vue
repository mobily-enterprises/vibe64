<script setup>
import { computed, ref, watch } from "vue";
import { connectorDefinitions } from "@jskit-ai/connectors-catalog/shared";
import { validatePaymentConfiguration } from "@jskit-ai/payments-core/shared";
import { integrationCallbackUrl } from "@/lib/integrationCallbackUrl.js";

const props = defineProps({ modelValue: { type: Object, required: true }, integrationId: { type: String, required: true }, disabled: Boolean, applicationPublicUrl: String, management: Object, managementError: String, managementOperation: String, managementLoading: Boolean, managementDisabled: Boolean, canPrepare: Boolean });
const emit = defineEmits(["update:modelValue", "set-env", "manage", "prepare"]);
const paymentSetups = Object.fromEntries(connectorDefinitions.filter((provider) => provider.paymentSetup).map((provider) => [provider.id, provider.paymentSetup]));
const payments = computed(() => props.modelValue.extensions?.payments);
const planId = ref("");
const historySubject = ref("");
const historyCollection = ref("transactions");
const historySubjectError = computed(() => historySubject.value && (!historySubject.value.trim() || historySubject.value.length > 200 || /[\p{Cc}\p{Cf}]/u.test(historySubject.value)) ? "Enter a valid application billing account ID." : "");
const history = computed(() => props.management?.status === "payments-history" && props.management.subjectId === historySubject.value && props.management.collection === historyCollection.value ? props.management : null);
watch(() => props.integrationId, () => { historySubject.value = ""; historyCollection.value = "transactions"; });
const publishOpen = ref(false);
const recoveryOpen = ref(false);
const recoveryProviderId = ref("");
watch([() => props.management, () => props.managementDisabled, () => props.integrationId], () => { publishOpen.value = false; recoveryOpen.value = false; recoveryProviderId.value = ""; });
function publishCatalogue() {
  const result = props.management;
  if (props.managementDisabled || !result?.review || result.review.pending || result.review.drift.length) return;
  publishOpen.value = false;
  emit("manage", { operation: "payments-publish", paymentEnvironment: result.paymentEnvironment, reviewId: result.review.reviewId });
}
function recoverCatalogue() {
  const result = props.management;
  if (props.managementDisabled || !result?.review?.pending || !/^[A-Za-z0-9_-]{1,200}$/.test(recoveryProviderId.value)) return;
  recoveryOpen.value = false;
  emit("manage", { operation: "payments-recover", paymentEnvironment: result.paymentEnvironment,
    reviewId: result.review.reviewId, providerId: recoveryProviderId.value });
}
const planIdError = computed(() => !planId.value || (/^[a-z][a-z0-9-]{0,99}$/.test(planId.value) && !["constructor", "prototype"].includes(planId.value) && !Object.hasOwn(payments.value?.plans || {}, planId.value)) ? "" : "Use a new lowercase plan ID containing letters, numbers and hyphens.");
const validation = computed(() => {
  if (!payments.value) return [];
  try { validatePaymentConfiguration(props.modelValue); return []; }
  catch (error) { return error.fieldErrors || [{ path: "payments", message: error.message }]; }
});
const connections = computed(() => Object.entries(props.modelValue.integrations).filter(([, value]) => ["stripe", "paddle"].includes(value.provider) && value.accountMode === "shared" && value.authentication.method === "api-key").map(([value, slot]) => ({ value, title: `${slot.displayName || slot.provider} (${value})` })));
const errors = (path) => validation.value.filter((error) => error.path === `extensions.payments/${path}`).map((error) => error.message);
const webhookUrl = (integrationId) => integrationCallbackUrl(props.applicationPublicUrl, `/integrations/${integrationId}/webhook`);
const returnUrl = computed(() => integrationCallbackUrl(props.applicationPublicUrl, "/billing"));
function update(value) {
  if (!props.disabled) emit("update:modelValue", { ...props.modelValue, extensions: { ...props.modelValue.extensions, payments: value } });
}
function addEnvironment(environment) {
  const existing = payments.value || { version: 1, environments: {}, plans: {} };
  update({ ...existing, environments: { ...existing.environments, [environment]: {
    integrationId: props.integrationId, providerAccountId: "", webhookSecretRef: `env:PAYMENT_${environment.toUpperCase()}_WEBHOOK_SECRET`, returnUrlRef: `env:PAYMENT_${environment.toUpperCase()}_RETURN_URL`
  } } });
}
function binding(environment, field, value) {
  update({ ...payments.value, environments: { ...payments.value.environments, [environment]: { ...payments.value.environments[environment], [field]: value } } });
}
function plan(id, field, value) {
  update({ ...payments.value, plans: { ...payments.value.plans, [id]: { ...payments.value.plans[id], [field]: value } } });
}
function addPlan() {
  if (!planId.value || planIdError.value || !payments.value) return;
  update({ ...payments.value, plans: { ...payments.value.plans, [planId.value]: { name: "", amount: null, currency: "USD", interval: "month", features: [], renewalCredits: 0 } } });
  planId.value = "";
}
function setEnv(reference, value, secret) {
  const key = /^env:([A-Z_][A-Z0-9_]*)$/.exec(reference)?.[1];
  if (key) emit("set-env", { key, value, secret });
}
</script>

<template>
  <section aria-label="Application payments" class="mt-6">
    <h3 class="text-title-medium">Application payments</h3>
    <p class="mb-4">Define this project's recurring plans. Your application owns checkout, subscriptions, feature access and credits. Saving these settings does not charge anyone or publish products.</p>
    <v-btn v-for="environment in ['sandbox', 'live'].filter(value => !payments?.environments?.[value])" :key="environment" height="48" variant="outlined" class="mr-2 mb-4" :disabled="disabled" @click="addEnvironment(environment)">Configure {{ environment }} payments</v-btn>
    <template v-if="payments">
      <p v-if="validation.length" role="status">Complete the required payment fields before saving. {{ validation[0].message }}</p>
      <section v-for="(item, environment) in payments.environments" :key="environment" :aria-label="`${environment} payment account`" class="mb-6">
        <h4 class="text-title-small mb-3">{{ environment === 'live' ? 'Live account — real payments' : 'Sandbox account — test payments' }}</h4>
        <v-select :model-value="item.integrationId" :items="connections" label="Payment connection" :disabled="disabled" @update:model-value="binding(environment, 'integrationId', $event)" />
        <v-text-field :model-value="item.providerAccountId" label="Provider account identity" persistent-hint hint="Stripe: your acct_ account ID from account settings. Paddle: a stable identifier for this merchant account; catalogue access alone cannot verify its legal identity." :disabled="disabled" :error-messages="errors(`environments/${environment}/providerAccountId`)" @update:model-value="binding(environment, 'providerAccountId', $event)" />
        <v-select v-if="modelValue.integrations[item.integrationId]?.provider === 'paddle'" :model-value="item.taxCategory" :items="['digital-goods', 'ebooks', 'implementation-services', 'professional-services', 'saas', 'software-programming-services', 'standard', 'training-services', 'website-hosting']" label="Paddle product tax category" persistent-hint hint="Choose the category that accurately describes what your app sells." :error-messages="errors(`environments/${environment}/taxCategory`)" :disabled="disabled" @update:model-value="binding(environment, 'taxCategory', $event)" />
        <template v-if="modelValue.integrations[item.integrationId]?.provider === 'paddle'">
          <v-text-field :model-value="item.publicClientTokenRef" label="Paddle public client token Env reference" placeholder="env:PADDLE_CLIENT_TOKEN" persistent-hint hint="Public browser token for Paddle.js. Keep the private API key in the connection's separate secret Env variable." :disabled="disabled" :error-messages="errors(`environments/${environment}/publicClientTokenRef`)" @update:model-value="binding(environment, 'publicClientTokenRef', $event)" />
          <v-btn height="48" variant="text" :disabled="disabled || !/^env:[A-Z_][A-Z0-9_]*$/.test(item.publicClientTokenRef || '')" @click="setEnv(item.publicClientTokenRef, undefined, false)">Set public client token in Env</v-btn>
        </template>
        <v-text-field :model-value="item.webhookSecretRef" label="Webhook signing secret Env reference" placeholder="env:PAYMENT_WEBHOOK_SECRET" :disabled="disabled" :error-messages="errors(`environments/${environment}/webhookSecretRef`)" @update:model-value="binding(environment, 'webhookSecretRef', $event)" />
        <v-btn height="48" variant="text" :disabled="disabled || !/^env:[A-Z_][A-Z0-9_]*$/.test(item.webhookSecretRef || '')" @click="setEnv(item.webhookSecretRef, undefined, true)">Set signing secret in Env</v-btn>
        <v-text-field :model-value="webhookUrl(item.integrationId)" label="Suggested webhook URL" readonly persistent-hint hint="Your app must implement this route. Create the provider destination with this exact URL; the editor is not the receiver." />
        <v-text-field :model-value="item.returnUrlRef" label="Checkout / return URL Env reference" :disabled="disabled" :error-messages="errors(`environments/${environment}/returnUrlRef`)" @update:model-value="binding(environment, 'returnUrlRef', $event)" />
        <v-btn height="48" variant="text" :disabled="disabled || !returnUrl" @click="setEnv(item.returnUrlRef, returnUrl, false)">Set suggested application URL in Env</v-btn>
        <p v-if="!returnUrl">No application address is available. Enter the actual application's HTTPS billing URL in Env; do not use the editor address.</p>
        <v-expansion-panels class="mt-4">
          <v-expansion-panel title="Set up payment events and checkout">
            <v-expansion-panel-text>
              <ol>
                <li v-for="step in paymentSetups[modelValue.integrations[item.integrationId]?.provider]?.steps || []" :key="step">{{ step }}</li>
              </ol>
              <a :href="paymentSetups[modelValue.integrations[item.integrationId]?.provider]?.url" target="_blank" rel="noopener noreferrer">Open provider setup documentation</a>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </section>
      <section aria-label="Payment catalogue" class="mb-6">
        <h4 class="text-title-small mb-3">Provider catalogue</h4>
        <p>Save the configuration, then ask your application to compare its plans with the provider. Publishing creates or updates provider products and prices. It does not charge customers.</p>
        <template v-if="canPrepare">
          <v-btn height="48" variant="tonal" class="my-3" :disabled="managementDisabled" @click="emit('prepare')">Prepare payment implementation request</v-btn>
          <p>Adds the saved payment requirements to your chat draft for review before sending. Save any changes first.</p>
        </template>
        <template v-for="(item, environment) in payments.environments" :key="environment">
          <v-btn v-if="item.integrationId === integrationId" height="48" variant="outlined" class="mr-2 my-3" :disabled="managementDisabled" @click="emit('manage', { operation: 'payments-preview', paymentEnvironment: environment })">Preview {{ environment }} catalogue</v-btn>
        </template>
        <template v-for="(item, environment) in payments.environments" :key="`readiness-${environment}`">
          <v-btn v-if="item.integrationId === integrationId" height="48" variant="outlined" class="mr-2 my-3" :disabled="managementDisabled" @click="emit('manage', { operation: 'payments-readiness', paymentEnvironment: environment })">Check {{ environment }} readiness</v-btn>
        </template>
        <section v-if="management?.status === 'payments-readiness'" aria-label="Payment readiness">
          <p>Account {{ management.providerAccountId }} · {{ management.paymentEnvironment }}</p>
          <p>This report is not provider approval. Unknown and manual checks still need evidence before launch.</p>
          <dl>
            <template v-for="check in management.checks" :key="check.id">
              <dt class="font-weight-bold mt-3">{{ ({ credentials: 'Credentials', account: 'Merchant identity', charges: 'Payment acceptance', payouts: 'Payouts', catalogue: 'Products and prices', webhook: 'Payment events', checkout: 'Checkout and billing portal', site: 'Website and provider approval', deployment: 'Deployed application' })[check.id] }} · {{ ({ passed: 'Passed', failed: 'Needs attention', unknown: 'Not verified', manual: 'Manual check required' })[check.status] }}</dt>
              <dd class="ml-0">{{ check.detail }}</dd>
            </template>
          </dl>
        </section>
        <p v-if="managementError && managementOperation !== 'payments-history'" role="alert">{{ managementError }}</p>
        <p v-if="management?.status === 'unconfigured'" role="status">Your application needs payment management implemented in its Integration setup command. Ask the project assistant to implement the payment catalogue contract using your chosen framework.</p>
        <template v-if="management?.review">
          <p>Account {{ management.providerAccountId }} · {{ management.paymentEnvironment }}</p>
          <section v-if="management.review.pending" aria-label="Recover catalogue operation">
            <p role="alert">An earlier provider request is unresolved. Check the matching provider account before continuing.</p>
            <p>{{ management.review.pendingOperation.action }} · {{ management.review.pendingOperation.planId }} · {{ management.review.pendingOperation.name || `${management.review.pendingOperation.currency} ${management.review.pendingOperation.amount} minor units / ${management.review.pendingOperation.interval}` }}</p>
            <v-text-field v-model="recoveryProviderId" label="Existing provider object ID" hint="Copy the matching product or price ID from the provider dashboard. The application verifies it before saving the mapping." persistent-hint :disabled="managementDisabled" />
            <v-btn height="48" variant="tonal" :disabled="managementDisabled || !/^[A-Za-z0-9_-]{1,200}$/.test(recoveryProviderId)" @click="recoveryOpen = true">Review recovery</v-btn>
            <p>If no matching object exists, use the application's authorized administrator tools to investigate. This screen cannot prove that a timed-out write never completed.</p>
          </section>
          <ul v-if="management.review.drift.length"><li v-for="item in management.review.drift" :key="item.planId + item.reason">{{ item.planId }}: {{ item.reason }}</li></ul>
          <ul v-if="management.review.changes.length">
            <li v-for="item in management.review.changes" :key="item.planId + item.action">
              {{ item.planId }}: {{ item.action === 'create-product' ? 'Create product' : item.action === 'rename-product' ? 'Rename product' : 'Create recurring price' }} —
              {{ item.name || `${item.amount} ${item.currency} smallest units / ${item.interval}` }}
            </li>
          </ul>
          <p v-else>No product or price changes are needed.</p>
          <p v-if="management.review.removed.length">Plans absent from this configuration: {{ management.review.removed.join(', ') }}. Their provider records and subscriptions will remain; resolve existing subscribers in the application.</p>
          <v-btn height="48" color="primary" class="mt-3" :disabled="managementDisabled || !management.review.changes.length || management.review.pending || Boolean(management.review.drift.length)" @click="publishOpen = true">Review publication</v-btn>
        </template>
      </section>
      <v-sheet tag="section" aria-label="Billing history" class="mb-6">
        <p class="text-body-medium mb-4">Inspect one application's billing account. Use its user or organization billing ID, not a provider customer ID. Your application controls access to these records.</p>
        <v-text-field v-model="historySubject" label="Application billing account ID" :disabled="managementDisabled" :error-messages="historySubjectError" />
        <v-select v-model="historyCollection" label="Billing records" :items="[{ title: 'Invoices and transactions', value: 'transactions' }, { title: 'Subscriptions', value: 'subscriptions' }]" :disabled="managementDisabled" />
        <template v-for="(item, environment) in payments.environments" :key="`history-${environment}`">
          <v-btn v-if="item.integrationId === integrationId" height="48" variant="tonal" class="mr-2 mb-4" :disabled="managementDisabled || !historySubject.trim() || Boolean(historySubjectError)" @click="emit('manage', { operation: 'payments-history', paymentEnvironment: environment, subjectId: historySubject, collection: historyCollection })">View {{ environment }} billing history</v-btn>
        </template>
        <v-sheet min-height="240" aria-live="polite" :aria-busy="managementLoading">
          <v-skeleton-loader v-if="managementLoading" type="list-item-three-line@3" aria-label="Loading payment information" />
          <div v-else-if="managementOperation === 'payments-history' && managementError" role="status">
            <p class="text-body-medium mb-2">Billing history could not load. Check the application's payment command and provider access, then use View billing history to retry.</p>
          </div>
          <template v-else-if="history">
            <p class="text-body-small mb-2">{{ history.providerAccountId }} · {{ history.paymentEnvironment }} · {{ history.subjectId }}</p>
            <p v-if="!history.items.length" class="text-body-medium">No billing records found for this account.</p>
            <v-list v-else aria-label="Billing records" lines="three" bg-color="transparent">
              <v-list-item v-for="item in history.items" :key="item.id">
                <v-list-item-title class="text-wrap">{{ item.kind }} · {{ item.id }}</v-list-item-title>
                <v-list-item-subtitle class="text-wrap">{{ item.status }} · {{ item.createdAt }}</v-list-item-subtitle>
                <p v-if="item.kind !== 'subscription'" class="text-body-small mt-1">{{ item.currency }} · Total: {{ item.totalMinor ?? 'Unknown' }} · Paid: {{ item.paidMinor ?? 'Unknown' }} (smallest currency units)</p>
              </v-list-item>
            </v-list>
            <v-btn v-if="history.nextCursor" height="48" variant="text" :disabled="managementDisabled" @click="emit('manage', { operation: 'payments-history', paymentEnvironment: history.paymentEnvironment, subjectId: historySubject, collection: historyCollection, after: history.nextCursor })">Next billing page</v-btn>
          </template>
          <p v-else class="text-body-medium">Select a billing account and load its records. Viewing history does not change subscriptions or charge customers.</p>
        </v-sheet>
      </v-sheet>
      <v-dialog v-model="recoveryOpen" max-width="560">
        <v-card title="Recover provider mapping?">
          <v-card-text>Account {{ management?.providerAccountId }} · {{ management?.paymentEnvironment }}. Verify and attach {{ recoveryProviderId }} to the pending {{ management?.review?.pendingOperation?.action }} for {{ management?.review?.pendingOperation?.planId }}. This updates the app's mapping and does not create a provider object.</v-card-text>
          <v-card-actions><v-btn height="48" @click="recoveryOpen = false">Cancel</v-btn><v-btn height="48" :disabled="managementDisabled" @click="recoverCatalogue">Recover mapping</v-btn></v-card-actions>
        </v-card>
      </v-dialog>
      <v-dialog v-model="publishOpen" max-width="560">
        <v-card title="Publish payment catalogue?">
          <v-card-text>Apply the listed changes to account {{ management?.providerAccountId }} in {{ management?.paymentEnvironment }}. Existing provider prices are retained. An interrupted request may have completed remotely; inspect its result before retrying.</v-card-text>
          <v-card-actions><v-btn height="48" @click="publishOpen = false">Cancel</v-btn><v-btn height="48" color="primary" :disabled="managementDisabled" @click="publishCatalogue">Publish catalogue</v-btn></v-card-actions>
        </v-card>
      </v-dialog>
      <h4 class="text-title-small mb-3">Recurring plans</h4>
      <p>Prices use the currency's smallest unit: USD 1200 means $12.00. Renewal credits expire at the end of the paid period. Features are stable names enforced by your app.</p>
      <section v-for="(item, id) in payments.plans" :key="id" :aria-label="`Payment plan ${id}`" class="my-4">
        <h5 class="text-title-small mb-2">{{ id }}</h5>
        <v-text-field :model-value="item.name" label="Plan name" :disabled="disabled" :error-messages="errors(`plans/${id}/name`)" @update:model-value="plan(id, 'name', $event)" />
        <v-row>
          <v-col cols="12" sm="4"><v-text-field :model-value="item.amount" type="number" min="1" step="1" label="Amount in smallest currency unit" :disabled="disabled" :error-messages="errors(`plans/${id}/amount`)" @update:model-value="plan(id, 'amount', $event === '' ? null : Number($event))" /></v-col>
          <v-col cols="12" sm="4"><v-text-field :model-value="item.currency" label="Currency code" :disabled="disabled" :error-messages="errors(`plans/${id}/currency`)" @update:model-value="plan(id, 'currency', String($event || '').toUpperCase())" /></v-col>
          <v-col cols="12" sm="4"><v-select :model-value="item.interval" :items="['month', 'year']" label="Billing interval" :disabled="disabled" @update:model-value="plan(id, 'interval', $event)" /></v-col>
        </v-row>
        <v-combobox :model-value="item.features" label="Included feature names" multiple chips :disabled="disabled" :error-messages="errors(`plans/${id}/features`)" @update:model-value="plan(id, 'features', $event)" />
        <v-text-field :model-value="item.renewalCredits" label="Credits per paid period" type="number" min="0" step="1" persistent-hint hint="Zero means no usage credits. Cancellation does not claw back credits before their expiry." :disabled="disabled" :error-messages="errors(`plans/${id}/renewalCredits`)" @update:model-value="plan(id, 'renewalCredits', $event === '' ? null : Number($event))" />
      </section>
      <v-text-field v-model="planId" label="New stable plan ID" placeholder="pro" :error-messages="planIdError" :disabled="disabled" persistent-hint hint="Changing an existing logical ID would create a different plan. Keep IDs stable for existing subscribers." />
      <v-btn height="48" variant="outlined" :disabled="disabled || !planId || Boolean(planIdError)" @click="addPlan">Add plan</v-btn>
      <p class="mt-4">Save using this page's Save configuration action. The app still needs its payment implementation and a reviewed catalogue publication before checkout can use these plans.</p>
    </template>
  </section>
</template>
