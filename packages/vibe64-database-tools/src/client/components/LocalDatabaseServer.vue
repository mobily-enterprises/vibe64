<template>
  <section
    v-for="database in databases"
    :key="database.id"
    class="db-server"
    :class="`db-server--${tone(database)}`"
    :data-database-server="database.kind"
    aria-label="Database server"
  >
    <header class="db-server__header">
      <div class="db-server__icon" aria-hidden="true">
        <v-progress-circular v-if="busy" indeterminate size="18" width="2" />
        <v-icon v-else :icon="connected(database) ? mdiCheckCircle : mdiDatabaseAlertOutline" size="20" />
      </div>
      <div class="db-server__heading">
        <strong class="db-server__title">{{ title(database) }}</strong>
        <span v-if="connected(database)" class="db-server__where">{{ where(database) }}</span>
        <v-btn
          v-if="connected(database) && !editing"
          class="db-server__finish"
          color="primary"
          :prepend-icon="mdiRefresh"
          rounded="pill"
          variant="flat"
          @click="emit('retry')"
        >
          Finish preparing
        </v-btn>
        <span v-else class="db-server__lead">
          This project keeps its data in a {{ labelFor(database) }} server that you run, on this computer or one you already have.
        </span>
      </div>
      <v-btn
        v-if="connected(database) && !editing"
        class="db-server__edit"
        color="primary"
        size="small"
        variant="text"
        @click="editing = true"
      >
        Change
      </v-btn>
    </header>

    <v-expand-transition>
      <div
        v-if="!connected(database) || editing"
        class="db-server__body"
        :class="{ 'db-server__body--start-first': !showFields(database) }"
      >
        <p
          class="db-server__status"
          :class="{ 'db-server__status--fresh': fresh }"
          aria-live="polite"
        >
          <v-icon :icon="connected(database) ? mdiCheckCircle : mdiAlertCircleOutline" size="16" />
          <span>{{ statusText(database) }}</span>
        </p>

        <form class="db-server__form" @submit.prevent="saveAndCheck(database)">
          <p v-if="!showFields(database)" class="db-server__looking">
            <span>Looking for it at <code>{{ where(database) }}</code></span>
            <v-btn
              class="db-server__change"
              color="primary"
              density="comfortable"
              variant="text"
              @click="editing = true"
            >
              Change
            </v-btn>
          </p>
          <v-text-field
            v-for="field in (showFields(database) ? database.fields : [])"
            :key="field.name"
            v-model="form[field.name]"
            :autocomplete="field.secret ? 'new-password' : 'off'"
            :class="`db-server__field db-server__field--${field.semantic}`"
            density="comfortable"
            :disabled="busy"
            :hint="field.name"
            :label="fieldLabel(field)"
            persistent-hint
            :persistent-placeholder="field.secret && field.set"
            :placeholder="field.secret && field.set ? 'Saved · leave empty to keep it' : ''"
            spellcheck="false"
            :type="field.secret && !showSecret ? 'password' : 'text'"
            variant="outlined"
          >
            <template v-if="field.secret" #append-inner>
              <v-icon
                :aria-label="showSecret ? 'Hide password' : 'Show password'"
                :icon="showSecret ? mdiEyeOffOutline : mdiEyeOutline"
                role="button"
                size="18"
                tabindex="0"
                @click="showSecret = !showSecret"
                @keydown.enter.prevent="showSecret = !showSecret"
              />
            </template>
          </v-text-field>
          <div class="db-server__actions">
            <v-btn
              color="primary"
              :loading="busy"
              :prepend-icon="dirty ? mdiContentSaveOutline : mdiRefresh"
              rounded="pill"
              type="submit"
              variant="flat"
            >
              {{ dirty ? "Save and check" : "Check again" }}
            </v-btn>
            <span v-if="showFields(database)" class="db-server__saved-where">Kept in this project's Env.</span>
          </div>
        </form>

        <v-expansion-panels v-model="openHelp" class="db-server__help" multiple variant="accordion">
          <v-expansion-panel v-if="guide(database)?.install" value="server">
            <v-expansion-panel-title>
              <span class="db-server__help-title">
                <v-icon :icon="mdiServerOutline" size="18" />
                Install or start {{ guide(database).product }}
              </span>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <ol class="db-server__steps">
                <li>
                  <span>Not installed yet? This installs it and starts it.</span>
                  <Vibe64CopyCommand :command="guide(database).install.command" :label="`Copy the command that installs ${guide(database).product}`" />
                </li>
                <li>
                  <span>Installed but stopped? This starts it.</span>
                  <Vibe64CopyCommand :command="guide(database).start.command" :label="`Copy the command that starts ${guide(database).product}`" />
                </li>
              </ol>
              <p v-if="guide(database).install.note" class="db-server__note">
                <v-icon :icon="mdiLockOutline" size="14" />
                {{ guide(database).install.note }}
              </p>
              <a class="db-server__other" :href="guide(database).guideUrl" rel="noopener" target="_blank">
                Other ways to install it
                <v-icon :icon="mdiOpenInNew" size="13" />
              </a>
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel value="login">
            <v-expansion-panel-title>
              <span class="db-server__help-title">
                <v-icon :icon="mdiAccountKeyOutline" size="18" />
                Create a login and database for this project
              </span>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <template v-if="createCommand(database)">
                <p class="db-server__sentence">
                  Paste this into a terminal on this computer. It uses the values above, then choose {{ dirty ? "Save and check" : "Check again" }}.
                </p>
                <Vibe64CopyCommand
                  :command="createCommand(database).shown"
                  :copy-text="createCommand(database).copied"
                  label="Copy the command that creates the login and database"
                />
                <p v-if="createCommand(database).note" class="db-server__note">
                  <v-icon :icon="mdiLockOutline" size="14" />
                  {{ createCommand(database).note }}
                </p>
              </template>
              <template v-else>
                <p class="db-server__sentence">
                  {{ createHint(database) }}
                </p>
                <v-btn
                  class="db-server__suggest"
                  :prepend-icon="mdiAutoFix"
                  rounded="pill"
                  size="small"
                  variant="tonal"
                  @click="suggestLogin(database)"
                >
                  Suggest a user and password
                </v-btn>
              </template>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
    </v-expand-transition>
  </section>
</template>

<script setup>
// The database server a project's Stack needs, when the person runs it
// themselves: its connection values (saved in the project's Env under the
// exact names the Stack declares), a real sign-in check, and the commands to
// install, start and set it up. Vibe64 never runs the server or the commands.
import { computed, reactive, ref, watch } from "vue";
import {
  mdiAccountKeyOutline,
  mdiAlertCircleOutline,
  mdiAutoFix,
  mdiCheckCircle,
  mdiContentSaveOutline,
  mdiDatabaseAlertOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiLockOutline,
  mdiOpenInNew,
  mdiRefresh,
  mdiServerOutline
} from "@mdi/js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import Vibe64CopyCommand from "/src/components/common/Vibe64CopyCommand.vue";
import { VIBE64_SURFACE_ID } from "/src/lib/vibe64RequestConfig.js";
import { ENV_USER_VALUES_ENDPOINT, VIBE64_ENV_USER_VALUES_API_SUFFIX } from "/src/lib/studioGateApi.js";
import { databaseServerGuide, isAdminUser } from "../../shared/serverGuide.js";

const props = defineProps({
  sessionId: { type: String, required: true },
  active: { type: Boolean, default: true }
});
// Once connected, the next step is finishing workspace preparation from here.
const emit = defineEmits(["retry"]);

const paths = usePaths();
const serverPath = computed(() => `${paths.api("/vibe64/database", { surface: "app" })}/sessions/${encodeURIComponent(props.sessionId)}/server`);
const resource = useEndpointResource({
  enabled: computed(() => Boolean(props.active && props.sessionId)),
  fallbackLoadError: "The database check could not run.",
  path: computed(() => (props.active && props.sessionId ? serverPath.value : "")),
  queryKey: computed(() => ["vibe64", "database", "server", props.sessionId]),
  queryOptions: { refetchOnWindowFocus: "always", staleTime: 0 },
  requestRecoveryLabel: "Database check"
});
const saveCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_ENV_USER_VALUES_API_SUFFIX,
  buildCommandOptions: () => ({ method: "PUT", path: ENV_USER_VALUES_ENDPOINT }),
  buildRawPayload: (_model, { context }) => ({ environment: "dev", sessionId: props.sessionId, values: context.values || {} }),
  fallbackRunError: "The database settings could not be saved.",
  messages: { error: "The database settings could not be saved.", success: "Saved in Env." },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.database.server.save",
  suppressSuccessMessage: true,
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});

const report = computed(() => resource.data.value || {});
const databases = computed(() => (report.value.managed === false && Array.isArray(report.value.databases) ? report.value.databases : []));
const busy = computed(() => resource.isFetching.value === true || saveCommand.isRunning === true);
const form = reactive({});
const showSecret = ref(false);
const editing = ref(false);
const openHelp = ref([]);
// Briefly marks the status line after an answer, so a repeated result still reads as new.
const fresh = ref(false);

const LABELS = { mysql: "MySQL or MariaDB", postgresql: "PostgreSQL" };
const FIELD_LABELS = { host: "Host", port: "Port", database: "Database", username: "User", password: "Password" };

function labelFor(database) {
  return LABELS[database.kind] || "database";
}

function fieldLabel(field) {
  return field.optional && field.secret ? `${FIELD_LABELS[field.semantic]} (if it has one)` : FIELD_LABELS[field.semantic] || field.semantic;
}

function connected(database) {
  return database.check?.state === "connected";
}

function tone(database) {
  return connected(database) ? "ready" : "attention";
}

function title(database) {
  if (connected(database)) {
    return [database.check.product, database.check.version].filter(Boolean).join(" ") + " is connected";
  }
  return database.check?.state === "not-running" || database.check?.state === "unreachable"
    ? `This project needs a ${labelFor(database)} server`
    : `Finish connecting to ${labelFor(database)}`;
}

function value(database, semantic) {
  const field = database.fields.find((candidate) => candidate.semantic === semantic);
  return field ? String(form[field.name] ?? "") : "";
}

function where(database) {
  if (database.connectsWith === "url") return "Using the database address in Env.";
  return `${value(database, "host")}:${value(database, "port")} · database ${value(database, "database")} · user ${value(database, "username")}`;
}

// While nothing answers, the next step is starting the server, not editing
// settings: they fold into one line until the person chooses Change.
function showFields(database) {
  return editing.value || dirty.value || database.connectsWith === "url" || database.check?.state !== "not-running";
}

function statusText(database) {
  if (connected(database)) return `Connected as ${value(database, "username") || "the saved user"}.`;
  if (database.check?.state === "incomplete") {
    return `Fill in ${database.missing.join(", ")} below, then choose Save and check.`;
  }
  return database.check?.message || "Vibe64 couldn't sign in to the database server.";
}

// The form starts from the values that apply now; a saved password is never sent back.
function resetForm() {
  for (const database of databases.value) {
    for (const field of database.fields) form[field.name] = field.secret ? "" : String(field.value ?? "");
  }
}

const original = computed(() => Object.fromEntries(databases.value.flatMap((database) => database.fields.map((field) => [field.name, field.secret ? "" : String(field.value ?? "")]))));
const dirty = computed(() => Object.entries(original.value).some(([name, before]) => String(form[name] ?? "") !== before));
// Values the person is typing survive a background re-check; untouched fields follow the saved ones.
const touched = ref(false);
watch(form, () => { touched.value = dirty.value; }, { deep: true });

function helpFor(database) {
  const state = database.check?.state;
  if (state === "not-running" || state === "unreachable") return ["server"];
  if (["wrong-login", "login-method", "database-missing", "no-access"].includes(state)) return ["login"];
  return [];
}

let freshTimer = null;
watch(() => report.value, (now, before) => {
  if (!touched.value) resetForm();
  if (now !== before && before && Object.keys(before).length) {
    fresh.value = true;
    clearTimeout(freshTimer);
    freshTimer = setTimeout(() => { fresh.value = false; }, 1600);
  }
  const first = databases.value[0];
  if (first && !openHelp.value.length) openHelp.value = helpFor(first);
}, { immediate: true });

function guide(database) {
  return databaseServerGuide({ kind: database.kind, family: report.value.family || "" });
}

function createCommand(database) {
  const password = value(database, "password");
  const input = {
    kind: database.kind,
    family: report.value.family || "",
    database: value(database, "database"),
    username: value(database, "username"),
    testDatabase: database.testDatabase?.value || ""
  };
  const copied = databaseServerGuide({ ...input, password })?.create;
  if (!copied) return null;
  const shown = databaseServerGuide({ ...input, password: "•".repeat(Math.min(Math.max(password.length, 8), 16)) }).create;
  return { shown: shown.command, copied: copied.command, note: copied.note };
}

function createHint(database) {
  if (isAdminUser(value(database, "username"))) {
    return `“${value(database, "username")}” is the server's administrator. Give this project its own user: Vibe64 can suggest one with a strong password.`;
  }
  return "Choose a user and password above, or let Vibe64 suggest them.";
}

function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function suggestLogin(database) {
  const field = (semantic) => database.fields.find((candidate) => candidate.semantic === semantic);
  const name = value(database, "database").replace(/[^A-Za-z0-9_]/gu, "_") || "app";
  if (field("username") && (!value(database, "username") || isAdminUser(value(database, "username")))) form[field("username").name] = name;
  if (field("password")) form[field("password").name] = randomPassword();
}

async function saveAndCheck(database) {
  if (dirty.value) {
    const values = {};
    for (const field of database.fields) {
      const next = String(form[field.name] ?? "");
      if (field.secret ? next === "" : next === String(field.value ?? "")) continue;
      values[field.name] = { secret: field.secret, value: next };
    }
    const response = await saveCommand.run({ values });
    if (response?.ok === false) return;
    for (const field of database.fields) if (field.secret) form[field.name] = "";
    showSecret.value = false;
  }
  editing.value = false;
  await resource.reload();
}
</script>

<style scoped>
.db-server {
  background: color-mix(in srgb, rgb(var(--v-theme-warning)) 5%, rgb(var(--v-theme-surface)));
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-warning)) 26%, transparent);
  border-radius: var(--v64-shape-md, 12px);
  display: grid;
  gap: var(--v64-space-3, 12px);
  margin-top: var(--v64-space-2, 8px);
  padding: var(--v64-space-4, 16px);
  transition: background-color var(--v64-duration-medium) var(--v64-ease-standard),
    border-color var(--v64-duration-medium) var(--v64-ease-standard);
}

.db-server--ready {
  background: var(--v64-surface-container-low);
  border-color: var(--v64-outline-variant);
  padding-block: var(--v64-space-3, 12px);
}

.db-server__header {
  align-items: start;
  display: grid;
  gap: var(--v64-space-3, 12px);
  grid-template-columns: 20px minmax(0, 1fr) auto;
}

.db-server__icon {
  align-items: center;
  color: rgb(var(--v-theme-warning));
  display: flex;
  height: 24px;
  justify-content: center;
}

.db-server--ready .db-server__icon { color: var(--v64-success); }

.db-server__heading {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.db-server__title {
  font: var(--v64-type-title-md);
  font-size: 0.9375rem;
  line-height: 24px;
}

.db-server__lead,
.db-server__where,
.db-server__sentence {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
}

.db-server__where {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.db-server__edit { margin-top: -4px; }
.db-server__finish { justify-self: start; margin-top: var(--v64-space-2, 8px); }

.db-server__body {
  display: grid;
  gap: var(--v64-space-3, 12px);
}

.db-server__body--start-first .db-server__status { order: -2; }
.db-server__body--start-first .db-server__help { order: -1; }

.db-server__looking {
  align-items: center;
  color: var(--v64-on-surface-variant);
  display: flex;
  flex-wrap: wrap;
  font: var(--v64-type-body-md);
  gap: 0 var(--v64-space-2, 8px);
  grid-column: 1 / -1;
  margin: 0;
}

.db-server__looking code {
  background: none;
  color: var(--v64-on-surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
  padding: 0;
}

.db-server__change { margin-inline-start: -8px; }

.db-server__status {
  align-items: start;
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-sm, 8px);
  color: var(--v64-on-surface);
  display: flex;
  font: var(--v64-type-body-md);
  gap: 8px;
  margin: 0;
  min-height: 44px;
  padding: 10px 12px;
  transition: box-shadow var(--v64-duration-medium) var(--v64-ease-standard);
}

.db-server__status .v-icon {
  color: rgb(var(--v-theme-warning));
  flex: none;
  margin-top: 2px;
}

.db-server--ready .db-server__status .v-icon { color: var(--v64-success); }

.db-server__status--fresh {
  box-shadow: 0 0 0 2px color-mix(in srgb, rgb(var(--v-theme-primary)) 45%, transparent);
}

.db-server__form {
  display: grid;
  gap: 14px 12px;
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.db-server__field { grid-column: span 3; }
.db-server__field--host { grid-column: span 4; }
.db-server__field--port { grid-column: span 2; }
.db-server__field--password { grid-column: span 6; }

.db-server__field :deep(.v-messages__message) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0;
}

.db-server__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2, 8px) var(--v64-space-4, 16px);
  grid-column: 1 / -1;
  padding-top: 4px;
}

.db-server__saved-where {
  color: var(--v64-on-surface-variant);
  font-size: 0.8125rem;
}

.db-server__help {
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-sm, 8px);
  overflow: hidden;
}

.db-server__help :deep(.v-expansion-panel) { background: transparent; }
.db-server__help :deep(.v-expansion-panel-title) { min-height: 48px; padding: 10px 14px; }
.db-server__help :deep(.v-expansion-panel-text__wrapper) { display: grid; gap: var(--v64-space-2, 8px); padding: 2px 14px 14px; }

.db-server__help-title {
  align-items: center;
  display: inline-flex;
  font: var(--v64-type-label-lg);
  gap: 10px;
}

.db-server__suggest { justify-self: start; }

.db-server__steps {
  display: grid;
  gap: var(--v64-space-3, 12px);
  list-style: none;
  margin: 0;
  padding: 0;
}

.db-server__steps li {
  display: grid;
  gap: 6px;
}

.db-server__steps li > span {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}

.db-server__note {
  align-items: center;
  color: var(--v64-on-surface-variant);
  display: flex;
  font-size: 0.8125rem;
  gap: 6px;
  margin: 0;
}

.db-server__other {
  align-items: center;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  font: var(--v64-type-label-lg);
  gap: 4px;
  justify-self: start;
  text-decoration: none;
}

.db-server__other:hover { text-decoration: underline; }

@media (max-width: 599px) {
  .db-server { padding: var(--v64-space-3, 12px); }
  .db-server__field,
  .db-server__field--host,
  .db-server__field--port { grid-column: span 6; }
  .db-server__field--port { grid-column: span 2; }
  .db-server__field--host { grid-column: span 4; }
}
</style>
