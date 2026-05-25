<template>
  <div class="studio-autopilot-composer-actions">
    <!-- DOM order is accessibility order; CSS controls visual position. -->
    <div class="studio-autopilot-composer-actions__submit">
      <slot name="submit" />
    </div>

    <div class="studio-autopilot-composer-actions__workflow">
      <slot name="workflow" />
    </div>
  </div>
</template>

<style scoped>
.studio-autopilot-composer-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: space-between;
  width: 100%;
}

.studio-autopilot-composer-actions__submit,
.studio-autopilot-composer-actions__workflow {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.studio-autopilot-composer-actions__submit {
  justify-content: flex-end;
  margin-left: auto;
  order: 2;
}

.studio-autopilot-composer-actions__workflow {
  flex: 1 1 auto;
  justify-content: flex-start;
  order: 1;
}
</style>
