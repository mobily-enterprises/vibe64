<template>
  <section class="system-world">
    <header class="system-world__toolbar">
      <div class="system-world__identity">
        <span class="system-world__mark" aria-hidden="true">
          <v-icon :icon="mdiCityVariantOutline" size="19" />
        </span>
        <div>
          <strong>Machine City · {{ rendererRevision }}</strong>
          <span>{{ statusLabel }}</span>
        </div>
      </div>

      <div class="system-world__view-actions">
        <v-btn
          aria-label="Back to previous Genesis City view"
          :disabled="!canNavigateWorldBack || worldHistoryBusy"
          :icon="mdiArrowLeft"
          size="x-small"
          title="Back to previous Genesis City view"
          type="button"
          variant="text"
          @click="navigateWorldHistory('back')"
        />
        <v-btn
          aria-label="Forward to next Genesis City view"
          :disabled="!canNavigateWorldForward || worldHistoryBusy"
          :icon="mdiArrowRight"
          size="x-small"
          title="Forward to next Genesis City view"
          type="button"
          variant="text"
          @click="navigateWorldHistory('forward')"
        />
        <v-btn
          :icon="mdiCrosshairsGps"
          size="x-small"
          title="Fit the current City"
          type="button"
          variant="text"
          @click="fitWorld"
        />
        <v-btn
          :icon="mdiMapOutline"
          size="x-small"
          title="Top-down map"
          type="button"
          variant="text"
          @click="setWorldView('top')"
        />
        <v-btn
          :icon="mdiRotate3dVariant"
          size="x-small"
          title="Perspective view"
          type="button"
          variant="text"
          @click="setWorldView('perspective')"
        />
        <v-btn
          color="primary"
          :disabled="refreshing"
          :prepend-icon="mdiRefresh"
          size="small"
          type="button"
          variant="tonal"
          @click="refreshCities"
        >
          {{ refreshing ? "Refreshing Cities…" : "Refresh Cities" }}
        </v-btn>
      </div>
    </header>

    <div class="system-world__stage">
      <canvas
        ref="canvasElement"
        aria-label="Interactive 3D Genesis City. Left-drag or use arrow keys to move. Right-drag or swipe horizontally with two fingers to rotate. Use the mouse wheel, a vertical two-finger scroll, or W and S to zoom. Click an item to inspect it and double-click a building to open its source."
        class="system-world__canvas"
        tabindex="0"
      />

      <div
        v-if="hoveredImplementationBundle"
        class="system-world__connection-tooltip"
        :style="{
          left: `${hoveredImplementationBundle.canvasX}px`,
          top: `${hoveredImplementationBundle.canvasY}px`
        }"
      >
        <span>Genesis implementation bundle</span>
        <strong>{{ semanticSubsystemsById.get(hoveredImplementationBundle.subsystemId)?.title }}</strong>
        <code>{{ machineDistrictsById.get(hoveredImplementationBundle.precinctId)?.path || "Project" }}</code>
        <small>
          {{ formatCount(hoveredImplementationBundle.operationIds.length, "operation") }} ·
          {{ formatCount(hoveredImplementationBundle.fileIds.length, "file") }}
        </small>
      </div>

      <div
        v-if="semanticSubsystems.length"
        class="system-world__layer-controls"
        aria-label="Genesis semantic layers"
      >
        <span>Layers</span>
        <button
          :class="{ 'system-world__layer-control--active': showSubsystems }"
          type="button"
          @click="toggleSemanticLayer('subsystems')"
        >
          Subsystem sky
        </button>
        <button
          :class="{ 'system-world__layer-control--active': showImplementationLinks }"
          :disabled="!showSubsystems"
          title="Show the selected subsystem or operation's Genesis implemented-by links"
          type="button"
          @click="toggleSemanticLayer('implementations')"
        >
          Implementations
        </button>
      </div>

      <div v-if="loading && !machineCity" class="system-world__state-card" role="status">
        <v-skeleton-loader
          :aria-label="`Loading ${cityTitle}`"
          class="system-world__state-skeleton"
          type="avatar, heading, text"
        />
      </div>

      <div v-else-if="worldError || error || cityAvailability.state === 'invalid'" class="system-world__state-card system-world__state-card--error">
        <v-icon :icon="mdiAlertOutline" size="32" />
        <strong>{{ cityTitle }} could not render.</strong>
        <span>{{ worldError || error || cityAvailability.error?.message }}</span>
        <v-btn size="small" type="button" variant="tonal" @click="reload">Retry</v-btn>
      </div>

      <div v-else-if="!machineCity" class="system-world__state-card">
        <v-icon :icon="mdiInformationOutline" size="34" />
        <strong>{{ cityTitle }} has not been generated yet.</strong>
        <span>Genesis can refresh both Cities from the current project.</span>
        <v-btn
          color="primary"
          :disabled="refreshing"
          :prepend-icon="mdiRefresh"
          size="small"
          type="button"
          @click="refreshCities"
        >
          {{ refreshing ? "Generating Cities…" : "Generate Cities" }}
        </v-btn>
      </div>

      <div v-else-if="buildings.length === 0" class="system-world__state-card">
        <v-icon :icon="mdiInformationOutline" size="34" />
        <strong>{{ cityTitle }} is empty.</strong>
        <span>Add Stack pieces with a code indexer, then refresh the Cities.</span>
      </div>

      <div v-if="refreshing" class="system-world__progress" role="status">
        <span class="system-world__progress-pulse" />
        Refreshing both Genesis Cities…
      </div>

      <div v-if="worldOverview" class="system-world__view-gizmo" aria-label="Rotate Genesis City view">
        <button aria-label="Rotate view left" title="Rotate left" type="button" @click="rotateWorld(-20)">
          <v-icon :icon="mdiRotateLeft" size="15" />
        </button>
        <button
          class="system-world__view-gizmo-puck"
          aria-label="Drag to rotate the view"
          title="Drag to orbit the City"
          type="button"
          @lostpointercapture="endViewRotation"
          @pointercancel="endViewRotation"
          @pointerdown="startViewRotation"
          @pointermove="continueViewRotation"
          @pointerup="endViewRotation"
        >
          <v-icon :icon="mdiOrbit" size="17" />
          <span>N</span>
        </button>
        <button aria-label="Rotate view right" title="Rotate right" type="button" @click="rotateWorld(20)">
          <v-icon :icon="mdiRotateRight" size="15" />
        </button>
      </div>

      <nav v-if="buildings.length" class="system-world__navigator" :aria-label="`${cityTitle} explorer`">
        <template v-if="showSubsystems && semanticSubsystems.length">
          <header>
            <span>Subsystems</span>
            <strong>{{ semanticSubsystems.length }}</strong>
          </header>
          <button
            v-for="subsystem in semanticSubsystems"
            :key="subsystem.id"
            :class="{ 'system-world__navigator-button--active': selectedSemanticSubsystem?.id === subsystem.id }"
            type="button"
            @click="inspectSemanticSubsystem(subsystem)"
          >
            <v-icon :icon="mdiLayersTripleOutline" size="13" />
            <span>
              <strong>{{ subsystem.title }}</strong>
              <small>{{ formatCount(subsystem.operations.length, 'operation') }} · {{ formatCount(subsystem.files.length, 'file') }}</small>
            </span>
          </button>
        </template>
        <template v-if="machineNavigatorRegions.length">
          <header>
            <span>Regions</span>
            <strong>{{ machineNavigatorRegions.length }}</strong>
          </header>
          <button
            v-for="region in machineNavigatorRegions"
            :key="region.id"
            :class="{ 'system-world__navigator-button--active': activePresentationRegionId === region.id }"
            type="button"
            @click="selectPresentationRegion(region)"
          >
            <v-icon :icon="mdiMapMarkerPath" size="13" />
            <span>
              <strong>{{ region.title }}</strong>
              <small>{{ formatCount(region.buildingCount, 'file') }}</small>
            </span>
          </button>
        </template>
        <header v-if="!machineNavigatorRegions.length">
          <span>Precincts</span>
          <strong>{{ machineNavigatorDistricts.length }}</strong>
        </header>
        <header v-else>
          <span>Campuses</span>
          <strong>{{ machineNavigatorDistricts.length }}</strong>
        </header>
        <button
          v-for="district in machineNavigatorDistricts"
          :key="district.id"
          :class="{ 'system-world__navigator-button--active': selectedDistrict?.id === district.id }"
          type="button"
          @click="inspectDistrict(district)"
        >
          <v-icon :icon="mdiMapMarkerPath" size="13" />
          <span>
            <strong>{{ district.title }}</strong>
            <small>{{ district.path || 'Project root' }}</small>
          </span>
        </button>
        <template v-if="machineNavigatorSections.length">
          <header>
            <span>Sections</span>
            <strong>{{ machineNavigatorSections.length }}</strong>
          </header>
          <button
            v-for="district in machineNavigatorSections"
            :key="district.id"
            :class="{ 'system-world__navigator-button--active': selectedDistrict?.id === district.id }"
            type="button"
            @click="inspectDistrict(district)"
          >
            <v-icon :icon="mdiFolderOutline" size="13" />
            <span>
              <strong>{{ district.title }}</strong>
              <small>{{ district.path }}</small>
            </span>
          </button>
        </template>
      </nav>

      <aside v-if="selectedSemanticOperation" class="system-world__inspector">
        <span class="system-world__eyebrow">Program operation</span>
        <h2>{{ selectedSemanticOperation.title }}</h2>
        <p class="system-world__path">{{ selectedSemanticOperation.path }}</p>
        <div class="system-world__chips">
          <span>{{ selectedSemanticOperation.subsystem }}</span>
          <span>{{ formatCount(selectedSemanticOperation.implementationLinks.length, 'implementation') }}</span>
        </div>
        <p v-if="selectedSemanticOperation.description">{{ selectedSemanticOperation.description }}</p>
        <div class="system-world__section">
          <strong>Public contract</strong>
          <pre>{{ selectedSemanticOperation.publicContract }}</pre>
        </div>
        <div class="system-world__section">
          <strong>Implemented by</strong>
          <button
            v-for="link in selectedSemanticOperation.implementationLinks"
            :key="link.id"
            class="system-world__source-link"
            type="button"
            @click="openSourceFile(link.file.path)"
          >
            {{ link.file.path }}
          </button>
        </div>
        <div class="system-world__inspector-actions">
          <v-btn
            :prepend-icon="mdiCrosshairsGps"
            size="small"
            type="button"
            variant="text"
            @click="focusCurrentSelection"
          >
            Focus
          </v-btn>
          <v-btn
            :prepend-icon="mdiFileCodeOutline"
            size="small"
            type="button"
            variant="tonal"
            @click="openSourceFile(selectedSemanticOperation.path)"
          >
            Open Program operation
          </v-btn>
        </div>
      </aside>

      <aside v-else-if="selectedSemanticSubsystem" class="system-world__inspector">
        <span class="system-world__eyebrow">Program subsystem</span>
        <h2>{{ selectedSemanticSubsystem.title }}</h2>
        <p class="system-world__path">{{ selectedSemanticSubsystem.path }}</p>
        <div class="system-world__metrics">
          <span><strong>{{ selectedSemanticSubsystem.operations.length }}</strong> operations</span>
          <span><strong>{{ selectedSemanticSubsystem.files.length }}</strong> exact files</span>
          <span><strong>{{ selectedSemanticSubsystem.implementationLinks.length }}</strong> links</span>
        </div>
        <div class="system-world__section">
          <strong>Public operations</strong>
          <button
            v-for="operation in selectedSemanticSubsystem.operations"
            :key="operation.id"
            class="system-world__operation-link"
            type="button"
            @click="inspectSemanticOperation(operation)"
          >
            <strong>{{ operation.title }}</strong>
            <span>{{ formatCount(operation.implementationLinks.length, 'implementation') }}</span>
          </button>
        </div>
        <div class="system-world__section">
          <strong>Participating files</strong>
          <button
            v-for="file in selectedSemanticSubsystem.files"
            :key="file.id"
            class="system-world__source-link"
            type="button"
            @click="openSourceFile(file.path)"
          >
            {{ file.path }}
          </button>
        </div>
        <div class="system-world__inspector-actions">
          <v-btn
            :prepend-icon="mdiCrosshairsGps"
            size="small"
            type="button"
            variant="text"
            @click="focusCurrentSelection"
          >
            Focus
          </v-btn>
        </div>
      </aside>

      <aside v-else-if="selectedBuilding" class="system-world__inspector">
        <span class="system-world__eyebrow">Machine file</span>
        <h2>{{ selectedBuilding.title }}</h2>
        <p class="system-world__path">{{ selectedBuilding.path }}</p>

        <div class="system-world__chips">
          <span>{{ selectedBuilding.language }}</span>
          <span>{{ selectedBuilding.role }}</span>
        </div>
        <div class="system-world__metrics">
          <span><strong>{{ formatNumber(selectedBuilding.lines) }}</strong> lines</span>
          <span><strong>{{ formatBytes(selectedBuilding.bytes) }}</strong> size</span>
          <span><strong>{{ selectedFunctions.length }}</strong> functions</span>
        </div>
        <div v-if="selectedFunctions.length" class="system-world__section">
          <strong>Indexed functions</strong>
          <ul>
            <li v-for="entry in selectedFunctions" :key="entry.id">
              <button
                class="system-world__function-link"
                type="button"
                @click="openSourceFile(entry.path, { line: entry.line, column: entry.column })"
              >
                <strong>{{ entry.qualifiedName }}</strong>
                <span>{{ entry.visibility }} {{ entry.kind }} · line {{ entry.line }}</span>
              </button>
            </li>
          </ul>
        </div>

        <div class="system-world__inspector-actions">
          <v-btn
            :prepend-icon="mdiCrosshairsGps"
            size="small"
            type="button"
            variant="text"
            @click="focusCurrentSelection"
          >
            Focus
          </v-btn>
          <v-btn
            :prepend-icon="mdiFileCodeOutline"
            size="small"
            type="button"
            variant="tonal"
            @click="openSourceFile(selectedBuilding.path)"
          >
            Open file
          </v-btn>
        </div>
      </aside>

      <aside v-else-if="selectedDistrict" class="system-world__inspector">
        <span class="system-world__eyebrow">Directory</span>
        <h2>{{ selectedDistrict.title }}</h2>
        <p class="system-world__path">{{ selectedDistrict.path || 'Project root' }}</p>
        <div class="system-world__metrics">
          <span><strong>{{ selectedDistrict.buildingCount }}</strong> buildings</span>
          <span><strong>{{ formatNumber(selectedDistrict.lines) }}</strong> lines</span>
        </div>
        <div class="system-world__inspector-actions">
          <v-btn
            :prepend-icon="mdiCrosshairsGps"
            size="small"
            type="button"
            variant="text"
            @click="focusCurrentSelection"
          >
            Focus
          </v-btn>
        </div>
      </aside>

      <div v-if="machineCity" class="system-world__controls-hint" aria-label="Genesis City controls">
        <span><v-icon :icon="mdiMouse" size="14" /> Left-drag / arrows: move</span>
        <span><v-icon :icon="mdiGestureSwipeHorizontal" size="14" /> Two-finger horizontal: rotate</span>
        <span><v-icon :icon="mdiMouseScrollWheel" size="14" /> Wheel / two-finger vertical: zoom</span>
        <span><v-icon :icon="mdiMouseRightClickOutline" size="14" /> Right-drag: rotate</span>
      </div>

      <div v-if="machineCity" class="system-world__legend">
        <span>Building height and footprint follow indexed line count · cyan participation and gold implementation tethers come from Genesis implemented-by links</span>
        <span>Directory terraces follow native Genesis districts</span>
      </div>
    </div>

    <v-dialog
      :model-value="controlsIntroductionOpen"
      max-width="34rem"
      @update:model-value="setControlsIntroductionOpen"
    >
      <v-card rounded="xl">
        <v-card-title>Moving around the City</v-card-title>
        <v-card-text>
          <p class="system-world__controls-introduction-copy">
            Explore with a trackpad, mouse, or keyboard. Selecting an item inspects it without moving the camera.
          </p>
          <dl class="system-world__controls-introduction-list">
            <div>
              <dt><v-icon :icon="mdiGestureSwipeHorizontal" size="20" /> Trackpad</dt>
              <dd>Swipe horizontally with two fingers to rotate. Scroll vertically with two fingers to zoom.</dd>
            </div>
            <div>
              <dt><v-icon :icon="mdiMouse" size="20" /> Mouse</dt>
              <dd>Left-drag to move, right-drag to rotate, and use the wheel to zoom.</dd>
            </div>
            <div>
              <dt><v-icon :icon="mdiKeyboardOutline" size="20" /> Keyboard</dt>
              <dd>Use the arrow keys to move and W or S to zoom.</dd>
            </div>
          </dl>
        </v-card-text>
        <v-card-actions class="system-world__controls-introduction-actions">
          <v-btn
            color="primary"
            type="button"
            variant="flat"
            @click="setControlsIntroductionOpen(false)"
          >
            Got it
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRef,
  watch
} from "vue";
import {
  mdiAlertOutline,
  mdiArrowLeft,
  mdiArrowRight,
  mdiCityVariantOutline,
  mdiCrosshairsGps,
  mdiFileCodeOutline,
  mdiFolderOutline,
  mdiGestureSwipeHorizontal,
  mdiInformationOutline,
  mdiKeyboardOutline,
  mdiLayersTripleOutline,
  mdiMapMarkerPath,
  mdiMapOutline,
  mdiMouse,
  mdiMouseRightClickOutline,
  mdiMouseScrollWheel,
  mdiOrbit,
  mdiRefresh,
  mdiRotate3dVariant,
  mdiRotateLeft,
  mdiRotateRight
} from "@mdi/js";

import {
  useVibe64SystemGraph
} from "../composables/useVibe64SystemGraph.js";
import {
  createSystemWorld
} from "../world/createSystemWorld.js";
import {
  GENESIS_MACHINE_CITY_KIND,
  genesisCityWorld
} from "../world/genesisCityWorld.js";
import {
  topLevelPrecincts
} from "../world/worldLayout.js";
import {
  createWorldViewHistory
} from "../world/worldViewHistory.js";

const rendererRevision = "062";
const CITY_CONTROLS_INTRODUCTION_STORAGE_KEY = "vibe64:city-controls-introduction:v1";

const props = defineProps({
  active: {
    type: Boolean,
    default: false
  },
  restoreRequest: {
    type: Object,
    default: null
  },
  resolveRequestUrl: {
    type: Function,
    default: (value) => value
  },
  sessionId: {
    type: String,
    required: true
  }
});

const emit = defineEmits([
  "open-source-file-immersive",
  "open-source-file"
]);

const canvasElement = ref(null);
const controlsIntroductionOpen = ref(props.active && !cityControlsIntroductionSeen());
const chosenPresentationRegionId = ref("");
const hoveredImplementationBundle = ref(null);
const selectedBuildingId = ref("");
const selectedDistrict = ref(null);
const selectedSemanticOperationId = ref("");
const selectedSemanticSubsystemId = ref("");
const showImplementationLinks = ref(false);
const showSubsystems = ref(true);
const worldError = ref("");
const worldHistoryBusy = ref(false);
const worldView = ref("perspective");
const canNavigateWorldBack = ref(false);
const canNavigateWorldForward = ref(false);
let animationFrame = 0;
let resizeObserver = null;
let viewRotationPointer = null;
let world = null;
let overviewGeneration = 0;
let overviewPromise = Promise.resolve();
let applyingRestoreRequest = false;
const worldViewHistory = createWorldViewHistory({ limit: 64 });

const {
  error,
  loading,
  machineCity,
  programCity,
  refresh,
  refreshing,
  reload,
  systemStatus
} = useVibe64SystemGraph({
  active: toRef(props, "active"),
  sessionId: toRef(props, "sessionId")
});

const worldOverview = computed(() => genesisCityWorld(machineCity.value, GENESIS_MACHINE_CITY_KIND, {
  machineCity: machineCity.value,
  programCity: programCity.value
}));
const buildings = computed(() => machineCity.value?.buildings || []);
const machineNavigatorRegions = computed(() => machineCity.value?.presentationRegions || []);
const activePresentationRegionId = computed(() => (
  chosenPresentationRegionId.value || machineNavigatorRegions.value[0]?.id || ""
));
const machineNavigatorDistricts = computed(() => {
  if (machineNavigatorRegions.value.length > 0) {
    const districtsById = new Map((machineCity.value?.districts || []).map((district) => [
      district.id,
      district
    ]));
    return (machineCity.value?.presentationCampuses || [])
      .filter((campus) => campus.regionId === activePresentationRegionId.value)
      .map((campus) => districtsById.get(campus.districtId))
      .filter(Boolean)
      .sort((left, right) => left.title.localeCompare(right.title));
  }
  return topLevelPrecincts(machineCity.value);
});
const machineNavigatorSections = computed(() => {
  if (!selectedDistrict.value?.id) {
    return [];
  }
  const districts = Array.isArray(machineCity.value?.districts)
    ? machineCity.value.districts
    : [];
  return districts
    .filter((district) => district.parentId === selectedDistrict.value.id)
    .sort((left, right) => left.title.localeCompare(right.title));
});
const selectedBuilding = computed(() => (
  buildings.value.find((building) => building.id === selectedBuildingId.value) || null
));
const semanticSubsystems = computed(() => worldOverview.value?.semantic?.subsystems || []);
const semanticSubsystemsById = computed(() => new Map(
  semanticSubsystems.value.map((subsystem) => [subsystem.id, subsystem])
));
const machineDistrictsById = computed(() => new Map(
  (machineCity.value?.districts || []).map((district) => [district.id, district])
));
const semanticOperations = computed(() => worldOverview.value?.semantic?.operations || []);
const selectedSemanticSubsystem = computed(() => (
  semanticSubsystems.value.find((subsystem) => subsystem.id === selectedSemanticSubsystemId.value) || null
));
const selectedSemanticOperation = computed(() => (
  semanticOperations.value.find((operation) => operation.id === selectedSemanticOperationId.value) || null
));
const functionsById = computed(() => new Map(
  (machineCity.value?.functions || []).map((entry) => [entry.id, entry])
));
const selectedFunctions = computed(() => (
  selectedBuilding.value
    ? selectedBuilding.value.functionIds.map((id) => functionsById.value.get(id)).filter(Boolean)
    : []
));
const cityAvailability = computed(() => systemStatus.value?.cities?.machine || { state: "missing" });
const cityTitle = "Machine City";
const statusLabel = computed(() => machineCity.value
  ? `${formatCount(machineCity.value.buildings.length, "file")} · ${formatCount(machineCity.value.functions.length, "function")}`
  : cityAvailability.value.state || systemStatus.value.status || "loading");
const machineBuildingsByPath = computed(() => new Map(
  (machineCity.value?.buildings || []).map((building) => [building.path, building])
));

function cityControlsIntroductionSeen() {
  try {
    return typeof window !== "undefined" &&
      window.localStorage?.getItem(CITY_CONTROLS_INTRODUCTION_STORAGE_KEY) === "seen";
  } catch {
    return false;
  }
}

function setControlsIntroductionOpen(open) {
  controlsIntroductionOpen.value = open === true;
  if (controlsIntroductionOpen.value) {
    return;
  }
  try {
    window.localStorage?.setItem(CITY_CONTROLS_INTRODUCTION_STORAGE_KEY, "seen");
  } catch {
    // Browser storage may be unavailable in private or constrained contexts.
  }
}

function formatCount(value = 0, singular = "item", plural = `${singular}s`) {
  const count = Math.max(0, Number(value) || 0);
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function formatNumber(value = 0) {
  return Math.max(0, Number(value) || 0).toLocaleString();
}

function formatBytes(value = 0) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
}

function renderFrame(time) {
  animationFrame = 0;
  const shouldContinue = world?.frame(time) === true;
  if (shouldContinue) {
    startRenderLoop();
  }
}

function startRenderLoop() {
  if (!animationFrame && props.active && world) {
    animationFrame = requestAnimationFrame(renderFrame);
  }
}

function stopRenderLoop() {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function resizeWorld() {
  const canvas = canvasElement.value;
  if (!canvas || !world) {
    return;
  }
  const bounds = canvas.getBoundingClientRect();
  world.resize(bounds.width, bounds.height);
}

function syncWorldHistoryAvailability() {
  canNavigateWorldBack.value = worldViewHistory.canBack;
  canNavigateWorldForward.value = worldViewHistory.canForward;
}

function sourceNavigationContext() {
  return {
    camera: world?.captureView() || null,
    cityKind: GENESIS_MACHINE_CITY_KIND,
    selectedBuildingId: selectedBuildingId.value,
    selectedDistrictId: selectedDistrict.value?.id || "",
    selectedOperationId: selectedSemanticOperationId.value,
    selectedSubsystemId: selectedSemanticSubsystemId.value,
    semanticImplementationsVisible: showImplementationLinks.value,
    semanticSubsystemsVisible: showSubsystems.value,
    view: worldView.value
  };
}

function recordWorldNavigation() {
  if (!worldOverview.value || applyingRestoreRequest || worldHistoryBusy.value) {
    return false;
  }
  const recorded = worldViewHistory.record(sourceNavigationContext());
  syncWorldHistoryAvailability();
  return recorded;
}

function clearSelection() {
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  selectedSemanticOperationId.value = "";
  selectedSemanticSubsystemId.value = "";
  world?.clearSelection();
}

function handleBuildingPick(selection = {}) {
  if (!selection.buildingId) {
    return;
  }
  recordWorldNavigation();
  selectedBuildingId.value = selection.buildingId;
  const building = buildings.value.find((entry) => entry.id === selection.buildingId);
  chosenPresentationRegionId.value = building?.presentationRegionId || chosenPresentationRegionId.value;
  selectedDistrict.value = null;
  selectedSemanticOperationId.value = "";
  selectedSemanticSubsystemId.value = "";
}

function handleDistrictPick(district = null) {
  recordWorldNavigation();
  selectedBuildingId.value = "";
  selectedDistrict.value = district;
  chosenPresentationRegionId.value = district?.presentationRegionId || chosenPresentationRegionId.value;
  selectedSemanticOperationId.value = "";
  selectedSemanticSubsystemId.value = "";
}

function handleSemanticSubsystemPick(subsystem = null) {
  recordWorldNavigation();
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  selectedSemanticOperationId.value = "";
  selectedSemanticSubsystemId.value = subsystem?.id || "";
}

function handleSemanticOperationPick(operation = null) {
  recordWorldNavigation();
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  selectedSemanticOperationId.value = operation?.id || "";
  selectedSemanticSubsystemId.value = operation?.subsystemId || operation?.districtId || "";
}

function handleClearSelection() {
  if (
    selectedBuildingId.value || selectedDistrict.value ||
    selectedSemanticOperationId.value || selectedSemanticSubsystemId.value
  ) {
    recordWorldNavigation();
  }
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  selectedSemanticOperationId.value = "";
  selectedSemanticSubsystemId.value = "";
}

function handleImplementationBundleHover(bundle = null) {
  hoveredImplementationBundle.value = bundle;
}

function openPayload(path = "", {
  column = 0,
  immersive = false,
  line = 0
} = {}) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    return null;
  }
  const building = locateBuilding(normalizedPath);
  const returnView = world?.captureView() || null;
  return {
    anchor: immersive && building
      ? world?.buildingScreenRect(building.id) || null
      : null,
    buildingId: building?.id || "",
    column: Math.max(0, Number(column) || 0),
    line: Math.max(0, Number(line) || 0),
    origin: "system",
    path: normalizedPath,
    returnView,
    systemContext: sourceNavigationContext()
  };
}

function openSourceFile(path = "", location = {}) {
  const payload = openPayload(path, location);
  if (payload) {
    emit("open-source-file", payload);
  }
}

function handleImmersiveFileOpen(selection = {}) {
  const payload = openPayload(selection.path, { immersive: true });
  if (payload) {
    emit("open-source-file-immersive", {
      ...payload,
      anchor: selection.anchor || payload.anchor,
      returnView: selection.returnView || payload.returnView
    });
  }
}

async function createWorld() {
  if (!canvasElement.value || world) {
    return;
  }
  try {
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    world = createSystemWorld({
      canvas: canvasElement.value,
      onClearSelection: handleClearSelection,
      onHoverImplementationBundle: handleImplementationBundleHover,
      onInvalidate: startRenderLoop,
      onOpenBuilding: handleImmersiveFileOpen,
      onSelectBuilding: handleBuildingPick,
      onSelectDistrict: handleDistrictPick,
      onSelectOperation: handleSemanticOperationPick,
      onSelectSubsystem: handleSemanticSubsystemPick,
      reducedMotion
    });
    resizeObserver = new ResizeObserver(resizeWorld);
    resizeObserver.observe(canvasElement.value);
    resizeWorld();
    startRenderLoop();
    if (worldOverview.value) {
      await world.setOverview(worldOverview.value);
    }
  } catch (caught) {
    worldError.value = String(caught?.message || caught || "WebGL could not start.");
  }
}

async function applyOverview(nextOverview) {
  if (!world) {
    await createWorld();
    return;
  }
  world.setActive(props.active);
  resizeWorld();
  // Suspension can leave the world dirty, so resuming needs an explicit frame.
  startRenderLoop();
  const generation = ++overviewGeneration;
  const previousView = world.captureView();
  try {
    await world.setOverview(nextOverview);
    if (generation !== overviewGeneration) {
      return;
    }
    if (selectedBuilding.value) {
      world.selectBuilding(selectedBuilding.value.id);
    } else if (selectedDistrict.value) {
      world.selectDistrict(selectedDistrict.value.id);
    } else if (selectedSemanticOperation.value) {
      world.selectOperation(selectedSemanticOperation.value.id);
    } else if (selectedSemanticSubsystem.value) {
      world.selectSubsystem(selectedSemanticSubsystem.value.id);
    }
    world.setSemanticLayers({
      implementations: showImplementationLinks.value,
      subsystems: showSubsystems.value
    });
    if (previousView.position) {
      world.restoreView(previousView);
    }
  } catch (caught) {
    worldError.value = String(caught?.message || caught);
  }
}

function inspectDistrict(district) {
  if (!district?.id) {
    return;
  }
  recordWorldNavigation();
  selectedBuildingId.value = "";
  selectedDistrict.value = world?.selectDistrict(district.id) || district;
  chosenPresentationRegionId.value = district.presentationRegionId || chosenPresentationRegionId.value;
  selectedSemanticOperationId.value = "";
  selectedSemanticSubsystemId.value = "";
}

function selectPresentationRegion(region) {
  if (region?.id) {
    chosenPresentationRegionId.value = region.id;
  }
}

function inspectSemanticSubsystem(subsystem) {
  if (!subsystem?.id) {
    return;
  }
  recordWorldNavigation();
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  selectedSemanticOperationId.value = "";
  selectedSemanticSubsystemId.value = subsystem.id;
  world?.selectSubsystem(subsystem.id);
}

function inspectSemanticOperation(operation) {
  if (!operation?.id) {
    return;
  }
  recordWorldNavigation();
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  selectedSemanticOperationId.value = operation.id;
  selectedSemanticSubsystemId.value = operation.subsystemId || operation.districtId || "";
  world?.selectOperation(operation.id);
}

function focusCurrentSelection() {
  if (!world) {
    return false;
  }
  recordWorldNavigation();
  if (selectedSemanticOperation.value) {
    return world.focusOperation(selectedSemanticOperation.value.id);
  }
  if (selectedSemanticSubsystem.value) {
    return world.focusSubsystem(selectedSemanticSubsystem.value.id);
  }
  if (selectedBuilding.value) {
    return world.focusBuilding(selectedBuilding.value.id);
  }
  if (selectedDistrict.value) {
    return world.focusDistrict(selectedDistrict.value.id);
  }
  return false;
}

function toggleSemanticLayer(layer) {
  recordWorldNavigation();
  if (layer === "subsystems") {
    showSubsystems.value = !showSubsystems.value;
  } else if (layer === "implementations") {
    showImplementationLinks.value = !showImplementationLinks.value;
    if (showImplementationLinks.value) {
      showSubsystems.value = true;
    }
  }
  world?.setSemanticLayers({
    implementations: showImplementationLinks.value,
    subsystems: showSubsystems.value
  });
}

function fitWorld() {
  recordWorldNavigation();
  void world?.fitWorld();
}

function setWorldView(view) {
  recordWorldNavigation();
  worldView.value = view;
  world?.setView(view);
}

function rotateWorld(degrees) {
  recordWorldNavigation();
  world?.rotateView(degrees, 0, true);
}

function startViewRotation(event) {
  if (event.button !== 0) {
    return;
  }
  recordWorldNavigation();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  viewRotationPointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY
  };
  event.preventDefault();
}

function continueViewRotation(event) {
  if (!viewRotationPointer || viewRotationPointer.id !== event.pointerId) {
    return;
  }
  const horizontalDelta = event.clientX - viewRotationPointer.x;
  const verticalDelta = event.clientY - viewRotationPointer.y;
  viewRotationPointer.x = event.clientX;
  viewRotationPointer.y = event.clientY;
  world?.rotateView(-horizontalDelta * 0.45, -verticalDelta * 0.28, false);
  event.preventDefault();
}

function endViewRotation(event) {
  if (!viewRotationPointer || viewRotationPointer.id !== event.pointerId) {
    return;
  }
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  viewRotationPointer = null;
}

async function refreshCities() {
  worldError.value = "";
  try {
    await refresh();
  } catch (caught) {
    worldError.value = String(caught?.message || caught || "Genesis Cities could not be refreshed.");
  }
}

async function navigateWorldHistory(direction) {
  if (!worldOverview.value || worldHistoryBusy.value) {
    return;
  }
  const currentView = sourceNavigationContext();
  const targetView = direction === "forward"
    ? worldViewHistory.forward(currentView)
    : worldViewHistory.back(currentView);
  syncWorldHistoryAvailability();
  if (!targetView) {
    return;
  }
  worldHistoryBusy.value = true;
  try {
    await applyRestoreRequest(targetView);
  } finally {
    worldHistoryBusy.value = false;
    syncWorldHistoryAvailability();
  }
}

async function applyRestoreRequest(request = {}) {
  if (!request || !world) {
    return false;
  }
  applyingRestoreRequest = true;
  try {
    worldView.value = request.view === "top" ? "top" : "perspective";
    world.setView(worldView.value);
    clearSelection();
    showSubsystems.value = request.semanticSubsystemsVisible !== false;
    showImplementationLinks.value = request.semanticImplementationsVisible === true;
    world.setSemanticLayers({
      implementations: showImplementationLinks.value,
      subsystems: showSubsystems.value
    });
    if (request.selectedBuildingId && buildings.value.some((building) => building.id === request.selectedBuildingId)) {
      selectedBuildingId.value = request.selectedBuildingId;
      world.selectBuilding(request.selectedBuildingId);
      world.focusBuilding(request.selectedBuildingId);
    } else if (request.selectedDistrictId) {
      const district = machineCity.value?.districts.find((entry) => entry.id === request.selectedDistrictId);
      if (district) {
        selectedDistrict.value = world.selectDistrict(district.id) || district;
        world.focusDistrict(district.id);
      }
    } else if (request.selectedOperationId) {
      const operation = semanticOperations.value.find((entry) => entry.id === request.selectedOperationId);
      if (operation) {
        selectedSemanticOperationId.value = operation.id;
        selectedSemanticSubsystemId.value = operation.subsystemId || operation.districtId || "";
        world.selectOperation(operation.id);
        world.focusOperation(operation.id);
      }
    } else if (request.selectedSubsystemId) {
      const subsystem = semanticSubsystems.value.find((entry) => entry.id === request.selectedSubsystemId);
      if (subsystem) {
        selectedSemanticSubsystemId.value = subsystem.id;
        world.selectSubsystem(subsystem.id);
        world.focusSubsystem(subsystem.id);
      }
    }
    if (request.camera) {
      world.restoreView(request.camera);
    }
    return true;
  } finally {
    applyingRestoreRequest = false;
  }
}

function locateBuilding(path = "") {
  return machineBuildingsByPath.value.get(String(path || "")) || null;
}

function hasImmersiveFile(path = "") {
  return Boolean(locateBuilding(path));
}

function immersiveFileAnchor(path = "") {
  const building = locateBuilding(path);
  return building
    ? world?.buildingScreenRect(building.id) || null
    : null;
}

function closeImmersiveFilePortal({ immediate = false } = {}) {
  world?.endBuildingPortal({ immediate });
}

async function restoreImmersiveView(view = null, { immediate = false } = {}) {
  if (!world || !view) {
    return false;
  }
  return immediate ? world.restoreView(view) : world.flyToView(view);
}

async function travelImmersiveFile(path = "") {
  const building = locateBuilding(path);
  if (!building || !world || worldHistoryBusy.value) {
    return null;
  }
  recordWorldNavigation();
  worldHistoryBusy.value = true;
  try {
    selectedBuildingId.value = building.id;
    selectedDistrict.value = null;
    selectedSemanticOperationId.value = "";
    selectedSemanticSubsystemId.value = "";
    world.selectBuilding(building.id);
    const anchor = await world.flyToBuilding(building.id);
    world.beginBuildingPortal(building.id);
    return {
      anchor: world.buildingScreenRect(building.id) || anchor,
      buildingId: building.id,
      path: building.path
    };
  } finally {
    worldHistoryBusy.value = false;
    syncWorldHistoryAvailability();
  }
}

watch(worldOverview, (nextOverview) => {
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  if (!nextOverview) {
    world?.clearOverview();
    overviewPromise = Promise.resolve();
    return;
  }
  overviewPromise = nextTick().then(() => applyOverview(nextOverview));
}, { flush: "post" });

watch(() => props.active, (active) => {
  world?.setActive(active);
  if (active) {
    if (!cityControlsIntroductionSeen()) {
      controlsIntroductionOpen.value = true;
    }
    resizeWorld();
    startRenderLoop();
  } else {
    stopRenderLoop();
  }
});

watch(() => props.restoreRequest, (request) => {
  if (request && props.active) {
    void overviewPromise.then(() => applyRestoreRequest(request));
  }
}, { deep: true });

watch(() => props.sessionId, () => {
  worldViewHistory.clear();
  syncWorldHistoryAvailability();
  selectedBuildingId.value = "";
  chosenPresentationRegionId.value = "";
  selectedDistrict.value = null;
  selectedSemanticOperationId.value = "";
  selectedSemanticSubsystemId.value = "";
  showImplementationLinks.value = false;
  showSubsystems.value = true;
});

onMounted(async () => {
  await createWorld();
  if (props.restoreRequest) await applyRestoreRequest(props.restoreRequest);
});

onBeforeUnmount(() => {
  stopRenderLoop();
  resizeObserver?.disconnect();
  world?.dispose();
  world = null;
});

defineExpose({
  closeImmersiveFilePortal,
  hasImmersiveFile,
  immersiveFileAnchor,
  restoreImmersiveView,
  travelImmersiveFile
});
</script>

<style scoped>
.system-world {
  --city-blue: #56d8ff;
  background: #050914;
  color: #f4f8ff;
  contain: layout paint style;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.system-world__toolbar {
  align-items: center;
  background: linear-gradient(90deg, rgba(11, 20, 40, 0.98), rgba(7, 13, 28, 0.98));
  border-bottom: 1px solid rgba(121, 180, 225, 0.2);
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 3.5rem;
  padding: 0.55rem 0.75rem;
}

.system-world__identity,
.system-world__view-actions,
.system-world__controls-hint,
.system-world__legend,
.system-world__chips,
.system-world__metrics,
.system-world__inspector-actions {
  align-items: center;
  display: flex;
}

.system-world__identity { gap: 0.58rem; min-width: 0; }
.system-world__identity > div { display: grid; min-width: 0; }
.system-world__identity strong { font-size: 0.82rem; }
.system-world__identity span { color: rgba(217, 232, 255, 0.55); font-size: 0.62rem; }
.system-world__mark { align-items: center; background: rgba(86, 216, 255, 0.13); border: 1px solid rgba(86, 216, 255, 0.28); border-radius: 0.55rem; color: var(--city-blue); display: inline-flex; height: 2rem; justify-content: center; width: 2rem; }
.system-world__view-actions { gap: 0.16rem; justify-content: flex-end; }

.system-world__stage { contain: layout paint; min-height: 0; overflow: hidden; position: relative; }
.system-world__canvas {
  background: radial-gradient(circle at 24% 38%, rgba(31, 109, 153, 0.2), transparent 34%), linear-gradient(#080e1e, #040711);
  cursor: move;
  contain: strict;
  display: block;
  height: 100%;
  outline: none;
  width: 100%;
}
.system-world__canvas:active { cursor: grabbing; }
.system-world__canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--city-blue); }

.system-world__connection-tooltip {
  background: rgba(5, 9, 18, 0.96);
  border: 1px solid rgba(241, 245, 249, 0.42);
  border-radius: 0.55rem;
  box-shadow: 0 0.8rem 2.4rem rgba(0, 0, 0, 0.42);
  display: grid;
  gap: 0.16rem;
  max-width: 16rem;
  padding: 0.48rem 0.58rem;
  pointer-events: none;
  position: absolute;
  transform: translateY(-100%);
  z-index: 14;
}
.system-world__connection-tooltip > span { color: rgba(120, 222, 255, 0.72); font-size: 0.48rem; letter-spacing: 0.08em; text-transform: uppercase; }
.system-world__connection-tooltip > strong { color: #fff; font-size: 0.65rem; overflow-wrap: anywhere; }
.system-world__connection-tooltip > code { color: rgba(218, 230, 248, 0.66); font-size: 0.5rem; overflow-wrap: anywhere; }
.system-world__connection-tooltip > small { color: rgba(255, 224, 138, 0.68); font-size: 0.5rem; margin-top: 0.12rem; }

.system-world__state-card {
  align-items: center;
  backdrop-filter: blur(24px);
  background: rgba(8, 14, 31, 0.92);
  border: 1px solid rgba(114, 183, 228, 0.24);
  border-radius: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  left: 50%;
  max-width: 31rem;
  padding: 1.6rem 2rem;
  position: absolute;
  text-align: center;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 12;
}
.system-world__state-card > span { color: rgba(223, 234, 255, 0.64); font-size: 0.79rem; }
.system-world__state-card--error { border-color: rgba(255, 93, 120, 0.46); }
.system-world__state-skeleton { background: transparent; width: min(18rem, 70vw); }

.system-world__progress {
  align-items: center;
  backdrop-filter: blur(12px);
  background: rgba(11, 28, 48, 0.9);
  border: 1px solid rgba(53, 208, 255, 0.3);
  border-radius: 999px;
  bottom: 4.5rem;
  display: flex;
  font-size: 0.68rem;
  gap: 0.42rem;
  left: 50%;
  padding: 0.4rem 0.72rem;
  position: absolute;
  transform: translateX(-50%);
  z-index: 8;
}
.system-world__progress-pulse { animation: system-pulse 1s ease-in-out infinite; background: var(--city-blue); border-radius: 50%; height: 0.42rem; width: 0.42rem; }
@keyframes system-pulse { 50% { opacity: 0.25; transform: scale(0.7); } }

.system-world__layer-controls { align-items: center; backdrop-filter: blur(14px); background: rgba(7, 13, 27, 0.9); border: 1px solid rgba(132, 164, 219, 0.2); border-radius: 0.55rem; display: flex; gap: 0.2rem; left: 50%; padding: 0.18rem; position: absolute; top: 0.65rem; transform: translateX(-50%); z-index: 10; }
.system-world__layer-controls > span { color: rgba(218, 232, 255, 0.44); font-size: 0.48rem; padding: 0 0.28rem; text-transform: uppercase; }
.system-world__layer-controls > button { background: rgba(123, 148, 191, 0.08); border: 1px solid transparent; border-radius: 0.38rem; color: rgba(218, 232, 255, 0.66); cursor: pointer; font: inherit; font-size: 0.52rem; padding: 0.3rem 0.48rem; }
.system-world__layer-controls > button:hover,
.system-world__layer-controls > button:focus-visible { background: rgba(93, 188, 238, 0.14); color: #fff; }
.system-world__layer-controls > button.system-world__layer-control--active { background: rgba(83, 205, 241, 0.2); border-color: rgba(103, 223, 255, 0.42); color: #fff; }
.system-world__layer-controls > button:disabled { cursor: default; opacity: 0.34; }

.system-world__navigator {
  backdrop-filter: blur(16px);
  background: rgba(7, 13, 27, 0.82);
  border: 1px solid rgba(132, 164, 219, 0.16);
  border-radius: 0.85rem;
  display: flex;
  flex-direction: column;
  left: 0.7rem;
  max-height: calc(100% - 7rem);
  overflow-y: auto;
  padding: 0.36rem;
  position: absolute;
  top: 0.7rem;
  width: min(17rem, 28%);
  z-index: 8;
}
.system-world__navigator header { align-items: center; color: rgba(218, 232, 255, 0.52); display: flex; font-size: 0.57rem; justify-content: space-between; letter-spacing: 0.12em; padding: 0.32rem 0.45rem; text-transform: uppercase; }
.system-world__navigator button { align-items: center; background: transparent; border: 0; border-radius: 0.5rem; color: rgba(231, 239, 255, 0.76); cursor: pointer; display: grid; font: inherit; gap: 0.42rem; grid-template-columns: auto minmax(0, 1fr); padding: 0.38rem 0.42rem; text-align: left; }
.system-world__navigator button:hover,
.system-world__navigator button:focus-visible,
.system-world__navigator-button--active { background: rgba(93, 188, 238, 0.14) !important; color: #fff !important; }
.system-world__navigator button > span { display: grid; min-width: 0; }
.system-world__navigator button strong,
.system-world__navigator button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.system-world__navigator button strong { font-size: 0.65rem; }
.system-world__navigator button small { color: rgba(201, 218, 242, 0.48); font-size: 0.53rem; }

.system-world__inspector {
  backdrop-filter: blur(22px);
  background: linear-gradient(155deg, rgba(11, 20, 40, 0.96), rgba(6, 10, 23, 0.92));
  border: 1px solid rgba(141, 176, 230, 0.21);
  border-radius: 1rem;
  box-shadow: 0 1.2rem 4rem rgba(0, 0, 0, 0.34);
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  width: min(24rem, 38%);
  z-index: 10;
}
.system-world__inspector { max-height: calc(100% - 6rem); overflow-y: auto; padding: 1rem; }
.system-world__eyebrow { color: var(--city-blue); font-size: 0.58rem; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; }
.system-world__inspector h2 { font-size: 1.08rem; line-height: 1.22; margin: 0.3rem 0 0.42rem; }
.system-world__inspector p { color: rgba(225, 235, 255, 0.7); font-size: 0.72rem; line-height: 1.48; }
.system-world__path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.system-world__chips,
.system-world__metrics,
.system-world__inspector-actions { flex-wrap: wrap; gap: 0.42rem; }
.system-world__chips span { background: rgba(114, 157, 223, 0.12); border: 1px solid rgba(127, 178, 236, 0.16); border-radius: 999px; color: rgba(226, 238, 255, 0.8); font-size: 0.58rem; padding: 0.22rem 0.48rem; text-transform: uppercase; }
.system-world__metrics { border-bottom: 1px solid rgba(133, 166, 220, 0.12); border-top: 1px solid rgba(133, 166, 220, 0.12); margin: 0.75rem 0; padding: 0.58rem 0; }
.system-world__metrics span { color: rgba(208, 222, 248, 0.58); display: grid; font-size: 0.56rem; min-width: 5rem; text-transform: uppercase; }
.system-world__metrics strong { color: #fff; font-size: 0.78rem; }
.system-world__section { border-top: 1px solid rgba(133, 166, 220, 0.12); display: grid; gap: 0.34rem; margin-top: 0.7rem; padding-top: 0.65rem; }
.system-world__section > strong { font-size: 0.64rem; letter-spacing: 0.05em; text-transform: uppercase; }
.system-world__section ul { display: grid; gap: 0.28rem; list-style: none; margin: 0; padding: 0; }
.system-world__section li { background: rgba(92, 133, 191, 0.08); border-radius: 0.45rem; display: grid; gap: 0.08rem; padding: 0.42rem 0.5rem; }
.system-world__section li strong { font-size: 0.64rem; }
.system-world__section li span { color: rgba(208, 222, 244, 0.56); font-size: 0.58rem; }
.system-world__function-link { background: transparent; border: 0; color: inherit; cursor: pointer; display: grid; font: inherit; gap: 0.08rem; padding: 0; text-align: left; }
.system-world__function-link:hover strong,
.system-world__function-link:focus-visible strong { color: var(--city-blue); }
.system-world__section pre { background: rgba(3, 8, 17, 0.48); border-radius: 0.45rem; color: rgba(226, 237, 253, 0.78); font: 0.62rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; overflow-wrap: anywhere; padding: 0.55rem; white-space: pre-wrap; }
.system-world__source-link { background: rgba(86, 216, 255, 0.08); border: 1px solid rgba(86, 216, 255, 0.16); border-radius: 0.4rem; color: rgba(220, 241, 255, 0.82); cursor: pointer; font: 0.58rem ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; padding: 0.4rem 0.48rem; text-align: left; }
.system-world__source-link:hover { background: rgba(86, 216, 255, 0.15); }
.system-world__operation-link { align-items: center; background: rgba(92, 133, 191, 0.08); border: 1px solid transparent; border-radius: 0.45rem; color: inherit; cursor: pointer; display: flex; font: inherit; justify-content: space-between; padding: 0.44rem 0.5rem; text-align: left; }
.system-world__operation-link:hover,
.system-world__operation-link:focus-visible { background: rgba(86, 216, 255, 0.14); border-color: rgba(86, 216, 255, 0.22); }
.system-world__operation-link strong { font-size: 0.64rem; }
.system-world__operation-link span { color: rgba(208, 222, 244, 0.56); font-size: 0.54rem; }
.system-world__inspector-actions { margin-top: 0.8rem; }

.system-world__view-gizmo { align-items: center; background: rgba(7, 13, 27, 0.9); border: 1px solid rgba(125, 201, 239, 0.26); border-radius: 999px; bottom: 2.3rem; display: flex; gap: 0.2rem; left: 50%; padding: 0.22rem; position: absolute; transform: translateX(-50%); z-index: 9; }
.system-world__view-gizmo button { align-items: center; background: transparent; border: 0; border-radius: 50%; color: rgba(224, 239, 255, 0.72); cursor: pointer; display: inline-flex; height: 1.75rem; justify-content: center; padding: 0; width: 1.75rem; }
.system-world__view-gizmo button:hover { background: rgba(86, 216, 255, 0.15); color: #fff; }
.system-world__view-gizmo-puck { border: 1px solid rgba(86, 216, 255, 0.34) !important; cursor: grab !important; position: relative; touch-action: none; }
.system-world__view-gizmo-puck span { color: var(--city-blue); font-size: 0.42rem; font-weight: 800; left: 50%; position: absolute; top: 0.08rem; transform: translateX(-50%); }

.system-world__controls-hint,
.system-world__legend { backdrop-filter: blur(12px); background: rgba(5, 10, 21, 0.72); border: 1px solid rgba(128, 170, 222, 0.13); border-radius: 0.55rem; bottom: 0.55rem; color: rgba(210, 226, 247, 0.55); font-size: 0.55rem; gap: 0.65rem; padding: 0.35rem 0.55rem; position: absolute; }
.system-world__controls-hint { flex-wrap: wrap; left: 0.65rem; max-width: calc(100% - 1.3rem); }
.system-world__legend { right: 0.65rem; }

.system-world__controls-introduction-copy { line-height: 1.55; margin: 0 0 1rem; }
.system-world__controls-introduction-list { display: grid; gap: 0.85rem; margin: 0; }
.system-world__controls-introduction-list > div { display: grid; gap: 0.2rem; }
.system-world__controls-introduction-list dt { align-items: center; display: flex; font-weight: 650; gap: 0.5rem; }
.system-world__controls-introduction-list dd { color: rgba(var(--v-theme-on-surface), 0.72); line-height: 1.5; margin: 0 0 0 1.75rem; }
.system-world__controls-introduction-actions { justify-content: flex-end; padding: 0 1.5rem 1.25rem; }

@media (max-width: 920px) {
  .system-world__toolbar { grid-template-columns: 1fr auto; }
  .system-world__navigator { width: min(14rem, 38%); }
  .system-world__inspector { width: min(20rem, 48%); }
  .system-world__legend { display: none; }
}
</style>
