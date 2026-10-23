<script setup>
// The Publish page: this project's targets (where releases go), the saved work
// a release would use, and the history of releases. Every irreversible step
// ends in the person's own confirmation.
import { computed, ref } from "vue";
import {
  mdiAlertOutline,
  mdiCheckCircle,
  mdiClockOutline,
  mdiPackageVariantClosed,
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
import { destinationAccent, destinationIcon, shortCommit, statusInfo } from "./publishFormat.js";
import { usePublishing } from "./usePublishing.js";

const props = defineProps({
  dashboardContext: { type: Object, default: () => ({}) },
  request: { type: Function, default: undefined }
});

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
const install = ref({ releaseId: "", targetId: "", title: "" });
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
const running = computed(() => (state.value?.releases || []).find((release) => release.id === state.value?.activeRelease) || null);
const pending = computed(() => state.value?.pendingConfirmation || null);
const keysLabel = computed(() => {
  const keys = state.value?.keys;
  if (!keys?.exists) return "Set up keys";
  return keys.unlocked ? "Keys unlocked" : "Accounts & keys";
});

function openAdd(preset = "") {
  addPreset.value = preset;
  dialogs.value.add = true;
}

function openKeys(kind = "") {
  addAccountKind.value = kind;
  dialogs.value.add = false;
  dialogs.value.keys = true;
}

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
  const { plan } = await call("/plan", { body: { targetIds: pending.value.targetIds || [] }, refreshAfter: false });
  if (plan.planHash !== pending.value.planHash) throw new Error("The saved work changed since this was asked for. Open Release to review the new plan.");
  openConfirm({ plan, targetIds: pending.value.targetIds || [], requestedBy: "assistant" });
});
const dismissRequest = () => act("dismiss", () => call("/confirmation/request", { method: "DELETE" }));

const resume = (release) => act("resume", async () => {
  const targetIds = (release.steps || []).filter((entry) => entry.id.startsWith("publish:")).map((entry) => entry.id.slice("publish:".length));
  const { plan } = await call("/plan", { body: { targetIds }, refreshAfter: false });
  if (plan.planHash !== release.planHash) throw new Error("The saved work changed since this release, so it cannot be finished as it was. Start a new release.");
  openConfirm({ plan, targetIds });
});

function openInstall({ releaseId, targetId }) {
  const target = targets.value.find((entry) => entry.id === targetId);
  install.value = { releaseId, targetId, title: packageById.value[target?.package]?.applicationName || target?.package || "" };
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
        <v-btn :prepend-icon="mdiShieldKeyOutline" rounded="pill" variant="tonal" @click="openKeys()">{{ keysLabel }}</v-btn>
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
          <strong>Your Colleague asked to publish plan {{ pending.planId || String(pending.planHash || "").slice(7, 11) }}</strong>
          <span>Nothing is published until you review and confirm it here.</span>
        </div>
        <v-btn :loading="working === 'dismiss'" rounded="pill" variant="text" @click="dismissRequest">Dismiss</v-btn>
        <v-btn :loading="working === 'review'" color="primary" rounded="pill" variant="flat" @click="reviewRequest">Review</v-btn>
      </div>

      <div v-if="running" class="publish-banner publish-banner--running" role="status">
        <v-icon :icon="mdiProgressClock" class="publish-banner__spin" size="22" />
        <div>
          <strong>{{ running.kind === "dry-run" ? "Dry run" : "Releasing" }} {{ Object.entries(running.versions || {}).map(([id, version]) => `${id} ${version}`).join(" · ") }}</strong>
          <span>{{ (running.steps || []).filter((entry) => entry.status === "done").length }} of {{ (running.steps || []).length }} steps done. You can leave this page; it carries on.</span>
        </div>
      </div>

      <v-alert v-if="pageError" closable type="error" variant="tonal" @click:close="pageError = ''">{{ pageError }}</v-alert>
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
            <v-icon :color="statusInfo(checks?.status).color" :icon="checks ? statusInfo(checks.status).icon : mdiClockOutline" size="18" />
            {{ checks ? statusInfo(checks.status).label : "Not run on this commit" }}
          </span>
        </div>
        <div class="publish-saved__packages">
          <span class="publish-saved__label">Packages</span>
          <span class="publish-saved__chips">
            <span v-for="entry in packages" :key="entry.id" class="publish-chip">
              {{ entry.label }} <em>{{ entry.version || entry.packer }}</em>
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
        <h2 id="publish-targets-title" class="publish-section-title">
          Targets
          <v-btn v-if="targets.length" :prepend-icon="mdiPlus" class="ml-auto" rounded="pill" size="small" variant="tonal" @click="openAdd()">Add target</v-btn>
        </h2>
        <div v-if="targets.length" class="publish-targets__grid">
          <component
            :is="CARDS[target.destination]"
            v-for="target in targets"
            :key="target.id"
            :accounts="state.accounts"
            :busy="working.endsWith(`:${target.id}`)"
            :destination="destinationById[target.destination]"
            :keys="state.keys"
            :package-info="packageById[target.package]"
            :target="target"
            :toolchains="state.toolchains"
            @change-account="changeAccount(target, $event)"
            @create-key="createKey(target)"
            @install="openInstall({ releaseId: target.latest.releaseId, targetId: target.id })"
            @recovery-kit="dialogs.kit = true"
            @remove="removeTarget(target)"
            @setup-tools="dialogs.licence = true"
          />
        </div>
        <div v-else class="publish-start">
          <p class="publish-start__lead">Choose where your first release goes. The first two need no account.</p>
          <div class="publish-start__grid">
            <button
              v-for="entry in destinations"
              :key="entry.id"
              :class="`publish-start__tile--${destinationAccent(entry.id)}`"
              :disabled="!packages.some((candidate) => entry.packers.includes(candidate.packer))"
              class="publish-start__tile"
              type="button"
              @click="openAdd(entry.id)"
            >
              <span class="publish-start__icon"><v-icon :icon="destinationIcon(entry.id)" size="26" /></span>
              <strong>{{ entry.label }}</strong>
              <span>{{ entry.summary }}</span>
              <span class="publish-start__meta">
                <v-icon :icon="entry.zeroAccount ? mdiCheckCircle : mdiShieldKeyOutline" size="14" />
                {{ entry.zeroAccount ? "No account" : "Needs an account" }} · {{ entry.cost }}
              </span>
            </button>
          </div>
        </div>
      </section>

      <ReleaseHistory
        :active-release="state.activeRelease || ''"
        :call="call"
        :destinations="destinations"
        :releases="state.releases"
        :targets="targets"
        @install="openInstall"
        @resume="resume"
      />
    </template>

    <AddTargetDialog v-model="dialogs.add" :call="call" :preset="addPreset" :state="state" @add-account="openKeys" />
    <ReleaseDialog v-model="dialogs.release" :call="call" :dashboard-context="dashboardContext" :state="state" @confirm="openConfirm" />
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
    <InstallOnPhoneDialog v-model="dialogs.install" :call="call" :release-id="install.releaseId" :target-id="install.targetId" :title="install.title" />
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
  cursor: not-allowed;
  opacity: 0.5;
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
