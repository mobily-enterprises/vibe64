<template>
  <section class="subsystems" aria-label="Project subsystems">
    <header class="subsystems__toolbar">
      <div class="subsystems__identity">
        <v-icon :icon="mdiLayersTripleOutline" color="primary" size="28" />
        <div>
          <h1 class="text-title-large">
            Subsystems
          </h1>
          <p class="text-body-small text-medium-emphasis ma-0 mt-1">
            <template v-if="entries.length">
              {{ entries.length }} subsystems · {{ totals.operations }} operations · {{ totals.tables }} tables
            </template>
            <template v-else>
              How your application fits together
            </template>
          </p>
        </div>
      </div>
      <v-btn-toggle
        :model-value="view"
        mandatory
        divided
        color="primary"
        variant="outlined"
        rounded="pill"
        aria-label="Subsystem presentation"
        @update:model-value="changeView"
      >
        <v-btn min-height="48" value="overview" :prepend-icon="mdiViewGridOutline">
          Overview
        </v-btn>
        <v-btn min-height="48" value="city" :prepend-icon="mdiCityVariantOutline">
          City
        </v-btn>
      </v-btn-toggle>
      <v-btn
        min-height="48"
        :disabled="refreshing || subsystemLoading"
        :icon="mdiRefresh"
        variant="text"
        aria-label="Reload subsystems"
        title="Reload subsystems"
        @click="reloadAll"
      />
    </header>

    <div
      v-if="subsystemLoading && !subsystemMap"
      class="subsystems__loading"
      role="status"
      aria-label="Loading subsystems"
      aria-busy="true"
    >
      <v-skeleton-loader type="list-item-two-line@6" />
      <v-skeleton-loader type="heading, paragraph, list-item-three-line@3" />
    </div>
    <div v-else-if="subsystemError && !entries.length" class="subsystems__empty" role="alert">
      <v-icon :icon="mdiLayersTripleOutline" color="primary" size="48" />
      <h2 class="text-headline-small">
        The subsystem map needs attention
      </h2>
      <p class="text-body-large text-medium-emphasis">
        {{ subsystemError }}
      </p>
      <div class="subsystems__actions">
        <v-btn
          min-height="48"
          :disabled="!assistantAvailable"
          color="primary"
          rounded="pill"
          @click="$emit('describe-subsystems')"
        >
          Repair map with AI
        </v-btn>
        <v-btn
          min-height="48"
          variant="text"
          rounded="pill"
          @click="reload"
        >
          Retry
        </v-btn>
        <v-btn
          min-height="48"
          variant="text"
          rounded="pill"
          @click="openSource('genesis/subsystems.md')"
        >
          Open declaration
        </v-btn>
      </div>
    </div>
    <div v-else-if="!entries.length && view === 'overview'" class="subsystems__empty">
      <v-avatar color="primary" variant="tonal" size="80">
        <v-icon :icon="mdiLayersTripleOutline" size="40" />
      </v-avatar>
      <h2 class="text-headline-small">
        See how it all connects
      </h2>
      <p class="text-body-large text-medium-emphasis">
        Create a map of your application’s responsibilities, operations, and data with your coding assistant.
      </p>
      <div class="subsystems__actions">
        <v-btn
          min-height="48"
          :disabled="!assistantAvailable"
          color="primary"
          rounded="pill"
          @click="$emit('describe-subsystems')"
        >
          Generate subsystem map with AI
        </v-btn>
        <v-btn
          min-height="48"
          variant="text"
          rounded="pill"
          @click="changeView('city')"
        >
          Explore City
        </v-btn>
      </div>
    </div>
    <div v-else class="subsystems__body" :class="{ 'subsystems__body--city': view === 'city', 'subsystems__body--detail': detailOpen }">
      <v-sheet
        v-if="view === 'overview'"
        class="subsystems__catalog"
        rounded="xl"
        color="surface-light"
      >
        <div class="pa-4 pb-2">
          <v-text-field
            v-model="search"
            aria-label="Find a subsystem, operation or table"
            placeholder="Find a subsystem…"
            :prepend-inner-icon="mdiMagnify"
            variant="solo"
            flat
            rounded="pill"
            hide-details
            clearable
          />
          <p class="text-label-medium text-medium-emphasis mt-4 mx-2">
            {{ filteredEntries.length }} {{ filteredEntries.length === 1 ? 'subsystem' : 'subsystems' }}
          </p>
        </div>
        <v-list class="subsystems__list pa-2" bg-color="transparent" aria-label="Subsystems">
          <v-list-item
            v-for="entry in filteredEntries"
            :key="entry.id"
            :active="selected?.id === entry.id"
            :aria-current="selected?.id === entry.id ? 'true' : undefined"
            :aria-label="`${entry.title}, ${entry.operations.length} operations, ${entry.dataOwned.length} owned tables`"
            color="primary"
            rounded="lg"
            min-height="72"
            class="mb-1"
            @click="selectSubsystem(entry.id, $event)"
          >
            <template #prepend>
              <v-icon :icon="mdiLayersTripleOutline" size="22" />
            </template>
            <v-list-item-title class="text-title-small text-wrap">
              {{ entry.title }}
            </v-list-item-title>
            <v-list-item-subtitle class="text-body-small mt-1">
              {{ entry.operations.length }} {{ entry.operations.length === 1 ? 'operation' : 'operations' }} · {{ entry.dataOwned.length }} {{ entry.dataOwned.length === 1 ? 'table' : 'tables' }}
            </v-list-item-subtitle>
            <template #append>
              <v-icon :icon="selected?.id === entry.id ? mdiCheck : mdiChevronRight" size="18" />
            </template>
          </v-list-item>
          <div v-if="!filteredEntries.length" class="pa-6 text-body-medium text-medium-emphasis" role="status">
            No matching subsystems. Try an operation or table name.
          </div>
        </v-list>
        <div v-if="unassignedTables.length" class="subsystems__unassigned pa-4">
          <v-expansion-panels variant="accordion" flat>
            <v-expansion-panel bg-color="transparent">
              <v-expansion-panel-title class="text-label-medium">
                {{ unassignedTables.length }} tables without an owner
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <v-list bg-color="transparent" class="pa-0">
                  <v-list-item
                    v-for="table in unassignedTables"
                    :key="table.qualifiedName"
                    min-height="48"
                    class="subsystems__file text-body-small"
                    @click="openTable({ qualifiedName: table.qualifiedName })"
                  >
                    {{ table.name || table.qualifiedName }}
                  </v-list-item>
                </v-list>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </div>
      </v-sheet>
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
        @open-table="openDeclaredTable"
        @open-source-file="forwardSource"
        @open-source-file-immersive="forwardSource"
      />

      <v-sheet
        v-if="selected && (view === 'overview' || detailOpen)"
        class="subsystems__detail-shell"
        :class="{ 'subsystems__detail-shell--floating': view === 'city' }"
        rounded="xl"
        :elevation="view === 'city' ? 3 : 0"
        color="surface"
        :aria-label="`${selected.title} subsystem details`"
        @keydown.esc.stop="closeDetail"
      >
        <div class="subsystems__detail-toolbar px-4 pt-3">
          <v-btn
            min-height="48"
            v-if="view === 'overview'"
            class="subsystems__back"
            :prepend-icon="mdiArrowLeft"
            variant="text"
            rounded="pill"
            @click="closeDetail"
          >
            All subsystems
          </v-btn>
          <span v-else class="text-label-large text-medium-emphasis">
            Subsystem details
          </span>
          <v-spacer />
          <v-btn
            min-height="48"
            v-if="view === 'city'"
            :icon="mdiClose"
            variant="text"
            aria-label="Close subsystem details"
            @click="closeDetail"
          />
          <v-btn
            min-height="48"
            v-else
            :icon="mdiCityVariantOutline"
            variant="text"
            aria-label="Show selected subsystem in City"
            title="Show in City"
            @click="showInCity"
          />
          <v-btn
            min-height="48"
            :icon="mdiFileDocumentOutline"
            variant="text"
            aria-label="Open subsystem declaration"
            title="Open declaration"
            @click="openSource('genesis/subsystems.md')"
          />
        </div>
        <div ref="detailPane" class="subsystems__detail">
          <div class="subsystems__heading">
            <v-avatar color="primary" variant="tonal" size="48">
              <v-icon :icon="mdiLayersTripleOutline" size="26" />
            </v-avatar>
            <div>
              <p class="text-label-medium text-medium-emphasis ma-0 mb-1">
                Responsibility
              </p>
              <h2 ref="detailHeading" tabindex="-1" class="text-headline-medium ma-0">
                {{ selected.title }}
              </h2>
            </div>
          </div>
          <div class="subsystems__description text-body-large" :class="{ 'subsystems__description--collapsed': !descriptionExpanded && selected.description.length > 300 }" @focusin="descriptionExpanded = true">
            <slot
              name="text"
              :open-source="forwardSource"
              :text="selected.description"
              source-path="genesis/subsystems.md"
            >
              {{ selected.description }}
            </slot>
          </div>
          <v-btn
            min-height="48"
            v-if="selected.description.length > 300"
            :aria-expanded="descriptionExpanded"
            class="mt-2"
            variant="text"
            rounded="pill"
            @click="descriptionExpanded = !descriptionExpanded"
          >
            {{ descriptionExpanded ? 'Show less' : 'Read more' }}
          </v-btn>

          <v-tabs
            v-model="detailTab"
            color="primary"
            class="subsystems__tabs mt-6"
            grow
          >
            <v-tab value="operations">
              Operations <span class="ml-2 text-medium-emphasis">
                {{ selected.operations.length }}
              </span>
            </v-tab>
            <v-tab value="data">
              Data <span class="ml-2 text-medium-emphasis">
                {{ selected.dataOwned.length + selected.dataUsed.length }}
              </span>
            </v-tab>
          </v-tabs>
          <div
            v-if="detailTab === 'operations'"
            class="pt-5"
            role="region"
            aria-label="Subsystem operations"
          >
            <p class="text-body-medium text-medium-emphasis mb-4">
              What this part of the application does.
            </p>
            <p v-if="!selected.operations.length" class="text-body-medium text-medium-emphasis py-6">
              No Program operations are declared for this subsystem.
            </p>
            <v-expansion-panels
              v-else
              :key="selected.id"
              variant="accordion"
              flat
            >
              <v-expansion-panel
                v-for="operation in selected.operations"
                :key="operation.path"
                :value="operation.path"
                bg-color="surface-light"
                class="subsystems__operation"
              >
                <v-expansion-panel-title class="text-title-medium">
                  <v-icon
                    :icon="mdiCodeBraces"
                    size="20"
                    class="mr-3"
                    color="primary"
                  />{{ operation.title }}
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <div v-if="operation.description" class="text-body-medium mb-4">
                    <slot
                      name="text"
                      :open-source="forwardSource"
                      :text="operation.description"
                      :source-path="operation.path"
                    >
                      {{ operation.description }}
                    </slot>
                  </div>
                  <div v-if="operation.publicContract" class="subsystems__contract text-body-medium">
                    <slot
                      name="text"
                      :open-source="forwardSource"
                      :text="operation.publicContract"
                      :source-path="operation.path"
                    >
                      {{ operation.publicContract }}
                    </slot>
                  </div>
                  <v-btn
                    min-height="48"
                    variant="tonal"
                    color="primary"
                    rounded="pill"
                    class="my-4"
                    :append-icon="mdiArrowTopRight"
                    @click="openSource(operation.path)"
                  >
                    Open explanation
                  </v-btn>
                  <p v-if="operation.sources?.length" class="text-label-medium text-medium-emphasis mb-2">
                    Source files
                  </p>
                  <v-list v-if="operation.sources?.length" bg-color="transparent" class="pa-0">
                    <v-list-item
                      v-for="source in operation.sources"
                      :key="source"
                      :append-icon="mdiArrowTopRight"
                      min-height="48"
                      class="subsystems__file text-body-small"
                      @click="openSource(source)"
                    >
                      {{ source }}
                    </v-list-item>
                  </v-list>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </div>
          <div
            v-else
            class="pt-5"
            role="region"
            aria-label="Subsystem data"
          >
            <section v-for="group in dataGroups" :key="group.key" class="mb-6">
              <div class="d-flex align-center justify-space-between mb-2">
                <h3 class="text-title-medium ma-0">
                  {{ group.title }}
                </h3><span class="text-label-medium text-medium-emphasis">
                  {{ selected[group.key].length }}
                </span>
              </div>
              <p class="text-body-small text-medium-emphasis mb-3">
                {{ group.key === 'dataOwned' ? 'Records whose meaning and lifecycle belong here.' : 'Records shared by another subsystem.' }}
              </p>
              <p v-if="!selected[group.key].length" class="text-body-medium text-medium-emphasis py-3">
                No tables declared.
              </p>
              <v-list
                v-else
                :aria-label="group.title"
                lines="two"
                bg-color="surface-light"
                rounded="lg"
                class="py-0"
              >
                <template v-for="table in selected[group.key]" :key="table.key">
                  <v-list-item
                    :link="Boolean(table.qualifiedName)"
                    :aria-label="`${table.table}, ${table.resource}, ${table.schema}`"
                    :append-icon="table.qualifiedName ? mdiArrowTopRight : undefined"
                    min-height="64"
                    @click="table.qualifiedName && openTable(table)"
                  >
                    <template #prepend>
                      <v-icon :icon="mdiDatabaseOutline" color="primary" size="20" />
                    </template>
                    <v-list-item-title class="subsystems__table-name text-body-medium">
                      {{ table.table }}
                    </v-list-item-title>
                    <v-list-item-subtitle class="text-body-small">
                      {{ table.resource }} · {{ table.schema }}
                    </v-list-item-subtitle>
                  </v-list-item>
                  <div v-if="table.resolution !== 'resolved' || (group.key === 'dataUsed' && table.ownerId)" class="px-4 pb-3">
                    <v-btn
                      min-height="48"
                      v-if="group.key === 'dataUsed' && table.ownerId"
                      variant="text"
                      rounded="pill"
                      color="primary"
                      @click="selectSubsystem(table.ownerId, $event)"
                    >
                      Owned by {{ table.ownerTitle }}
                    </v-btn>
                    <p v-if="table.resolution !== 'resolved'" class="text-body-small text-medium-emphasis">
                      {{ table.resolution === 'missing' ? 'Not found in the inspected schema' : 'Database reference not yet resolved' }}
                    </p>
                  </div>
                </template>
              </v-list>
            </section>
            <p v-if="databaseError" class="text-body-small text-medium-emphasis" role="status">
              Database inspection is unavailable. Declared associations are still shown.
            </p>
            <p v-else-if="databaseLoading" class="text-body-small text-medium-emphasis" role="status">
              Checking table references…
            </p>
            <v-btn
              min-height="48"
              v-if="hasData"
              variant="text"
              rounded="pill"
              @click="reloadDatabase"
            >
              Recheck table references
            </v-btn>
          </div>
        </div>
      </v-sheet>
    </div>
    <div v-if="error || (subsystemError && entries.length)" class="subsystems__notice text-body-small" role="status">
      <span>{{ subsystemError || error }}</span>
      <v-btn
        min-height="48"
        variant="text"
        :disabled="refreshing"
        @click="subsystemError ? reload() : refresh()"
      >
        {{ subsystemError ? 'Retry' : 'Refresh Cities' }}
      </v-btn>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, toRef, watch } from "vue";
import {
  mdiArrowLeft,
  mdiArrowTopRight,
  mdiCheck,
  mdiChevronRight,
  mdiClose,
  mdiCityVariantOutline,
  mdiCodeBraces,
  mdiDatabaseOutline,
  mdiFileDocumentOutline,
  mdiLayersTripleOutline,
  mdiMagnify,
  mdiRefresh,
  mdiViewGridOutline
} from "@mdi/js";
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
  reloadVersion: { type: Number, default: 0 },
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
  reloadVersion: toRef(props, "reloadVersion"),
  sessionId: toRef(props, "sessionId")
});
const view = ref("overview");
const search = ref("");
const selectedId = ref("");
const detailPane = ref(null);
const detailHeading = ref(null);
let detailTrigger = null;
const detailOpen = ref(false);
const detailTab = ref("operations");
const descriptionExpanded = ref(false);
const totals = computed(() => entries.value.reduce((total, entry) => ({
  operations: total.operations + entry.operations.length,
  tables: total.tables + entry.dataOwned.length
}), { operations: 0, tables: 0 }));
watch(selectedId, () => {
  descriptionExpanded.value = false;
  detailTab.value = "operations";
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
    subsystemId: view.value === "overview" || detailOpen.value ? selected.value?.id || "" : ""
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
async function selectSubsystem(id, event) {
  if (!id) {
    detailOpen.value = false;
    return;
  }
  if (!entries.value.some((entry) => entry.id === id)) return;
  detailTrigger = event?.currentTarget || document.activeElement;
  selectedId.value = id;
  detailOpen.value = true;
  await nextTick();
  detailPane.value?.scrollTo({ top: 0 });
  detailHeading.value?.focus({ preventScroll: true });
}
function changeView(value) {
  view.value = value;
  detailOpen.value = false;
}
async function closeDetail() {
  detailOpen.value = false;
  await nextTick();
  detailTrigger?.focus();
}
function showInCity() {
  view.value = "city";
  detailOpen.value = false;
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
  detailOpen.value = false;
  descriptionExpanded.value = false;
  detailTab.value = "operations";
  search.value = "";
  view.value = "overview";
  cityRestoreRequest.value = null;
});
watch(() => props.restoreRequest, request => {
  if (!request) return;
  if (request.subsystemId) {
    selectedId.value = request.subsystemId;
    detailOpen.value = true;
  }
  if (request.subsystemView) view.value = request.subsystemView;
  cityRestoreRequest.value = request;
}, {
  immediate: true
});
</script>

<style scoped>
.subsystems {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.subsystems__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 16px 24px;
  flex: none;
}

.subsystems__identity {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-right: auto;
  min-width: 0;
}

.subsystems__identity h1 {
  margin: 0;
}

.subsystems__body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(240px, 304px) minmax(0, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 0 24px 24px;
  overflow: hidden;
}

.subsystems__catalog {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.subsystems__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.subsystems__unassigned {
  max-height: 35%;
  overflow-y: auto;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.subsystems__detail-shell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.subsystems__detail-toolbar {
  display: flex;
  align-items: center;
  flex: none;
  min-height: 60px;
}

.subsystems__detail {
  padding: 16px 32px 32px;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

.subsystems__heading {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.subsystems__heading > div {
  min-width: 0;
}

.subsystems__heading h2 {
  overflow-wrap: anywhere;
}

.subsystems__description {
  max-width: 68ch;
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.subsystems__description--collapsed {
  max-height: 6em;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}

.subsystems__tabs {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.subsystems__operation {
  margin-bottom: 8px;
}

.subsystems__contract {
  overflow-wrap: anywhere;
}

.subsystems__file {
  overflow-wrap: anywhere;
  text-align: start;
  max-width: 100%;
}

.subsystems__table-name {
  overflow-wrap: anywhere;
  white-space: normal;
}

.subsystems__back {
  display: none;
}

.subsystems__body--city {
  display: block;
  padding: 0;
}

.subsystems__city {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.subsystems__detail-shell--floating {
  position: absolute;
  inset: 16px 16px 16px auto;
  width: min(400px, calc(100% - 32px));
  z-index: 2;
}

.subsystems__detail-shell--floating .subsystems__detail {
  padding: 16px 24px 24px;
}

.subsystems__loading {
  display: grid;
  grid-template-columns: 304px 1fr;
  gap: 24px;
  padding: 16px 24px;
  flex: 1;
  overflow: hidden;
}

.subsystems__empty {
  margin: auto;
  padding: 32px 24px;
  text-align: center;
  max-width: 580px;
  overflow-y: auto;
}

.subsystems__empty h2 {
  margin: 24px 0 12px;
}

.subsystems__empty p {
  margin-bottom: 24px;
  overflow-wrap: anywhere;
}

.subsystems__actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

.subsystems__notice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 24px;
  background: rgb(var(--v-theme-surface-light));
}

.subsystems__notice span {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* The tool shares a window with chat, so adapt to its own available width. */

@container (max-width: 720px) {
  .subsystems__toolbar {
    padding: 12px;
    gap: 8px;
  }
  .subsystems__identity {
    width: calc(100% - 60px);
  }
  .subsystems__body {
    grid-template-columns: minmax(0, 1fr);
    padding: 0 12px 12px;
    gap: 0;
  }
  .subsystems__detail-shell {
    display: none;
  }
  .subsystems__body--detail .subsystems__catalog {
    display: none;
  }
  .subsystems__body--detail .subsystems__detail-shell {
    display: flex;
  }
  .subsystems__back {
    display: inline-flex;
  }
  .subsystems__detail {
    padding: 16px 20px 24px;
  }
  .subsystems__body--city {
    padding: 0;
  }
  .subsystems__detail-shell--floating {
    inset: 8px;
    width: auto;
  }
  .subsystems__loading {
    grid-template-columns: 1fr;
    padding: 12px;
  }
}
</style>
