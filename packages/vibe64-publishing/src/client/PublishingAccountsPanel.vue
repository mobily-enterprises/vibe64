<script setup>
// The person's publishing keys on this computer: one passphrase-protected file
// holding their registry sign-ins and phone install keys, plus its recovery
// kit. Nothing secret ever comes back to the page.
import { computed, ref, watch } from "vue";
import {
  mdiAccountKeyOutline,
  mdiGithub,
  mdiLanguagePython,
  mdiLifebuoy,
  mdiLockOpenVariantOutline,
  mdiLockOutline,
  mdiNpm,
  mdiKeyChange,
  mdiPlus,
  mdiShieldKeyOutline,
  mdiTrashCanOutline
} from "@mdi/js";
import { relativeTime } from "./publishFormat.js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  state: { type: Object, default: null },
  addKind: { type: String, default: "" },
  call: { type: Function, required: true }
});
const emit = defineEmits(["update:modelValue", "recovery-kit"]);

const KIND_ICONS = { npm: mdiNpm, pypi: mdiLanguagePython, github: mdiGithub };
const passphrase = ref("");
const repeat = ref("");
const adding = ref(false);
const form = ref({ kind: "npm", label: "", address: "", token: "", source: "token" });
// Replacing keeps the account's kind, name and address, so targets using it keep working.
const replacing = ref("");
const busy = ref("");
const error = ref("");

const keys = computed(() => props.state?.keys || {});
const accounts = computed(() => props.state?.accounts || []);
const kinds = computed(() => props.state?.accountKinds || []);
const kind = computed(() => kinds.value.find((entry) => entry.id === form.value.kind) || null);
const installKeys = computed(() => (keys.value.entries || []).filter((entry) => entry.kind === "android-sideload-key"));
const kitDate = computed(() => keys.value.recoveryKit?.createdAt || "");
const kitStale = computed(() => (keys.value.entries || []).some((entry) => !entry.coveredByRecoveryKit));
const until = computed(() => keys.value.unlockedUntil ? new Date(keys.value.unlockedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

watch(() => props.modelValue, (open) => {
  if (!open) return;
  error.value = "";
  passphrase.value = "";
  repeat.value = "";
  if (props.addKind) startAdding(props.addKind);
  else adding.value = false;
});

function startAdding(kindId = "npm") {
  const chosen = kinds.value.find((entry) => entry.id === kindId) || kinds.value[0];
  form.value = { kind: chosen?.id || "npm", label: "", address: chosen?.defaultAddress || "", token: "", source: "token" };
  replacing.value = "";
  adding.value = true;
}

function startReplacing(account) {
  form.value = { kind: account.kind, label: account.label, address: account.address || "", token: "", source: account.source === "github-cli" ? "github-cli" : "token" };
  adding.value = true;
  replacing.value = account.id;
}

watch(() => form.value.kind, (value, previous) => {
  if (value === previous || replacing.value) return;
  form.value.address = kinds.value.find((entry) => entry.id === value)?.defaultAddress || "";
  form.value.source = "token";
});

async function run(name, work) {
  busy.value = name;
  error.value = "";
  try {
    await work();
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = "";
  }
}

const create = () => run("create", async () => {
  if (passphrase.value !== repeat.value) throw new Error("The two passphrases differ.");
  await props.call("/keys", { body: { passphrase: passphrase.value } });
  passphrase.value = repeat.value = "";
});
const unlock = () => run("unlock", async () => {
  await props.call("/keys/unlock", { body: { passphrase: passphrase.value } });
  passphrase.value = "";
});
const lock = () => run("lock", () => props.call("/keys/lock"));
const addAccount = () => run("add", async () => {
  const { kind: kindId, label, address, token, source } = form.value;
  await props.call("/accounts", { body: { kind: kindId, label: label || kind.value?.label, address, source, ...(source === "token" ? { token } : {}) } });
  form.value.token = "";
  adding.value = false;
  replacing.value = "";
});
const removeAccount = (id) => run(`remove:${id}`, () => props.call(`/accounts/${encodeURIComponent(id)}`, { method: "DELETE" }));
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="640" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card rounded="xl">
      <v-card-title class="publish-dialog__title">Accounts &amp; keys</v-card-title>
      <v-card-text class="publish-keys">
        <section class="publish-keys__vault" :class="{ 'is-open': keys.unlocked }">
          <span class="publish-keys__vault-icon"><v-icon :icon="keys.unlocked ? mdiLockOpenVariantOutline : mdiShieldKeyOutline" size="26" /></span>
          <div class="publish-keys__vault-copy">
            <strong>Publishing keys</strong>
            <span v-if="!keys.exists">One passphrase protects every sign-in and install key Vibe64 keeps for publishing. It stays on this computer, encrypted.</span>
            <span v-else-if="keys.unlocked">Unlocked until {{ until }}. Locks by itself.</span>
            <span v-else>Locked. Unlock to add accounts or publish.</span>
          </div>
          <v-btn v-if="keys.unlocked" :loading="busy === 'lock'" :prepend-icon="mdiLockOutline" rounded="pill" variant="tonal" @click="lock">Lock</v-btn>
        </section>

        <div v-if="!keys.exists" class="publish-keys__form">
          <v-text-field v-model="passphrase" autocomplete="new-password" hint="At least 12 characters. A short sentence works well." label="Passphrase" persistent-hint type="password" variant="outlined" />
          <v-text-field v-model="repeat" autocomplete="new-password" label="Passphrase again" type="password" variant="outlined" @keydown.enter="create" />
          <p class="publish-keys__note">Vibe64 cannot recover a forgotten passphrase. A recovery kit (its own passphrase) restores your keys on any computer.</p>
          <v-btn :disabled="passphrase.length < 12 || !repeat" :loading="busy === 'create'" color="primary" rounded="pill" variant="flat" @click="create">Create publishing keys</v-btn>
        </div>
        <div v-else-if="!keys.unlocked" class="publish-keys__inline">
          <v-text-field v-model="passphrase" :prepend-inner-icon="mdiLockOutline" autocomplete="current-password" density="comfortable" hide-details label="Passphrase" type="password" variant="outlined" @keydown.enter="unlock" />
          <v-btn :disabled="passphrase.length < 12" :loading="busy === 'unlock'" color="primary" rounded="pill" variant="flat" @click="unlock">Unlock</v-btn>
        </div>

        <template v-if="keys.exists">
          <h3 class="publish-keys__heading">
            Accounts
            <v-btn v-if="!adding" :disabled="!keys.unlocked" :prepend-icon="mdiPlus" class="ml-auto" rounded="pill" size="small" variant="tonal" @click="startAdding()">Add account</v-btn>
          </h3>
          <ul v-if="accounts.length" class="publish-keys__list">
            <li v-for="account in accounts" :key="account.id">
              <v-icon :icon="KIND_ICONS[account.kind] || mdiAccountKeyOutline" size="22" />
              <div>
                <strong>{{ account.label }}</strong>
                <span>{{ account.source === "github-cli" ? "From your GitHub CLI sign-in" : account.address || "Token" }} · added {{ relativeTime(account.createdAt) }}</span>
              </div>
              <v-btn :aria-label="`Replace the token of ${account.label}`" :disabled="!keys.unlocked" :icon="mdiKeyChange" size="small" title="Replace token" variant="text" @click="startReplacing(account)" />
              <v-btn :aria-label="`Remove ${account.label}`" :disabled="!keys.unlocked" :icon="mdiTrashCanOutline" :loading="busy === `remove:${account.id}`" size="small" variant="text" @click="removeAccount(account.id)" />
            </li>
          </ul>
          <p v-else-if="!adding" class="publish-keys__note">No accounts yet. Install on my phone needs none; npm, PyPI and GitHub each need one.</p>

          <div v-if="adding" class="publish-keys__add">
            <p v-if="replacing" class="publish-keys__note mb-3">New token for <strong>{{ form.label }}</strong>. Targets using it keep working with the new token.</p>
            <v-btn-toggle v-if="!replacing" v-model="form.kind" class="mb-3" color="primary" density="comfortable" divided mandatory rounded="pill" variant="outlined">
              <v-btn v-for="entry in kinds" :key="entry.id" :prepend-icon="KIND_ICONS[entry.id]" :value="entry.id">{{ entry.label }}</v-btn>
            </v-btn-toggle>
            <v-text-field v-if="!replacing" v-model="form.label" :placeholder="kind?.label" label="Name" variant="outlined" />
            <v-text-field v-if="kind?.addressLabel && !replacing" v-model="form.address" :label="kind.addressLabel" variant="outlined" />
            <v-radio-group v-if="form.kind === 'github'" v-model="form.source" density="compact" hide-details inline>
              <v-radio label="Use my GitHub CLI sign-in" value="github-cli" />
              <v-radio label="Paste a token" value="token" />
            </v-radio-group>
            <v-text-field v-if="form.source === 'token'" v-model="form.token" autocomplete="off" :label="kind?.tokenLabel || 'Token'" type="password" variant="outlined" />
            <div class="publish-keys__add-actions">
              <v-btn rounded="pill" variant="text" @click="adding = false; replacing = ''">Cancel</v-btn>
              <v-btn :disabled="form.source === 'token' && form.token.length < 8" :loading="busy === 'add'" color="primary" rounded="pill" variant="flat" @click="addAccount">{{ replacing ? "Replace token" : "Add" }}</v-btn>
            </div>
          </div>

          <h3 class="publish-keys__heading">Recovery kit</h3>
          <div class="publish-keys__kit" :class="{ 'is-stale': kitStale }">
            <v-icon :icon="mdiLifebuoy" size="22" />
            <div>
              <strong>{{ !kitDate ? "No recovery kit yet" : kitStale ? "Your recovery kit is out of date" : `Saved ${relativeTime(kitDate)}` }}</strong>
              <span v-if="kitStale && installKeys.length">Save a new kit: an install key is not in it yet.</span>
              <span v-else-if="kitStale">Save a new kit so it holds every key.</span>
              <span v-if="kitStale && kitDate" class="text-medium-emphasis">Last saved {{ relativeTime(kitDate) }}.</span>
              <span v-else>Holds every key. Keep it somewhere safe off this computer.</span>
            </div>
            <v-btn :color="kitStale ? 'primary' : undefined" :variant="kitStale ? 'flat' : 'tonal'" rounded="pill" size="small" @click="emit('recovery-kit')">{{ kitStale ? "Save kit" : "Manage" }}</v-btn>
          </div>
        </template>
        <v-alert v-if="error" class="mt-3" type="error" variant="tonal">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions class="publish-dialog__actions">
        <v-spacer />
        <v-btn rounded="pill" variant="text" @click="emit('update:modelValue', false)">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.publish-keys {
  display: grid;
  gap: 12px;
}

.publish-keys__vault {
  align-items: center;
  background:
    linear-gradient(135deg, color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent), transparent 70%),
    var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  display: flex;
  gap: 14px;
  padding: 16px;
}

.publish-keys__vault.is-open {
  background:
    linear-gradient(135deg, color-mix(in srgb, rgb(var(--v-theme-success)) 12%, transparent), transparent 70%),
    var(--v64-surface-container-low);
}

.publish-keys__vault-icon {
  align-items: center;
  background: var(--v64-primary-container);
  border-radius: 50%;
  color: var(--v64-primary);
  display: inline-flex;
  flex: 0 0 auto;
  height: 48px;
  justify-content: center;
  width: 48px;
}

.is-open .publish-keys__vault-icon {
  background: var(--v64-success-container);
  color: rgb(var(--v-theme-success));
}

.publish-keys__vault-copy {
  display: grid;
  flex: 1 1 auto;
  gap: 2px;
}

.publish-keys__vault-copy strong,
.publish-keys__heading {
  font: var(--v64-type-title-md);
}

.publish-keys__vault-copy span,
.publish-keys__note,
.publish-keys__list span,
.publish-keys__kit span {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
}

.publish-keys__note {
  margin: 0;
}

.publish-keys__form {
  display: grid;
  gap: 8px;
}

.publish-keys__inline {
  align-items: center;
  display: flex;
  gap: 12px;
}

.publish-keys__heading {
  align-items: center;
  display: flex;
  margin: 8px 0 0;
}

.publish-keys__list {
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  list-style: none;
  margin: 0;
  padding: 0;
}

.publish-keys__list li,
.publish-keys__kit {
  align-items: center;
  display: grid;
  gap: 12px;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  padding: 10px 14px;
}

.publish-keys__list li {
  grid-template-columns: 22px minmax(0, 1fr) auto auto;
  gap: 4px 12px;
}

.publish-keys__list li + li {
  border-top: 1px solid var(--v64-outline-variant);
}

.publish-keys__list strong,
.publish-keys__kit strong {
  display: block;
  font: var(--v64-type-label-lg);
}

.publish-keys__list span,
.publish-keys__kit span {
  display: block;
}

.publish-keys__add {
  background: var(--v64-surface-container-low);
  border-radius: var(--v64-shape-lg, 16px);
  padding: 16px;
}

.publish-keys__add-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.publish-keys__kit {
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
}

.publish-keys__kit.is-stale {
  background: color-mix(in srgb, rgb(var(--v-theme-warning)) 8%, transparent);
  border-color: color-mix(in srgb, rgb(var(--v-theme-warning)) 40%, var(--v64-outline-variant));
}

@media (max-width: 600px) {
  .publish-keys__inline {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
