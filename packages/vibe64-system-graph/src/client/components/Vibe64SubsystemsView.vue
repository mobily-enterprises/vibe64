<template>
  <section
    class="subsystems"
    aria-label="Project subsystems"
  >
    <header class="subsystems__toolbar">
      <div class="subsystems__identity">
        <v-icon :icon="mdiLayersTripleOutline" />
        <div>
          <strong>Subsystems</strong>
          <span>How the application fits together</span>
        </div>
      </div>
      <v-btn-toggle
        v-model="view"
        mandatory
        density="compact"
        variant="text"
        aria-label="Subsystem presentation"
      >
        <v-btn value="overview" :prepend-icon="mdiViewGridOutline" size="small">Overview</v-btn>
        <v-btn value="city" :prepend-icon="mdiCityVariantOutline" size="small">City</v-btn>
      </v-btn-toggle>
      <v-btn :disabled="refreshing" :prepend-icon="mdiRefresh" size="small" variant="text" @click="reloadAll">Reload</v-btn>
    </header>
    <div
      v-if="subsystemLoading && !subsystemMap"
      class="subsystems__empty"
      role="status"
    >
      <v-skeleton-loader type="heading, paragraph, list-item-three-line@3" />
    </div>
    <div
      v-else-if="subsystemError"
      class="subsystems__empty"
      role="alert"
    >
      <h2>Subsystems could not load</h2>
      <p>{{ subsystemError }}</p>
      <v-btn @click="reload">Retry</v-btn>
    </div>
    <div
      v-else-if="!entries.length && view === 'overview'"
      class="subsystems__empty"
    >
      <v-icon
        :icon="mdiLayersTripleOutline"
        size="48"
      />
      <h2>A home for the bigger picture</h2>
      <p>Your project’s subsystem map connects responsibilities, operations, and data. The coding agent can create it from the application.</p>
      <v-btn :disabled="!assistantAvailable" color="primary" variant="tonal" @click="$emit('describe-subsystems')">Describe subsystems with AI</v-btn>
      <v-btn variant="text" @click="view = 'city'">Explore existing Cities</v-btn>
    </div>
    <div
      v-else
      class="subsystems__body"
      :class="{ 'subsystems__body--city': view === 'city' }"
    >
      <div
        v-if="view === 'overview'"
        class="subsystems__catalog"
      >
        <v-text-field
          v-model="search"
          aria-label="Find a subsystem, operation or table"
          placeholder="Find a subsystem, operation or table…"
          :prepend-inner-icon="mdiMagnify"
          variant="outlined"
          density="compact"
          hide-details
          clearable
        />
        <div class="subsystems__cards">
          <button
            v-for="entry in filteredEntries"
            :key="entry.id"
            type="button"
            class="subsystems__card"
            :class="{ 'subsystems__card--selected': selected?.id === entry.id }"
            :aria-pressed="selected?.id === entry.id"
            @click="selectedId = entry.id"
          >
            <span class="subsystems__card-icon">
              <v-icon
                :icon="mdiLayersTripleOutline"
                size="20"
              />
            </span>
            <strong>{{ entry.title }}</strong>
            <p>{{ entry.description }}</p>
            <span class="subsystems__counts">
              <span>{{ entry.operations.length }} {{ entry.operations.length === 1 ? 'operation' : 'operations' }}</span>
              <span>{{ entry.dataOwned.length }} owned {{ entry.dataOwned.length === 1 ? 'table' : 'tables' }}</span>
              <span v-if="entry.dataUsed.length">{{ entry.dataUsed.length }} used</span>
            </span>
          </button>
          <p v-if="!filteredEntries.length" class="subsystems__muted">No matching subsystems.</p>
        </div>
        <details
          v-if="unassignedTables.length"
          class="subsystems__unassigned"
        >
          <summary>{{ unassignedTables.length }} tables without a declared owner</summary>
          <button
            v-for="table in unassignedTables"
            :key="table.qualifiedName"
            type="button"
            @click="openTable({ qualifiedName: table.qualifiedName })"
          >
            {{ table.qualifiedName }} <v-icon
              :icon="mdiArrowTopRight"
              size="14"
            />
          </button>
        </details>
      </div>
      <Vibe64SystemWorldView
        v-else
        class="subsystems__city"
        :active="active && view === 'city'"
        :session-id="sessionId"
        :resolve-request-url="resolveRequestUrl"
        :restore-request="cityRestoreRequest"
        :program-override="spatialCity"
        initial-city="program"
        shared-inspector
        @select-subsystem="selectSubsystem"
        @open-table="openDeclaredTable" @open-source-file="forwardSource" @open-source-file-immersive="forwardSource"
      />
      <aside
        v-if="selected"
        ref="detailPane"
        class="subsystems__detail"
        :aria-label="`${selected.title} subsystem details`"
      >
        <div class="subsystems__eyebrow">Responsibility</div>
        <h2>{{ selected.title }}</h2>
        <p class="subsystems__responsibility">{{ selected.description }}</p>
        <div class="subsystems__detail-actions">
          <v-btn size="small" variant="text" :prepend-icon="mdiCityVariantOutline" @click="showInCity">Show in City</v-btn>
          <v-btn size="small" variant="text" :prepend-icon="mdiFileDocumentOutline" @click="openSource('genesis/subsystems.md')">Declaration</v-btn>
        </div>
        <section class="subsystems__section">
          <h3>
            <v-icon
              :icon="mdiCodeBraces"
              size="18"
            /> Program operations <span>{{ selected.operations.length }}</span>
          </h3>
          <p v-if="!selected.operations.length" class="subsystems__muted">No operations declared.</p>
          <details
            v-for="operation in selected.operations"
            :key="operation.path"
            class="subsystems__operation"
          >
            <summary>{{ operation.title }}</summary>
            <p>{{ operation.description }}</p>
            <p class="subsystems__contract">{{ operation.publicContract || 'Open the Program explanation, or refresh Cities to load its contract here.' }}</p>
            <v-btn size="small" variant="text" @click="openSource(operation.path)">Open Program explanation</v-btn>
            <button
              v-for="source in operation.sources || []"
              :key="source"
              class="subsystems__source"
              type="button"
              @click="openSource(source)"
            >
              {{ source }} <v-icon
                :icon="mdiArrowTopRight"
                size="14"
              />
            </button>
          </details>
        </section>
        <section
          v-for="group in dataGroups"
          :key="group.key"
          class="subsystems__section"
        >
          <h3>
            <v-icon
              :icon="mdiDatabaseOutline"
              size="18"
            /> {{ group.title }} <span>{{ selected[group.key].length }}</span>
          </h3>
          <p v-if="!selected[group.key].length" class="subsystems__muted">No tables declared.</p>
          <div
            v-for="table in selected[group.key]"
            :key="table.key"
            class="subsystems__table"
          >
            <button
              type="button"
              :disabled="!table.qualifiedName"
              @click="openTable(table)"
            >
              <strong>{{ table.table }}</strong>
              <v-icon
                v-if="table.qualifiedName"
                :icon="mdiArrowTopRight"
                size="16"
              />
              <small>{{ table.resource }} · {{ table.schema }}</small>
            </button>
            <button v-if="group.key === 'dataUsed' && table.ownerId" class="subsystems__owner" type="button" @click="selectedId = table.ownerId">Owned by {{ table.ownerTitle }}</button>
            <small v-if="table.resolution !== 'resolved'" class="subsystems__muted">{{ table.resolution === 'missing' ? 'Not found in the inspected schema' : 'Not resolved against an inspected database' }}</small>
          </div>
        </section>
        <p v-if="databaseError" class="subsystems__database-note" role="status">Database inspection is unavailable. Declared table associations are still shown.</p>
        <p v-else-if="databaseLoading" class="subsystems__muted" role="status">Checking table references…</p>
        <v-btn v-if="hasData" size="small" variant="text" @click="reloadDatabase">Recheck table references</v-btn>
        <p class="subsystems__footnote">These associations describe subsystem membership. They do not imply that every operation uses every table.</p>
      </aside>
    </div>
    <div
      v-if="error"
      class="subsystems__notice"
      role="status"
    >
      {{ error }} <v-btn size="x-small" variant="text" :disabled="refreshing" @click="refresh">Refresh Cities</v-btn>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, toRef, watch } from "vue";
import { mdiArrowTopRight, mdiCityVariantOutline, mdiCodeBraces, mdiDatabaseOutline, mdiFileDocumentOutline, mdiLayersTripleOutline, mdiMagnify, mdiRefresh, mdiViewGridOutline } from "@mdi/js";
import { useVibe64DatabaseTools } from "@local/vibe64-database-tools/client";
import { useVibe64SystemGraph } from "../composables/useVibe64SystemGraph.js";
import { subsystemEntries, subsystemCity } from "../subsystemsModel.js";
import Vibe64SystemWorldView from "./Vibe64SystemWorldView.vue";
const props = defineProps({
  assistantAvailable: {
    type: Boolean,
    default: true
  },
  active: Boolean,
  sessionId: {
    type: String,
    required: true
  },
  projectSlug: {
    type: String,
    default: ""
  },
  restoreRequest: {
    type: Object,
    default: null
  },
  resolveRequestUrl: {
    type: Function,
    default: value => value
  }
});
const emit = defineEmits(["open-source-file", "open-table", "describe-subsystems"]);
const {
  subsystemMap,
  subsystemError,
  subsystemLoading,
  programCity,
  reload,
  refresh,
  refreshing,
  error
} = useVibe64SystemGraph({
  active: toRef(props, "active"),
  sessionId: toRef(props, "sessionId")
});
const view = ref("overview");
const search = ref("");
const selectedId = ref("");
const detailPane = ref(null);
watch(selectedId, async () => {
  if (globalThis.matchMedia?.("(max-width: 800px)").matches) {
    await nextTick();
    detailPane.value?.scrollIntoView({
      block: "start"
    });
  }
});
const cityRestoreRequest = ref(null);
const hasData = computed(() => subsystemMap.value?.subsystems?.some(entry => entry.dataOwned.length || entry.dataUsed.length));
const {
  state: databaseState,
  error: databaseError,
  loading: databaseLoading,
  reload: reloadDatabase
} = useVibe64DatabaseTools({
  active: computed(() => props.active && hasData.value),
  sessionId: toRef(props, "sessionId"),
  projectSlug: toRef(props, "projectSlug")
});
const entries = computed(() => subsystemEntries(subsystemMap.value, programCity.value, databaseState.value));
const selected = computed(() => entries.value.find(entry => entry.id === selectedId.value) || entries.value[0] || null);
const filteredEntries = computed(() => {
  const query = String(search.value || "").toLowerCase().trim();
  return entries.value.filter((entry) => {
    const searchableText = [
      entry.title,
      entry.description,
      ...entry.operations.map((operation) => operation.title),
      ...entry.dataOwned.map((table) => table.table),
      ...entry.dataUsed.map((table) => table.table)
    ].join(" ").toLowerCase();
    return searchableText.includes(query);
  });
});
const spatialCity = computed(() => subsystemCity(subsystemMap.value, programCity.value));
const unassignedTables = computed(() => {
  const owned = new Set(entries.value.flatMap(entry => entry.dataOwned.map(table => table.qualifiedName)));
  return (databaseState.value?.schema?.tables || []).filter(table => !owned.has(table.qualifiedName));
});
const dataGroups = [{
  key: "dataOwned",
  title: "Data owned"
}, {
  key: "dataUsed",
  title: "Data used"
}];
function returnContext() {
  return {
    subsystemView: view.value,
    subsystemId: selected.value?.id || ""
  };
}
function openSource(path) {
  forwardSource({ path });
}
function forwardSource(target) {
  emit("open-source-file", {
    ...target,
    origin: "system",
    systemContext: {
      ...target.systemContext,
      ...returnContext()
    }
  });
}
function openTable(table) {
  emit("open-table", {
    ...table,
    systemContext: returnContext()
  });
}
function openDeclaredTable(reference) {
  const table = entries.value.flatMap(entry => entry.dataOwned).find(entry => entry.key === reference.key);
  if (table?.qualifiedName) {
    openTable(table);
  }
}
function selectSubsystem(id) {
  if (entries.value.some((entry) => entry.id === id)) {
    selectedId.value = id;
  }
}
function showInCity() {
  view.value = "city";
  cityRestoreRequest.value = {
    cityKind: "program",
    selectedDistrictId: `subsystem:${selected.value.id}`,
    sequence: Date.now()
  };
}
async function reloadAll() {
  await Promise.all([reload(), reloadDatabase()]);
}
watch(() => props.sessionId, () => {
  selectedId.value = "";
  search.value = "";
  view.value = "overview";
  cityRestoreRequest.value = null;
});
watch(() => props.restoreRequest, request => {
  if (!request) return;
  if (request.subsystemId) selectedId.value = request.subsystemId;
  if (request.subsystemView) view.value = request.subsystemView;
  cityRestoreRequest.value = request;
}, {
  immediate: true
});
</script>

<style scoped>
.subsystems {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}
.subsystems__toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface),.09);
  flex-wrap: wrap;
}
.subsystems__identity {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-right: auto;
}
.subsystems__identity>.v-icon {
  color: rgb(var(--v-theme-primary));
}
.subsystems__identity div {
  display: flex;
  flex-direction: column;
}
.subsystems__identity strong {
  font-size: 16px;
}
.subsystems__identity span {
  font-size: 12px;
  opacity: .6;
}
.subsystems__body {
  display: grid;
  grid-template-columns: minmax(230px,1fr) minmax(300px,420px);
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.subsystems__catalog {
  padding: 20px;
  min-width: 0;
  overflow: auto;
  background: linear-gradient(145deg,rgba(var(--v-theme-primary),.045),transparent 65%);
}
.subsystems__cards {
  display: grid;
  grid-template-columns: repeat(auto-fit,minmax(210px,1fr));
  gap: 12px;
  margin-top: 18px;
}
.subsystems__card {
  text-align: left;
  border: 1px solid rgba(var(--v-theme-on-surface),.12);
  border-radius: 14px;
  padding: 18px;
  background: rgb(var(--v-theme-surface));
  transition: border-color .15s,box-shadow .15s;
}
.subsystems__card:hover,.subsystems__card--selected {
  border-color: rgba(var(--v-theme-primary),.7);
  box-shadow: 0 3px 16px rgba(var(--v-theme-primary),.09);
}
.subsystems__card--selected {
  background: rgba(var(--v-theme-primary),.055);
}
.subsystems__card:focus-visible,button:focus-visible,summary:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 3px;
}
.subsystems__card-icon {
  display: block;
  color: rgb(var(--v-theme-primary));
  margin-bottom: 12px;
}
.subsystems__card strong {
  font-size: 16px;
}
.subsystems__card p {
  font-size: 13px;
  line-height: 1.55;
  opacity: .75;
  margin: 8px 0 18px;
}
.subsystems__counts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
}
.subsystems__counts span {
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface),.05);
}
.subsystems__detail {
  min-width: 0;
  overflow: auto;
  padding: 26px;
  border-left: 1px solid rgba(var(--v-theme-on-surface),.1);
}
.subsystems__eyebrow {
  text-transform: uppercase;
  letter-spacing: .13em;
  color: rgb(var(--v-theme-primary));
  font-size: 10px;
  font-weight: 700;
}
.subsystems__detail h2 {
  font-size: 25px;
  margin: 7px 0 12px;
}
.subsystems__responsibility {
  font-size: 14px;
  line-height: 1.65;
  opacity: .8;
  white-space: pre-line;
}
.subsystems__detail-actions {
  display: flex;
  flex-wrap: wrap;
  margin: 14px -8px 24px;
}
.subsystems__section {
  border-top: 1px solid rgba(var(--v-theme-on-surface),.1);
  padding: 18px 0 10px;
}
.subsystems__section h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 12px;
}
.subsystems__section h3 span {
  margin-left: auto;
  opacity: .5;
}
.subsystems__operation {
  border: 1px solid rgba(var(--v-theme-on-surface),.1);
  border-radius: 9px;
  margin: 8px 0;
  padding: 12px;
}
.subsystems__operation summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.subsystems__operation p {
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.65;
}
.subsystems__contract {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow: auto;
}
.subsystems__source {
  display: block;
  text-align: left;
  font-size: 11px;
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-primary));
  padding: 6px 0;
}
.subsystems__table {
  margin-bottom: 12px;
}
.subsystems__table>button:first-child {
  display: grid;
  grid-template-columns: 1fr auto;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(64,191,174,.07);
  border: 1px solid rgba(64,191,174,.2);
}
.subsystems__table strong {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.subsystems__table small {
  font-size: 11px;
  opacity: .65;
  grid-column: 1/-1;
}
.subsystems__owner {
  font-size: 11px;
  color: rgb(var(--v-theme-primary));
  padding: 4px 0;
}
.subsystems__muted,.subsystems__footnote,.subsystems__database-note {
  font-size: 12px;
  line-height: 1.55;
  opacity: .65;
}
.subsystems__footnote {
  margin-top: 24px;
}
.subsystems__empty {
  margin: auto;
  padding: 30px;
  text-align: center;
  max-width: 540px;
}
.subsystems__empty h2 {
  margin: 18px 0 10px;
}
.subsystems__empty p {
  line-height: 1.65;
  opacity: .7;
  margin-bottom: 20px;
}
.subsystems__empty .v-btn {
  margin: 5px;
}
.subsystems__city {
  min-width: 0;
  min-height: 400px;
}
.subsystems__notice {
  padding: 8px 18px;
  font-size: 12px;
}
.subsystems__unassigned {
  margin-top: 24px;
  font-size: 12px;
}
.subsystems__unassigned summary {
  cursor: pointer;
}
.subsystems__unassigned button {
  display: block;
  padding: 6px 0;
  overflow-wrap: anywhere;
}
@media(max-width:800px) {
  .subsystems__body {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .subsystems__catalog,.subsystems__detail {
    overflow: visible;
  }
  .subsystems__detail {
    border-left: 0;
    border-top: 1px solid rgba(var(--v-theme-on-surface),.1);
    padding: 20px;
  }
  .subsystems__cards {
    grid-template-columns: repeat(auto-fit,minmax(180px,1fr));
  }
  .subsystems__city {
    height: 480px;
  }
  .subsystems__toolbar {
    padding: 10px;
    gap: 5px;
  }
  .subsystems__identity span {
    display: none;
  }
}
</style>
