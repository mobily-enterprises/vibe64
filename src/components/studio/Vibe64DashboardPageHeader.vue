<script setup>
// The shared top of every Dashboard section page: an icon tile matching the
// section's navigation icon, the page title (h1), an optional one-line
// description, inline status chips and right-aligned actions.
defineProps({
  description: { default: "", type: String },
  icon: { default: "", type: String },
  title: { default: "", type: String }
});
</script>

<template>
  <header class="vibe64-dashboard-page-header">
    <span v-if="icon" aria-hidden="true" class="vibe64-dashboard-page-header__icon">
      <v-icon :icon="icon" size="22" />
    </span>
    <div class="vibe64-dashboard-page-header__copy">
      <div class="vibe64-dashboard-page-header__title-row">
        <slot name="title">
          <h1 class="vibe64-dashboard-page-header__title">{{ title }}</h1>
        </slot>
        <slot name="meta" />
      </div>
      <p v-if="description" class="vibe64-dashboard-page-header__description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="vibe64-dashboard-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.vibe64-dashboard-page-header {
  align-items: center;
  animation: vibe64-dashboard-page-header-enter var(--v64-duration-medium, 300ms)
    var(--v64-ease-emphasized-decelerate, ease-out) both;
  display: flex;
  gap: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
  min-width: 0;
  padding: var(--v64-space-1, 4px) 0 var(--v64-space-2, 8px);
}

.vibe64-dashboard-page-header__icon {
  align-items: center;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--v64-surface) 55%, transparent), transparent 60%),
    var(--v64-primary-container);
  border-radius: var(--v64-shape-md, 12px);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--v64-primary) 16%, transparent);
  color: var(--v64-primary);
  display: inline-flex;
  flex: 0 0 auto;
  height: 44px;
  justify-content: center;
  width: 44px;
}

.vibe64-dashboard-page-header__copy {
  display: grid;
  flex: 1 1 auto;
  gap: 2px;
  min-width: 0;
}

.vibe64-dashboard-page-header__title-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2, 8px);
  min-width: 0;
}

.vibe64-dashboard-page-header__title,
.vibe64-dashboard-page-header__title-row :slotted(h1) {
  color: var(--v64-on-surface);
  font: var(--v64-type-headline-sm, 600 1.5rem/2rem system-ui, sans-serif);
  letter-spacing: 0;
  margin: 0;
}

.vibe64-dashboard-page-header__description {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif);
  margin: 0;
}

.vibe64-dashboard-page-header__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--v64-space-2, 8px);
  justify-content: flex-end;
}

@keyframes vibe64-dashboard-page-header-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-dashboard-page-header {
    animation: none;
  }
}

@media (max-width: 600px) {
  .vibe64-dashboard-page-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .vibe64-dashboard-page-header__icon {
    height: 40px;
    width: 40px;
  }

  .vibe64-dashboard-page-header__copy {
    flex-basis: calc(100% - 56px);
  }

  .vibe64-dashboard-page-header__actions {
    justify-content: flex-start;
    width: 100%;
  }
}
</style>
