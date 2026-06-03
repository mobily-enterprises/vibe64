<script setup>
import { computed, useSlots } from "vue";

const props = defineProps({
  title: {
    type: String,
    default: ""
  },
  subtitle: {
    type: String,
    default: ""
  }
});

const slots = useSlots();
const resolvedTitle = computed(() => String(props.title || "").trim());
const resolvedSubtitle = computed(() => String(props.subtitle || "").trim());
const hasHeading = computed(() => Boolean(resolvedTitle.value || resolvedSubtitle.value));
const hasTabs = computed(() => Boolean(slots.tabs));
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
      <div class="section-container-shell__body">
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

  .section-container-shell__nav :deep(.v-list) {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .section-container-shell__nav :deep(.v-list-item) {
    flex: 0 0 auto;
    min-height: 40px;
  }

  .section-container-shell__content {
    border-left: 0;
    padding-left: 0;
  }
}
</style>
