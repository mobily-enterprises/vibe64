<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useSlots
} from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  normalizeRoutePath,
  routePathContainsSection
} from "@/lib/routeActiveState.js";

const props = defineProps({
  navigationCollapsed: { type: Boolean, default: false },
  // The guide place this section navigation opens into: a lesson's "Show me"
  // rings the menu (or, on a phone, the section select) to pick the next step.
  navigationGuidePane: { type: String, default: "" },
  title: {
    type: String,
    default: ""
  },
  subtitle: {
    type: String,
    default: ""
  },
  mobileSectionLinks: {
    type: Array,
    default: () => []
  }
});

const MOBILE_SECTION_MEDIA_QUERY = "(max-width: 760px)";
const slots = useSlots();
const route = useRoute();
const router = useRouter();
const mobileSectionLayout = ref(initialMobileSectionLayout());
let mobileSectionMediaQuery = null;
const resolvedTitle = computed(() => String(props.title || "").trim());
const resolvedSubtitle = computed(() => String(props.subtitle || "").trim());
const hasHeading = computed(() => Boolean(resolvedTitle.value || resolvedSubtitle.value));
const hasTabs = computed(() => Boolean(slots.tabs));
const mobileSectionLinks = computed(() => {
  return props.mobileSectionLinks
    .map((link) => ({
      disabled: link?.disabled === true,
      icon: String(link?.icon || ""),
      id: String(link?.id || link?.to || link?.label || ""),
      label: String(link?.label || ""),
      to: normalizeRoutePath(link?.to || "")
    }))
    .filter((link) => Boolean(link.id && link.label && link.to));
});
const mobileSectionsActive = computed(() => Boolean(
  mobileSectionLayout.value &&
  mobileSectionLinks.value.length
));
const activeMobileSection = computed(() => {
  return mobileSectionLinks.value.find((link) => routePathContainsSection(route.path || "", link.to)) || null;
});
const activeMobileSectionValue = computed(() => activeMobileSection.value?.to || null);

function initialMobileSectionLayout() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_SECTION_MEDIA_QUERY).matches;
}

function syncMobileSectionLayout() {
  mobileSectionLayout.value = Boolean(mobileSectionMediaQuery?.matches);
}

function selectMobileSection(value = "") {
  const targetPath = normalizeRoutePath(value || "");
  if (!targetPath || targetPath === activeMobileSectionValue.value) {
    return;
  }
  const targetLink = mobileSectionLinks.value.find((link) => link.to === targetPath);
  if (!targetLink || targetLink.disabled) {
    return;
  }
  void router.push(targetLink.to);
}

onMounted(() => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  mobileSectionMediaQuery = window.matchMedia(MOBILE_SECTION_MEDIA_QUERY);
  syncMobileSectionLayout();
  if (typeof mobileSectionMediaQuery.addEventListener === "function") {
    mobileSectionMediaQuery.addEventListener("change", syncMobileSectionLayout);
  } else {
    mobileSectionMediaQuery.addListener?.(syncMobileSectionLayout);
  }
});

onBeforeUnmount(() => {
  if (typeof mobileSectionMediaQuery?.removeEventListener === "function") {
    mobileSectionMediaQuery.removeEventListener("change", syncMobileSectionLayout);
  } else {
    mobileSectionMediaQuery?.removeListener?.(syncMobileSectionLayout);
  }
  mobileSectionMediaQuery = null;
});
</script>

<template>
  <section class="section-container-shell" :class="{ 'section-container-shell--with-heading': hasHeading, 'section-container-shell--collapsed': navigationCollapsed }">
    <header v-if="hasHeading" class="section-container-shell__heading">
      <h1 v-if="resolvedTitle" class="section-container-shell__title">{{ resolvedTitle }}</h1>
      <p v-if="resolvedSubtitle" class="text-body-2 text-medium-emphasis mb-0">{{ resolvedSubtitle }}</p>
    </header>

    <v-sheet
      :rounded="navigationCollapsed ? 0 : 'xl'"
      :border="!navigationCollapsed"
      class="section-container-shell__panel"
    >
      <div class="section-container-shell__body">
        <v-select
          v-if="mobileSectionsActive && !navigationCollapsed"
          class="section-container-shell__mobile-select"
          :data-vibe64-guide-pane="navigationGuidePane || undefined"
          :model-value="activeMobileSectionValue"
          :items="mobileSectionLinks"
          item-title="label"
          item-value="to"
          :item-props="(item) => ({ disabled: item.disabled, prependIcon: item.icon || undefined })"
          :prepend-inner-icon="activeMobileSection?.icon || undefined"
          label="Dashboard section"
          rounded="lg"
          variant="outlined"
          hide-details
          @update:model-value="selectMobileSection"
        />
        <nav
          v-if="hasTabs && !mobileSectionsActive && !navigationCollapsed"
          class="section-container-shell__nav"
          :data-vibe64-guide-pane="navigationGuidePane || undefined"
          aria-label="Dashboard sections"
        >
          <v-list
            nav
            bg-color="transparent"
            density="compact"
          >
            <slot name="tabs" />
          </v-list>
        </nav>

        <main class="section-container-shell__content">
          <slot />
        </main>
      </div>
    </v-sheet>
  </section>
</template>

<style scoped>
.section-container-shell {
  display: grid;
  gap: 0.85rem;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.section-container-shell--with-heading {
  grid-template-rows: auto minmax(0, 1fr);
}

.section-container-shell__heading {
  min-width: 0;
}

.section-container-shell__title {
  font: var(--v64-type-title-lg);
  letter-spacing: 0;
  margin: 0 0 var(--v64-space-1);
}

.section-container-shell__panel {
  background: var(--v64-surface-container-lowest);
  border-color: var(--v64-outline-variant) !important;
  display: grid;
  min-height: 0;
  overflow: hidden;
}

.section-container-shell__body {
  display: grid;
  gap: var(--v64-space-3);
  grid-template-columns: minmax(10rem, 11.5rem) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: var(--v64-space-2);
}

/* M3 navigation drawer: a tonal container holding pill-shaped destinations. */
.section-container-shell__nav {
  background: var(--v64-surface-container-low);
  border-radius: var(--v64-shape-lg);
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: var(--v64-space-2) var(--v64-space-1);
}

.section-container-shell__nav :deep(.v-list) {
  display: grid;
  gap: 2px;
  padding: 0;
}

.section-container-shell__nav :deep(.v-list-item) {
  border-radius: var(--v64-shape-full);
  color: var(--v64-on-surface-variant);
  margin: 0;
  min-height: 40px;
  padding-inline: var(--v64-space-3) var(--v64-space-4);
  transition:
    background-color var(--v64-duration-short) var(--v64-ease-standard),
    color var(--v64-duration-short) var(--v64-ease-standard);
}

/* Replace Vuetify's overlay with explicit M3 state layers. */
.section-container-shell__nav :deep(.v-list-item__overlay) {
  display: none;
}

.section-container-shell__nav :deep(.v-list-item:not(.v-list-item--active):not(.v-list-item--disabled):hover) {
  background: color-mix(in srgb, var(--v64-on-surface) calc(var(--v64-state-hover) * 100%), transparent);
  color: var(--v64-on-surface);
}

.section-container-shell__nav :deep(.v-list-item:focus-visible) {
  outline: 2px solid var(--v64-primary);
  outline-offset: -2px;
}

.section-container-shell__nav :deep(.v-list-item:not(.v-list-item--disabled):active) {
  background: color-mix(in srgb, var(--v64-on-surface) calc(var(--v64-state-pressed) * 100% + 4%), transparent);
}

.section-container-shell__nav :deep(.v-list-item.v-list-item--active) {
  background: var(--v64-primary-container);
  color: var(--v64-on-primary-container);
  font-weight: 650;
}

.section-container-shell__nav :deep(.v-list-item.v-list-item--active .v-list-item__prepend > .v-icon) {
  color: var(--v64-primary);
  opacity: 1;
}

.section-container-shell__nav :deep(.v-list-item__prepend) {
  margin-inline-end: 0;
}

.section-container-shell__nav :deep(.v-list-item__prepend > .v-icon) {
  font-size: 20px;
  margin-inline-end: 0;
  opacity: 0.86;
}

.section-container-shell__nav :deep(.v-list-item__spacer) {
  min-width: var(--v64-space-3);
  width: var(--v64-space-3);
}

.section-container-shell__nav :deep(.v-list-item-title) {
  font: var(--v64-type-label-lg);
  font-weight: inherit;
  letter-spacing: 0;
  line-height: 1.2;
}

.section-container-shell__content {
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: var(--v64-space-2) var(--v64-space-2) var(--v64-space-4);
  padding-left: 0.75rem;
  scrollbar-gutter: stable;
}

.section-container-shell--collapsed .section-container-shell__body {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  padding: 0;
}

.section-container-shell--collapsed .section-container-shell__content {
  padding: 0;
}

@media (prefers-reduced-motion: reduce) {
  .section-container-shell__nav :deep(.v-list-item) {
    transition: none;
  }
}

@media (max-width: 760px) {
  .section-container-shell__body {
    gap: var(--v64-space-2);
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    padding: var(--v64-space-3) var(--v64-space-3) 0;
  }

  .section-container-shell__mobile-select :deep(.v-field) {
    background: var(--v64-surface-container-low);
    min-height: 48px;
  }

  .section-container-shell__content {
    padding: var(--v64-space-1) 0 var(--v64-space-4);
  }
}
</style>
