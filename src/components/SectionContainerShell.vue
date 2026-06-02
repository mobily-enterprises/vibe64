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
            density="comfortable"
            rounded="lg"
            border
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
  min-height: 0;
  overflow: hidden;
}

.section-container-shell__body {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: minmax(11rem, 13rem) minmax(0, 1fr);
  min-height: 0;
  padding: 0.75rem;
}

.section-container-shell__nav {
  min-width: 0;
}

.section-container-shell__content {
  min-width: 0;
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
    min-height: 48px;
  }
}
</style>
