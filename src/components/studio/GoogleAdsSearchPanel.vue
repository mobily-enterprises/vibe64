<script setup>
import { computed, ref, watch } from "vue";
import { validateGoogleAdsSearchPlan } from "@jskit-ai/connectors-catalog/shared/google-ads-search";

const props = defineProps({ modelValue: Object, integrationId: String, disabled: Boolean, managementDisabled: Boolean, result: Object, error: String, loading: Boolean, applicationPublicUrl: String, canPrepare: Boolean });
const emit = defineEmits(["update:modelValue", "manage", "prepare"]);
const saved = computed(() => props.modelValue.extensions?.googleAdsSearch?.[props.integrationId]);
const draft = ref({});
const formError = ref("");
const discovery = ref(null), targets = ref(null), campaignId = ref(""), locationName = ref(""), goalName = ref("");
const confirm = ref(""), trackingConfirmed = ref(false), billingConfirmed = ref(false);
const result = computed(() => props.result?.status === "ads" ? props.result : null);
const lines = value => String(value || "").split("\n").map(v => v.trim()).filter(Boolean);
function units(value) {
  if (!/^[0-9]+$/.test(value || "")) return "";
  return `${BigInt(value) / 1000000n}.${String(BigInt(value) % 1000000n).padStart(6, "0")}`.replace(/\.?0+$/, "");
}
function micros(value) {
  if (!/^[0-9]+(?:\.[0-9]{1,6})?$/.test(value || "")) throw new Error("Enter positive money amounts with at most six decimal places, without currency symbols.");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"))).toString();
}
function plan() {
  return validateGoogleAdsSearchPlan({ customerId: draft.value.customerId, name: draft.value.name, currency: draft.value.currency,
    dailyBudgetMicros: micros(draft.value.budget), maxCpcMicros: micros(draft.value.cpc), finalUrl: draft.value.finalUrl,
    conversionActionId: draft.value.conversionActionId, locationIds: draft.value.locationIds, languageId: draft.value.languageId,
    keywords: lines(draft.value.keywords), headlines: lines(draft.value.headlines), descriptions: lines(draft.value.descriptions), nonPolitical: draft.value.nonPolitical });
}
watch(saved, value => {
  const p = value || {};
  draft.value = { ...p, customerId: p.customerId || "", currency: p.currency || "", name: p.name || "", finalUrl: p.finalUrl || props.applicationPublicUrl || "",
    budget: units(p.dailyBudgetMicros), cpc: units(p.maxCpcMicros), locationIds: p.locationIds || [], keywords: p.keywords?.join("\n") || "",
    headlines: p.headlines?.join("\n") || "", descriptions: p.descriptions?.join("\n") || "", nonPolitical: p.nonPolitical === true };
}, { immediate: true });
const localChanges = computed(() => { try { return JSON.stringify(plan()) !== JSON.stringify(validateGoogleAdsSearchPlan(saved.value)); } catch { return true; } });
const blocked = computed(() => props.managementDisabled || props.loading);
const planBlocked = computed(() => blocked.value || localChanges.value || !saved.value);
watch(() => props.result, value => {
  confirm.value = ""; trackingConfirmed.value = false; billingConfirmed.value = false;
  if (value?.operation === "ads-discover") {
    discovery.value = value.data;
    if (value.data.account && String(value.data.account.id) === draft.value.customerId) draft.value.currency = value.data.account.currencyCode;
  }
  if (value?.operation === "ads-targets") targets.value = value.data;
  if (value?.operation === "ads-create") campaignId.value = value.data.campaignId;
});
watch(() => draft.value.customerId, () => { discovery.value = null; targets.value = null; confirm.value = ""; });
watch([() => props.managementDisabled, localChanges, campaignId], () => { confirm.value = ""; trackingConfirmed.value = false; billingConfirmed.value = false; });
function manage(operation, ads = {}) { if (!blocked.value) emit("manage", { operation, ads }); }
function apply() {
  if (props.disabled) return;
  try {
    const next = plan(); formError.value = "";
    emit("update:modelValue", { ...props.modelValue, extensions: { ...props.modelValue.extensions, googleAdsSearch: { ...props.modelValue.extensions?.googleAdsSearch, [props.integrationId]: next } } });
  } catch (error) { formError.value = error.message || "Complete the Search plan fields."; }
}
const accountValid = computed(() => /^[0-9]{10}$/.test(draft.value.customerId));
const campaignValid = computed(() => /^[0-9]{1,20}$/.test(campaignId.value));
const preview = computed(() => result.value?.operation === "ads-preview" ? result.value.data : null);
const inspected = computed(() => result.value?.operation === "ads-campaign" && String(result.value.data.campaign?.id) === campaignId.value ? result.value.data : null);
function performConfirmed() {
  const action = confirm.value; confirm.value = "";
  if (action === "conversion" && accountValid.value && goalName.value.trim()) manage("ads-conversion", { customerId: draft.value.customerId, name: goalName.value.trim() });
  if (action === "create" && !planBlocked.value && preview.value) manage("ads-create", { reviewId: preview.value.reviewId });
  if (action === "launch" && !planBlocked.value && inspected.value && trackingConfirmed.value && billingConfirmed.value) manage("ads-launch", { campaignId: campaignId.value, reviewId: inspected.value.reviewId, trackingConfirmed: true, billingConfirmed: true });
  if (action === "pause" && !planBlocked.value && campaignValid.value) manage("ads-pause", { campaignId: campaignId.value });
}
</script>

<template>
  <section aria-label="Google Ads Search campaigns" class="mt-6">
    <h3 class="text-title-medium">Google Ads Search campaigns</h3>
    <p class="mb-4">Use this project's connected Google account to prepare a Search campaign in an existing Ads account. Google bills the account directly. Creating a campaign here leaves it paused; launching requires a separate review.</p>
    <v-alert type="info" variant="tonal" class="mb-4">Save the connection and connect Google first. Your application must implement the advertising setup command. These controls use the development application's credentials; they can still affect a real Google Ads account.</v-alert>
    <v-btn v-if="canPrepare" height="48" variant="tonal" class="mb-4" :disabled="blocked" @click="emit('prepare')">Prepare Search implementation request</v-btn>
    <p v-if="managementDisabled">Save pending configuration changes and use an active owner session to run account operations. Published-environment advertising management is not available here.</p>
    <v-progress-linear v-if="loading" indeterminate aria-label="Loading Google Ads" class="my-3" />
    <v-alert v-if="result?.status === 'unconfigured' || props.result?.status === 'unconfigured'" type="info" variant="tonal">Your application has not declared its advertising setup command. Use Prepare Search implementation request, then save the application implementation before running these operations.</v-alert>
    <v-alert v-if="error" type="error" variant="tonal" class="my-3" role="alert">{{ error }}</v-alert>
    <v-expansion-panels class="my-4">
      <v-expansion-panel title="1. Choose an existing account and conversion goal">
        <v-expansion-panel-text>
          <p>Find the 10-digit customer ID in Google Ads' account selector and remove its hyphens. If access is through a manager, save that manager's ID in the connection settings first and reconnect if requested.</p>
          <v-btn height="48" variant="outlined" :disabled="blocked" @click="manage('ads-discover')">List accessible accounts</v-btn>
          <p v-if="discovery?.accounts">Directly accessible accounts: {{ discovery.accounts.join(', ') || 'None returned. Ask the Ads account administrator to grant access.' }}</p>
          <v-text-field v-model="draft.customerId" label="Ads customer ID" :disabled="disabled" persistent-hint hint="Use the client account that owns the campaign, not its manager." />
          <v-btn height="48" variant="tonal" :disabled="blocked || !accountValid" @click="manage('ads-discover', { customerId: draft.customerId })">Load account and goals</v-btn>
          <p v-if="discovery?.account" class="my-3">{{ discovery.account.descriptiveName }} · {{ discovery.account.currencyCode }} · {{ discovery.account.timeZone }} · {{ discovery.account.status }} {{ discovery.account.manager ? '(Manager: choose a client below)' : '' }}</p>
          <v-list v-if="discovery?.clients?.length" aria-label="Manager clients"><v-list-item v-for="row in discovery.clients" :key="row.customerClient.id" :title="`${row.customerClient.descriptiveName || ''} — ${row.customerClient.id}`" /></v-list>
          <v-select v-model="draft.conversionActionId" :items="(discovery?.conversions || []).map(row => ({ title: `${row.conversionAction.name} (${row.conversionAction.id})`, value: String(row.conversionAction.id) }))" label="Website conversion goal" :disabled="disabled" persistent-hint hint="Enabled website goals only. Load the account to select one." />
          <v-text-field v-model="goalName" label="New website lead goal name" :disabled="blocked" maxlength="100" />
          <v-btn height="48" variant="outlined" :disabled="blocked || !accountValid || !goalName.trim()" @click="confirm = 'conversion'">Review new conversion goal</v-btn>
          <p class="mt-3">Creating a goal adds an enabled website lead conversion counted once per click. Reload account and goals afterwards. This does not install tracking in your site.</p>
          <template v-for="row in discovery?.conversions || []" :key="row.conversionAction.id">
            <section v-if="String(row.conversionAction.id) === draft.conversionActionId" aria-label="Conversion installation instructions">
              <h4 class="text-title-small mt-4">Install and verify conversion tracking</h4>
              <p>In Google Ads, open Goals → Conversions → Summary, select this goal, then open Tag setup. Install the Google tag through your existing consent/tag manager, and fire the event only after a successful lead submission. Do not add a second copy of an existing tag. Use Tag Assistant to verify it before launch.</p>
              <p>Your app's framework owns this code. Use Prepare Search implementation request to add the saved requirements to your assistant draft; review before sending.</p>
              <v-textarea v-for="(snippet, index) in row.conversionAction.tagSnippets || []" :key="index" :model-value="[snippet.globalSiteTag, snippet.eventSnippet].filter(Boolean).join('\n')" :label="`Google tag snippet ${index + 1} (display only)`" readonly rows="5" />
            </section>
          </template>
          <a href="https://support.google.com/google-ads/answer/6095821" target="_blank" rel="noopener noreferrer">Google website conversion setup</a>
        </v-expansion-panel-text>
      </v-expansion-panel>
      <v-expansion-panel title="2. Prepare the Search campaign">
        <v-expansion-panel-text>
          <p>One ad group, phrase-match keywords, a responsive Search ad, manual maximum CPC, Google Search only, and location presence targeting. Political advertising is not supported by this recipe.</p>
          <v-text-field v-model="draft.name" label="Campaign name" maxlength="100" :disabled="disabled" />
          <v-text-field v-model="draft.finalUrl" label="Public HTTPS landing page" :disabled="disabled" />
          <v-row><v-col cols="12" sm="4"><v-text-field v-model="draft.currency" label="Account currency" readonly hint="Loaded from Google; match the account before review." persistent-hint /></v-col>
            <v-col cols="12" sm="4"><v-text-field v-model="draft.budget" label="Average daily budget" inputmode="decimal" :suffix="draft.currency" :disabled="disabled" /></v-col>
            <v-col cols="12" sm="4"><v-text-field v-model="draft.cpc" label="Maximum cost per click" inputmode="decimal" :suffix="draft.currency" :disabled="disabled" /></v-col></v-row>
          <p>The daily budget is an average, not a hard daily spending cap. Review Google's billing rules and your account's limits before launch.</p>
          <v-text-field v-model="locationName" label="Find a target location" :disabled="blocked" />
          <v-btn height="48" variant="outlined" :disabled="blocked || !accountValid || locationName.trim().length < 2" @click="manage('ads-targets', { customerId: draft.customerId, name: locationName.trim() })">Find locations and languages</v-btn>
          <v-combobox v-model="draft.locationIds" :items="(targets?.locations || []).map(row => ({ title: row.geoTargetConstant.canonicalName, value: String(row.geoTargetConstant.id) }))" :return-object="false" label="Target location IDs" multiple chips :disabled="disabled" hint="Choose search results, or enter known Google geo target IDs. At least one, at most ten." persistent-hint />
          <v-combobox v-model="draft.languageId" :items="(targets?.languages || []).map(row => ({ title: row.languageConstant.name, value: String(row.languageConstant.id) }))" :return-object="false" label="Target language ID" :disabled="disabled" />
          <v-textarea v-model="draft.keywords" label="Phrase keywords — one per line" :disabled="disabled" hint="1–20 keywords, at most 80 characters each." persistent-hint />
          <v-textarea v-model="draft.headlines" label="Ad headlines — one per line" :disabled="disabled" hint="3–15 headlines, at most 30 characters each." persistent-hint />
          <v-textarea v-model="draft.descriptions" label="Ad descriptions — one per line" :disabled="disabled" hint="2–4 descriptions, at most 90 characters each." persistent-hint />
          <v-checkbox v-model="draft.nonPolitical" label="This campaign does not contain EU political advertising" :disabled="disabled" />
          <v-alert v-if="formError" type="error" variant="tonal" role="alert">{{ formError }}</v-alert>
          <v-btn height="48" color="primary" :disabled="disabled || !localChanges" @click="apply">Apply Search plan to configuration</v-btn>
          <p class="mt-3">Then use Save configuration on this page. Operations below always use the saved file. Unapplied form edits are not saved.</p>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <v-btn height="48" variant="tonal" :disabled="planBlocked" @click="manage('ads-preview')">Validate and review saved plan</v-btn>
    <section v-if="preview" aria-label="Search creation review" class="my-4">
      <p>{{ preview.account?.descriptiveName }} · {{ preview.plan.customerId }} · {{ preview.plan.currency }}. Google accepted validation; policy approval, tracking and billing readiness are not established.</p>
      <p>{{ preview.plan.name }} · Average daily budget {{ units(preview.plan.dailyBudgetMicros) }} {{ preview.plan.currency }} · Maximum CPC {{ units(preview.plan.maxCpcMicros) }} {{ preview.plan.currency }}</p>
      <p>Goal: {{ preview.conversion?.name }}. Landing page: {{ preview.plan.finalUrl }}</p>
      <v-textarea :model-value="JSON.stringify(preview.plan, null, 2)" label="Complete reviewed Search plan" readonly rows="8" />
      <v-btn height="48" color="primary" :disabled="planBlocked" @click="confirm = 'create'">Review paused campaign creation</v-btn>
    </section>
    <p v-if="result?.operation === 'ads-create'" role="status">Campaign {{ result.data.campaignId }} created PAUSED. It will not serve until enabled.</p>
    <p v-if="result && ['ads-launch', 'ads-pause', 'ads-conversion'].includes(result.operation)" role="status">Google accepted the request. Reload account or inspect the campaign to verify its current state.</p>
    <section aria-label="Campaign launch and reporting" class="mt-6">
      <h4 class="text-title-small">3. Inspect, launch or pause</h4>
      <p>Saved account: {{ saved?.customerId || 'Apply and save a plan first' }}. Choose the returned campaign ID, or find it in Google Ads. Larger campaigns may require review in Google Ads.</p>
      <v-list v-if="discovery?.campaigns?.length" aria-label="Existing Search campaigns"><v-list-item v-for="row in discovery.campaigns" :key="row.campaign.id" :title="`${row.campaign.name} — ${row.campaign.id} — ${row.campaign.status}`" /></v-list>
      <v-text-field v-model="campaignId" label="Campaign ID to inspect or pause" :disabled="blocked" />
      <v-btn height="48" variant="outlined" :disabled="planBlocked || !campaignValid" @click="manage('ads-campaign', { campaignId })">Inspect current campaign</v-btn>
      <v-btn height="48" variant="outlined" class="ml-2" :disabled="planBlocked || !campaignValid" @click="confirm = 'pause'">Review pause</v-btn>
      <template v-if="inspected">
        <v-textarea :model-value="JSON.stringify(inspected, (key, value) => key === 'reviewId' ? undefined : value, 2)" label="Current Google campaign, ads, targets and goals" readonly rows="10" class="mt-4" />
        <p>Review the complete current values above, including budget, bid, destinations, assets, goals and Google's policy status. These are live account values, not a promise of approval.</p>
        <v-checkbox v-model="trackingConfirmed" label="I verified the conversion tag and successful lead event on the landing site" :disabled="planBlocked" />
        <v-checkbox v-model="billingConfirmed" label="I verified account billing, advertiser requirements and the website, and approve spending this budget" :disabled="planBlocked" />
        <v-btn height="48" color="primary" :disabled="planBlocked || inspected.campaign.status !== 'PAUSED' || !trackingConfirmed || !billingConfirmed" @click="confirm = 'launch'">Review campaign launch</v-btn>
      </template>
      <v-btn height="48" variant="text" class="mt-3" :disabled="planBlocked" @click="manage('ads-report')">Read last 30 days report</v-btn>
      <v-textarea v-if="result?.operation === 'ads-report'" :model-value="JSON.stringify(result.data, null, 2)" label="Search campaign report (costMicros is millionths of account currency)" readonly rows="8" />
      <p class="mt-3">Disconnecting Google does not pause running ads. Reports list at most 50 campaigns; use Google Ads for account-wide reporting, billing and campaigns outside this Search recipe.</p>
    </section>
    <v-dialog :model-value="Boolean(confirm)" max-width="600" @update:model-value="value => { if (!value) confirm = ''; }">
      <v-card :title="({ conversion: 'Create a website conversion goal?', create: 'Create the reviewed campaign paused?', launch: 'Launch campaign and allow spending?', pause: 'Pause campaign?' })[confirm]">
        <v-card-text><p>Account {{ confirm === 'conversion' ? draft.customerId : saved?.customerId }} · {{ confirm === 'conversion' ? goalName : confirm === 'create' ? preview?.plan.name : campaignId }}</p>
          <p v-if="confirm === 'launch'">Google may begin serving ads and charging this account. The application rechecks the campaign review before enabling it.</p>
          <p v-else-if="confirm === 'create'">Create the reviewed budget, campaign, goal association, ad group, keywords and ad together. The campaign starts paused.</p>
          <p v-else-if="confirm === 'pause'">Stop this campaign from serving after Google processes the pause. Already incurred charges remain.</p>
          <p>If a request times out, inspect Google Ads before repeating it: it may already have succeeded.</p>
        </v-card-text>
        <v-card-actions><v-btn height="48" @click="confirm = ''">Cancel</v-btn><v-btn height="48" color="primary" :disabled="blocked" @click="performConfirmed">Confirm {{ confirm }}</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>
