<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useSlots
} from "vue";
import { useRoute, useRouter } from "vue-router";

const props = defineProps({
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
      to: normalizePath(link?.to || "")
    }))
    .filter((link) => Boolean(link.id && link.label && link.to));
});
const mobileSectionsActive = computed(() => Boolean(
  mobileSectionLayout.value &&
  mobileSectionLinks.value.length
));
const activeMobileSection = computed(() => {
  const routePath = normalizePath(route.path || "");
  return mobileSectionLinks.value.find((link) => normalizePath(link.to) === routePath) || null;
});
const activeMobileSectionValue = computed(() => activeMobileSection.value?.to || null);

function initialMobileSectionLayout() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_SECTION_MEDIA_QUERY).matches;
}

function normalizePath(path = "") {
  const value = String(path || "").trim();
  if (!value || value === "/") {
    return value || "/";
  }
  return value.replace(/\/+$/u, "");
}

function syncMobileSectionLayout() {
  mobileSectionLayout.value = Boolean(mobileSectionMediaQuery?.matches);
}

function mobileSectionActive(link = {}) {
  return normalizePath(link?.to || "") === normalizePath(route.path || "");
}

function selectMobileSection(value = "") {
  const targetPath = normalizePath(value || "");
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
  <section class="section-container-shell">
    <header v-if="hasHeading" class="section-container-shell__heading">
      <h1 v-if="resolvedTitle" class="section-container-shell__title">{{ resolvedTitle }}</h1>
      <p v-if="resolvedSubtitle" class="text-body-2 text-medium-emphasis mb-0">{{ resolvedSubtitle }}</p>
    </header>

    <v-sheet
      rounded="lg"
      border
      class="section-container-shell__panel"
    >
      <v-expansion-panels
        v-if="mobileSectionsActive"
        :model-value="activeMobileSectionValue"
        class="section-container-shell__mobile-sections"
        variant="accordion"
        @update:model-value="selectMobileSection"
      >
        <v-expansion-panel
          v-for="link in mobileSectionLinks"
          :key="link.id"
          class="section-container-shell__mobile-section"
          :disabled="link.disabled"
          :value="link.to"
        >
          <v-expansion-panel-title class="section-container-shell__mobile-section-title">
            <span class="section-container-shell__mobile-section-label">
              <v-icon
                v-if="link.icon"
                :icon="link.icon"
                size="22"
              />
              <span>{{ link.label }}</span>
            </span>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <div
              v-if="mobileSectionActive(link)"
              class="section-container-shell__mobile-section-content"
            >
              <slot />
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <div v-else class="section-container-shell__body">
        <nav
          v-if="hasTabs"
          class="section-container-shell__nav"
          aria-label="Dashboard sections"
        >
          <v-list
            nav
            density="compact"
            rounded="lg"
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
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.section-container-shell__heading {
  min-width: 0;
}

.section-container-shell__title {
  font-size: 1.1rem;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0 0 0.35rem;
}

.section-container-shell__panel {
  display: grid;
  min-height: 0;
  overflow: hidden;
}

.section-container-shell__mobile-sections {
  display: block;
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem;
  scrollbar-gutter: stable;
}

.section-container-shell__mobile-section {
  border: 1px solid var(--studio-control-border, rgba(17, 24, 39, 0.12));
  border-radius: var(--studio-control-radius, 7px) !important;
  box-shadow: none !important;
  overflow: hidden;
}

.section-container-shell__mobile-section + .section-container-shell__mobile-section {
  margin-top: 0.55rem;
}

.section-container-shell__mobile-section-title {
  min-height: 48px;
}

.section-container-shell__mobile-section-label {
  align-items: center;
  display: inline-flex;
  gap: 0.75rem;
  min-width: 0;
}

.section-container-shell__mobile-section-label span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-container-shell__mobile-section-content {
  min-width: 0;
  padding-right: 0.15rem;
}

.section-container-shell__mobile-section-content :deep(.vibe64-dashboard-page) {
  min-height: auto;
}

.section-container-shell__body {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: minmax(11rem, 13rem) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 0.75rem;
}

.section-container-shell__nav {
  min-width: 0;
}

.section-container-shell__nav :deep(.v-list) {
  padding: 0.15rem 0.3rem;
}

.section-container-shell__nav :deep(.v-list-item) {
  border-radius: var(--studio-control-radius, 7px);
  min-height: 38px;
  padding-inline: 0.6rem 0.7rem;
}

.section-container-shell__nav :deep(.v-list-item__prepend) {
  margin-inline-end: 0;
}

.section-container-shell__nav :deep(.v-list-item__prepend > .v-icon) {
  margin-inline-end: 0;
}

.section-container-shell__nav :deep(.v-list-item__spacer) {
  min-width: 0.5rem;
  width: 0.5rem;
}

.section-container-shell__nav :deep(.v-list-item-title) {
  line-height: 1.2;
}

.section-container-shell__content {
  border-left: 1px solid var(--studio-control-border, rgba(17, 24, 39, 0.12));
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding-left: 1rem;
  scrollbar-gutter: stable;
}

@media (max-width: 760px) {
  .section-container-shell__body {
    grid-template-columns: 1fr;
  }

  .section-container-shell__content {
    border-left: 0;
    padding-left: 0;
  }
}
</style>
