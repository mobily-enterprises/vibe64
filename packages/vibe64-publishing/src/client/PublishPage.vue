<script setup>
// The Publish page: this project's targets (where releases go), the saved work
// a release would use, and the history of releases. Every irreversible step
// ends in the person's own confirmation.
import { computed, ref, watch } from "vue";
import {
  mdiAccountKeyOutline,
  mdiAlertOutline,
  mdiCheckCircle,
  mdiClockOutline,
  mdiGithub,
  mdiLockOpenVariantOutline,
  mdiPackageVariantClosed,
  mdiPlay,
  mdiPlus,
  mdiProgressClock,
  mdiRobotOutline,
  mdiRocketLaunchOutline,
  mdiShieldKeyOutline,
  mdiSourceBranch,
  mdiSourceCommit
} from "@mdi/js";
import Vibe64DashboardPageHeader from "/src/components/studio/Vibe64DashboardPageHeader.vue";
import AddTargetDialog from "./AddTargetDialog.vue";
import AndroidSdkLicenceDialog from "./AndroidSdkLicenceDialog.vue";
import ConfirmPublishDialog from "./ConfirmPublishDialog.vue";
import InstallOnPhoneDialog from "./InstallOnPhoneDialog.vue";
import PublishingAccountsPanel from "./PublishingAccountsPanel.vue";
import RecoveryKitDialog from "./RecoveryKitDialog.vue";
import ReleaseDialog from "./ReleaseDialog.vue";
import ReleaseHistory from "./ReleaseHistory.vue";
import AndroidSideloadCard from "./cards/AndroidSideloadCard.vue";
import GithubReleasesCard from "./cards/GithubReleasesCard.vue";
import NpmCard from "./cards/NpmCard.vue";
import PypiCard from "./cards/PypiCard.vue";
import { destinationAccent, destinationGap, destinationIcon, lastFailure, shortCommit, statusInfo } from "./publishFormat.js";
import { usePublishing } from "./usePublishing.js";

const props = defineProps({
  dashboardContext: { type: Object, default: () => ({}) },
  request: { type: Function, default: undefined }
});

// What a package without its own version is, in words a person uses.
const PACKER_KINDS = { "web-bundle": "web files", capacitor: "app", npm: "npm package", "python-dist": "Python package" };
const CARDS = { npm: NpmCard, pypi: PypiCard, "github-releases": GithubReleasesCard, "android-sideload": AndroidSideloadCard };
const { state, loadError, refresh, call } = usePublishing({
  active: () => props.dashboardContext?.active !== false,
  ...(props.request ? { request: props.request } : {})
});
void refresh();

const dialogs = ref({ add: false, release: false, confirm: false, keys: false, kit: false, licence: false, install: false });
const addPreset = ref("");
const addAccountKind = ref("");
const confirmation = ref({ plan: null, targetIds: [], acknowledged: [], requestedBy: "" });
const install = ref({ releaseId: "", targetId: "", title: "", version: "" });
const pageError = ref("");
const working = ref("");

const destinations = computed(() => (state.value?.destinations || []).map((entry) => ({
  ...entry,
  accountKind: (state.value?.accountKinds || []).find((kind) => kind.destination === entry.id)?.id || ""
})));
const destinationById = computed(() => Object.fromEntries(destinations.value.map((entry) => [entry.id, entry])));
const packages = computed(() => state.value?.packaging?.packages || []);
const packageById = computed(() => Object.fromEntries(packages.value.map((entry) => [entry.id, entry])));
const targets = computed(() => state.value?.targets || []);
const baseline = computed(() => state.value?.baseline || {});
const checks = computed(() => state.value?.checks || null);
const packagingReady = computed(() => state.value?.packaging?.status === "ready");
const running = computed(() => (state.value?.releases || []).find((release) => release.id === state.value?.activeRelease) ||
  (state.value?.releases || []).find((release) => release.status === "running") || null);
const pending = computed(() => state.value?.pendingConfirmation || null);
const keysIcon = computed(() => state.value?.keys?.unlocked ? mdiLockOpenVariantOutline : mdiShieldKeyOutline);
const history = ref(null);

function availability(entry) {
  const reason = destinationGap(entry, { packages: packages.value, baseline: baseline.value });
  return { ok: !reason, reason };
}
const startDestinations = computed(() => destinations.value
  .map((entry) => ({ ...entry, availability: availability(entry) }))
  .sort((left, right) => Number(right.availability.ok) - Number(left.availability.ok)));
const startLead = computed(() => {
  const open = startDestinations.value.filter((entry) => entry.availability.ok);
  if (!open.length) return "None of these fits this project's packages yet.";
  const free = open.filter((entry) => entry.zeroAccount).length;
  return free ? `Choose where your first release goes. ${free === 1 ? "One needs" : `${free} need`} no new account.` : "Choose where your first release goes.";
});

// What each card shows about the release in flight or the last one that failed.
const activityByTarget = computed(() => Object.fromEntries(targets.value.map((target) => {
  const inFlight = running.value && (running.value.steps || []).some((entry) => entry.id === `publish:${target.id}`) && running.value.kind === "release";
  return [target.id, {
    running: Boolean(inFlight),
    version: inFlight ? running.value.versions?.[target.package] || "" : "",
    failure: lastFailure(target, state.value?.releases || [])
  }];
})));

const runChecks = () => act("checks", () => call("/checks"));
const showOutput = ref(false);

function openAdd(preset = "") {
  addPreset.value = preset;
  dialogs.value.add = true;
}

// Adding an account from Add target comes back to Add target afterwards.
const returnToAdd = ref("");
function openKeys(kind = "") {
  addAccountKind.value = kind;
  returnToAdd.value = kind && dialogs.value.add ? addPreset.value || destinations.value.find((entry) => entry.accountKind === kind)?.id || "" : "";
  dialogs.value.add = false;
  dialogs.value.keys = true;
}
watch(() => dialogs.value.keys, (open) => {
  if (open || !returnToAdd.value) return;
  addPreset.value = returnToAdd.value;
  returnToAdd.value = "";
  dialogs.value.add = true;
});

async function act(name, work) {
  working.value = name;
  pageError.value = "";
  try {
    await work();
  } catch (failure) {
    pageError.value = failure.message;
  } finally {
    working.value = "";
  }
}

const removeTarget = (target) => act(`remove:${target.id}`, () => call(`/targets/${encodeURIComponent(target.id)}`, { method: "DELETE" }));
const changeAccount = (target, account) => act(`account:${target.id}`, () => call(`/targets/${encodeURIComponent(target.id)}`, { method: "PATCH", body: { account } }));
const createKey = (target) => act(`key:${target.id}`, async () => {
  if (!state.value?.keys?.unlocked) {
    openKeys();
    throw new Error("Unlock your publishing keys, then create the install key.");
  }
  await call(`/targets/${encodeURIComponent(target.id)}/install-key`);
});

function openConfirm({ plan, targetIds, acknowledged = [], requestedBy = "" }) {
  confirmation.value = { plan, targetIds, acknowledged, requestedBy };
  dialogs.value.release = false;
  dialogs.value.confirm = true;
}

function planAgain() {
  dialogs.value.confirm = false;
  dialogs.value.release = true;
}

// An assistant asked for a release: show the person the current plan for it.
const reviewRequest = () => act("review", async () => {
  const { plan } = await call("/plan", { body: { targetIds: pending.value.targetIds }, refreshAfter: false });
  if (plan.planHash !== pending.value.planHash) throw new Error("The saved work changed since this was asked for. Open Release to review the new plan.");
  openConfirm({ plan, targetIds: pending.value.targetIds, requestedBy: "assistant" });
});
const dismissRequest = () => act("dismiss", () => call("/confirmation/request", { method: "DELETE" }));

// Finishing needs the very plan the person confirmed; when anything in it
// changed, the honest next step is a new release from the saved work.
const notice = ref("");
const resume = (release) => act("resume", async () => {
  const targetIds = (release.steps || []).filter((entry) => entry.id.startsWith("publish:")).map((entry) => entry.id.slice("publish:".length));
  const { plan } = await call("/plan", { body: { targetIds }, refreshAfter: false });
  if (plan.planHash !== release.planHash) {
    notice.value = "This release's plan changed since you confirmed it, so here is a new release from the saved work.";
    dialogs.value.release = true;
    return;
  }
  openConfirm({ plan, targetIds });
});

function openInstall({ releaseId, targetId }) {
  const target = targets.value.find((entry) => entry.id === targetId);
  const release = (state.value?.releases || []).find((entry) => entry.id === releaseId);
  install.value = {
    releaseId,
    targetId,
    title: packageById.value[target?.package]?.applicationName || target?.package || "",
    version: release?.versions?.[target?.package] || target?.latest?.version || ""
  };
  dialogs.value.install = true;
}
</script>

<template>
  <section class="publish-page">
    <Vibe64DashboardPageHeader
      :icon="mdiPackageVariantClosed"
      description="Release your project as an app on your phone or a package people can install."
      title="Publish"
    >
      <template #actions>
        <v-btn :prepend-icon="keysIcon" data-test="open-keys" rounded="pill" variant="tonal" @click="openKeys()">Accounts &amp; keys</v-btn>
        <v-btn
          :disabled="!targets.length || !packagingReady || Boolean(running)"
          :prepend-icon="mdiRocketLaunchOutline"
          color="primary"
          data-test="open-release"
          rounded="pill"
          variant="flat"
          @click="dialogs.release = true"
        >
          Release
        </v-btn>
      </template>
    </Vibe64DashboardPageHeader>

    <v-alert v-if="loadError" type="error" variant="tonal">{{ loadError }}</v-alert>
    <v-skeleton-loader v-if="!state && !loadError" type="article, card" />

    <template v-if="state">
      <div v-if="pending" class="publish-banner publish-banner--ask" role="status">
        <v-icon :icon="mdiRobotOutline" size="22" />
        <div>
          <strong>Your Colleague asked to publish plan {{ pending.planId }}</strong>
          <span>Nothing is published until you review and confirm it here.</span>
        </div>
        <v-btn :loading="working === 'dismiss'" rounded="pill" variant="text" @click="dismissRequest">Dismiss</v-btn>
        <v-btn :loading="working === 'review'" color="primary" rounded="pill" variant="flat" @click="reviewRequest">Review</v-btn>
      </div>

      <div v-if="running" class="publish-banner publish-banner--running" role="status">
        <v-icon :icon="mdiProgressClock" class="publish-banner__spin" size="22" />
        <div>
          <strong>{{ running.kind === "dry-run" ? "Dry run" : "Releasing" }} {{ Object.entries(running.versions || {}).map(([id, version]) => `${packageById[id]?.label || id} ${version}`).join(" · ") }}</strong>
          <span>{{ (running.steps || []).filter((entry) => entry.status === "done").length }} of {{ (running.steps || []).length }} steps done. You can leave this page; it carries on.</span>
        </div>
      </div>

      <v-alert v-if="!baseline.supported" type="warning" variant="tonal">{{ baseline.message || "This project's repository cannot be published from here yet." }}</v-alert>

      <section class="publish-saved" aria-label="Saved work">
        <div>
          <span class="publish-saved__label">Releases use your saved work</span>
          <span class="publish-saved__line">
            <v-icon :icon="mdiSourceCommit" size="18" />
            <code>{{ shortCommit(baseline.commit) || "—" }}</code>
            <v-icon :icon="mdiSourceBranch" class="ml-2" size="18" />
            {{ baseline.branch || "—" }}
            <v-chip :color="baseline.pushed ? 'success' : 'warning'" class="ml-1" size="x-small" variant="tonal">{{ baseline.pushed ? "pushed" : "not pushed" }}</v-chip>
          </span>
        </div>
        <div>
          <span class="publish-saved__label">Checks</span>
          <span class="publish-saved__line">
            <v-icon :class="{ 'publish-banner__spin': checks?.status === 'running' }" :color="statusInfo(checks?.status).color" :icon="checks ? statusInfo(checks.status).icon : mdiClockOutline" size="18" />
            {{ checks ? (checks.status === "failed" ? `${checks.failedCommand || "Checks"} failed` : statusInfo(checks.status).label) : "Not run on this commit" }}
            <v-btn
              v-if="packagingReady && (!checks || checks.status === 'failed')"
              :loading="working === 'checks'"
              :prepend-icon="mdiPlay"
              class="ml-1"
              rounded="pill"
              size="x-small"
              variant="tonal"
              @click="runChecks"
            >
              {{ checks ? "Run again" : "Run checks" }}
            </v-btn>
            <v-btn v-if="checks?.status === 'failed' && checks.output" class="publish-saved__output-toggle" rounded="pill" size="x-small" variant="text" @click="showOutput = !showOutput">
              {{ showOutput ? "Hide output" : "Show output" }}
            </v-btn>
          </span>
        </div>
        <pre v-if="showOutput && checks?.status === 'failed' && checks.output" class="publish-saved__output">{{ checks.output }}</pre>
        <div class="publish-saved__packages">
          <span class="publish-saved__label">Packages</span>
          <span class="publish-saved__chips">
            <span v-for="entry in packages" :key="entry.id" class="publish-chip">
              {{ entry.label }} <em>{{ entry.version || PACKER_KINDS[entry.packer] || entry.packer }}</em>
            </span>
            <span v-if="!packages.length" class="publish-saved__muted">None yet</span>
          </span>
        </div>
      </section>

      <div v-if="!packagingReady" class="publish-empty">
        <v-icon :icon="mdiAlertOutline" color="warning" size="40" />
        <h2>Tell Vibe64 what to build</h2>
        <p>
          Publishing starts from the project's Packaging section, which says what each package is and how it is built.
          Ask your Colleague, for example: <q>Set up packaging so I can install this app on my phone</q>, then Save.
        </p>
        <ul v-if="state.packaging.problem || state.packaging.diagnostics.length" class="publish-empty__diagnostics">
          <li v-if="state.packaging.problem">{{ state.packaging.problem }}</li>
          <li v-for="message in state.packaging.diagnostics" :key="message">{{ message }}</li>
        </ul>
      </div>

      <section v-else class="publish-targets" aria-labelledby="publish-targets-title">
        <h2 id="publish-targets-title" class="publish-section-title">Targets</h2>
        <div v-if="targets.length" class="publish-targets__grid">
          <component
            :is="CARDS[target.destination]"
            v-for="target in targets"
            :key="target.id"
            :accounts="state.accounts"
            :activity="activityByTarget[target.id]"
            :busy="working.endsWith(`:${target.id}`)"
            :destination="destinationById[target.destination]"
            :package-info="packageById[target.package]"
            :target="target"
            :toolchains="state.toolchains"
            @change-account="changeAccount(target, $event)"
            @create-key="createKey(target)"
            @install="openInstall({ releaseId: target.latest.releaseId, targetId: target.id })"
            @recovery-kit="dialogs.kit = true"
            @remove="removeTarget(target)"
            @setup-tools="dialogs.licence = true"
            @show-release="history?.reveal($event)"
          />
          <button class="publish-targets__add" data-test="add-target" type="button" @click="openAdd()">
            <span class="publish-targets__add-icon"><v-icon :icon="mdiPlus" size="22" /></span>
            <strong>Add target</strong>
            <span>Publish {{ packages.length === 1 ? packages[0].label : "a package" }} somewhere else too.</span>
          </button>
        </div>
        <div v-else class="publish-start">
          <p class="publish-start__lead">{{ startLead }}</p>
          <div class="publish-start__grid">
            <button
              v-for="entry in startDestinations"
              :key="entry.id"
              :class="`publish-start__tile--${destinationAccent(entry.id)}`"
              :disabled="!entry.availability.ok"
              class="publish-start__tile"
              type="button"
              @click="openAdd(entry.id)"
            >
              <span class="publish-start__icon"><v-icon :icon="destinationIcon(entry.id)" size="26" /></span>
              <strong>{{ entry.label }}</strong>
              <span>{{ entry.summary }}</span>
              <span v-if="!entry.availability.ok" class="publish-start__meta publish-start__meta--missing">
                <v-icon :icon="mdiAlertOutline" size="14" />
                {{ entry.availability.reason }}
              </span>
              <span v-else class="publish-start__meta">
                <v-icon :icon="entry.id === 'github-releases' ? mdiGithub : entry.zeroAccount ? mdiCheckCircle : mdiAccountKeyOutline" size="14" />
                {{ entry.id === "github-releases" ? "Your GitHub sign-in" : entry.zeroAccount ? "No account" : "Needs an account" }} · {{ entry.cost }}
              </span>
            </button>
          </div>
        </div>
      </section>

      <ReleaseHistory
        ref="history"
        :active-release="state.activeRelease || ''"
        :saved-commit="baseline.commit || ''"
        :packages="packages"
        :call="call"
        :destinations="destinations"
        :releases="state.releases"
        :targets="targets"
        @install="openInstall"
        @release="dialogs.release = true"
        @resume="resume"
      />
    </template>

    <v-snackbar :model-value="Boolean(pageError || notice)" :color="pageError ? 'error' : undefined" location="bottom" max-width="560" timeout="8000" @update:model-value="pageError = ''; notice = ''">
      {{ pageError || notice }}
      <template #actions>
        <v-btn variant="text" @click="pageError = ''; notice = ''">Close</v-btn>
      </template>
    </v-snackbar>
    <AddTargetDialog v-model="dialogs.add" :call="call" :preset="addPreset" :state="state" @add-account="openKeys" />
    <ReleaseDialog v-model="dialogs.release" :call="call" :dashboard-context="dashboardContext" :state="state" @accounts="openKeys()" @confirm="openConfirm" />
    <ConfirmPublishDialog
      v-model="dialogs.confirm"
      :acknowledged="confirmation.acknowledged"
      :call="call"
      :plan="confirmation.plan"
      :requested-by="confirmation.requestedBy"
      :state="state"
      :target-ids="confirmation.targetIds"
      @plan-changed="planAgain"
    />
    <PublishingAccountsPanel v-model="dialogs.keys" :add-kind="addAccountKind" :call="call" :state="state" @recovery-kit="dialogs.kit = true" />
    <RecoveryKitDialog v-model="dialogs.kit" :call="call" :state="state" />
    <AndroidSdkLicenceDialog v-model="dialogs.licence" :call="call" :state="state" />
    <InstallOnPhoneDialog v-model="dialogs.install" :call="call" :release-id="install.releaseId" :target-id="install.targetId" :title="install.title" :version="install.version" />
  </section>
</template>

<style scoped>
.publish-page {
  align-content: start;
  display: grid;
  gap: var(--v64-space-4, 16px);
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}

.publish-banner {
  align-items: center;
  border-radius: var(--v64-shape-lg, 16px);
  display: grid;
  gap: 8px 14px;
  grid-template-columns: 22px minmax(0, 1fr) auto auto;
  padding: 14px 16px;
}

.publish-banner strong {
  display: block;
  font: var(--v64-type-title-md);
}

.publish-banner span {
  color: var(--v64-on-surface-variant);
  display: block;
  font: var(--v64-type-body-md);
}

.publish-banner--ask {
  background: var(--v64-primary-container);
  color: var(--v64-on-primary-container);
}

.publish-banner--running {
  background: var(--v64-surface-container);
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 30%, var(--v64-outline-variant));
  grid-template-columns: 22px minmax(0, 1fr);
}

.publish-banner__spin {
  animation: publish-spin 1.6s linear infinite;
  color: rgb(var(--v-theme-primary));
}

@keyframes publish-spin {
  to { transform: rotate(360deg); }
}

.publish-saved {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  display: grid;
  gap: 12px 32px;
  grid-template-columns: auto minmax(0, 1fr);
  padding: 14px 18px;
}

.publish-saved > .publish-saved__packages {
  border-top: 1px solid var(--v64-outline-variant);
  grid-column: 1 / -1;
  padding-top: 12px;
}

.publish-saved > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.publish-saved__label {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-label-md);
  letter-spacing: 0.02em;
}

.publish-saved__line {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  font: var(--v64-type-body-md);
  gap: 6px;
}

.publish-saved__line code {
  font-size: 0.875rem;
}

.publish-saved__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.publish-chip {
  background: var(--v64-surface);
  border: 1px solid var(--v64-outline-variant);
  border-radius: 999px;
  font: var(--v64-type-label-lg);
  padding: 2px 10px;
}

.publish-chip em {
  color: var(--v64-on-surface-variant);
  font-style: normal;
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}

.publish-saved__muted {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}

.publish-targets {
  display: grid;
}

.publish-targets__grid {
  display: grid;
  gap: var(--v64-space-3, 12px);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
}

.publish-targets__add {
  align-content: center;
  background: transparent;
  border: 1.5px dashed var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  color: var(--v64-on-surface-variant);
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 6px;
  justify-items: center;
  min-height: 180px;
  padding: 20px;
  text-align: center;
  transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
}

.publish-targets__add:hover,
.publish-targets__add:focus-visible {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 5%, transparent);
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}

.publish-targets__add-icon {
  align-items: center;
  background: var(--v64-surface-container-high);
  border-radius: 50%;
  display: inline-flex;
  height: 40px;
  justify-content: center;
  width: 40px;
}

.publish-targets__add strong {
  color: var(--v64-on-surface);
  font: var(--v64-type-title-md);
}

.publish-targets__add span:last-child {
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
  max-width: 16rem;
}

.publish-saved__output {
  background: var(--v64-surface);
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-error)) 30%, var(--v64-outline-variant));
  border-radius: var(--v64-shape-sm, 8px);
  font-size: 0.75rem;
  grid-column: 1 / -1;
  max-height: 14rem;
  overflow: auto;
  padding: 10px 12px;
  white-space: pre-wrap;
}

.publish-start__meta--missing {
  color: rgb(var(--v-theme-warning)) !important;
}

.publish-empty {
  background: var(--v64-surface-container-low);
  border: 1px dashed var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  display: grid;
  gap: 8px;
  justify-items: center;
  padding: 36px 24px;
  text-align: center;
}

.publish-empty h2 {
  font: var(--v64-type-title-lg);
  margin: 0;
}

.publish-empty p {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
  max-width: 38rem;
}

.publish-empty__diagnostics {
  color: rgb(var(--v-theme-warning));
  font-size: 0.8125rem;
  margin: 4px 0 0;
  text-align: left;
}

.publish-start {
  display: grid;
  gap: 12px;
}

.publish-start__lead {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
}

.publish-start__grid {
  display: grid;
  gap: var(--v64-space-3, 12px);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
}

.publish-start__tile {
  --accent: rgb(var(--v-theme-primary));
  align-content: start;
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  color: inherit;
  cursor: pointer;
  font: inherit;
  display: grid;
  gap: 6px;
  justify-items: start;
  padding: 18px;
  text-align: left;
  transition: border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
}

.publish-start__tile:not(:disabled):hover,
.publish-start__tile:focus-visible {
  border-color: var(--accent);
  box-shadow: var(--v64-elevation-1);
  transform: translateY(-2px);
}

.publish-start__tile:disabled {
  background: transparent;
  border-style: dashed;
  cursor: not-allowed;
}

.publish-start__tile:disabled > :not(.publish-start__meta--missing) {
  opacity: 0.55;
}

.publish-start__tile:disabled .publish-start__icon {
  filter: grayscale(1);
}

.publish-start__tile--success { --accent: rgb(var(--v-theme-success)); }
.publish-start__tile--error { --accent: rgb(var(--v-theme-error)); }
.publish-start__tile--info { --accent: rgb(var(--v-theme-info)); }

.publish-start__icon {
  align-items: center;
  background: color-mix(in srgb, var(--accent) 14%, var(--v64-surface));
  border-radius: var(--v64-shape-md, 12px);
  color: var(--accent);
  display: inline-flex;
  height: 48px;
  justify-content: center;
  margin-bottom: 6px;
  width: 48px;
}

.publish-start__tile strong {
  font: var(--v64-type-title-md);
}

.publish-start__tile > span:not(.publish-start__icon) {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}

.publish-start__meta {
  align-items: center;
  display: inline-flex;
  font-size: 0.8125rem;
  gap: 4px;
  margin-top: auto;
}

@media (max-width: 760px) {
  .publish-saved {
    grid-template-columns: minmax(0, 1fr);
  }

  .publish-banner {
    grid-template-columns: 22px minmax(0, 1fr);
  }

  .publish-banner > .v-btn {
    grid-column: 2;
    justify-self: start;
  }
}
</style>

<style>
/* Shared by the Publish page's dialogs, which render outside the page. */
.publish-dialog__title {
  align-items: center;
  display: flex;
  font: var(--v64-type-title-lg);
  gap: 4px;
  padding: 20px 24px 8px;
}

.publish-dialog__actions {
  flex-wrap: wrap;
  padding: 8px 20px 16px;
}

.publish-section-title {
  align-items: center;
  display: flex;
  font: var(--v64-type-title-lg);
  gap: 8px;
  letter-spacing: 0;
  margin: 8px 0 12px;
}
</style>
