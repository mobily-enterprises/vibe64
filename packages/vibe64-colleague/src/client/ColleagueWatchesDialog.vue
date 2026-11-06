<script setup>
// Colleague's ongoing watches and assignments, with Resume and Cancel for each watch.

defineProps({
  activator: { type: Object, default: undefined },
  fullscreen: Boolean,
  watches: { type: Array, required: true },
  assignments: { type: Array, required: true }
});
const emit = defineEmits(["change-watch"]);
const open = defineModel({ type: Boolean, default: false });
</script>

<template>
  <v-dialog v-model="open" :activator="activator" :open-on-click="false" :fullscreen="fullscreen" max-width="620" scrollable aria-label="Watches and assignments">
    <v-card class="vibe64-colleague__watch-dialog">
      <v-card-title class="vibe64-colleague__watch-title d-flex align-center text-title-large">
        <span class="vibe64-colleague__watch-badge" aria-hidden="true"><v-icon icon="$visibility" size="22" /></span>
        <span class="flex-grow-1">Watches and assignments</span>
        <v-btn icon="$close" variant="text" aria-label="Close watches and assignments" title="Close watches and assignments" @click="open = false" />
      </v-card-title>
      <v-card-text class="vibe64-colleague__watch-details">
        <section v-if="watches.length" class="vibe64-colleague__watch-card" aria-label="Watches">
          <p class="text-title-medium">Watches ({{ watches.length }})</p>
          <ul>
            <li v-for="item in watches" :key="item.watchId">
              <div>
                <strong>{{ item.projectSlug || 'Workspace' }}</strong> · <span class="vibe64-colleague__watch-chip" :data-status="item.status">{{ item.status }}</span>
                <p>{{ item.question }}</p><p v-if="item.error" class="text-error">{{ item.error }}</p>
              </div>
              <div class="d-flex flex-wrap ga-1">
                <v-btn v-if="item.status === 'paused'" variant="text" :aria-label="`Resume watch: ${item.question}`" @click="emit('change-watch', item, 'resume')">Resume</v-btn>
                <v-btn variant="text" :aria-label="`Cancel watch: ${item.question}`" @click="emit('change-watch', item, 'cancel')">Cancel</v-btn>
              </div>
            </li>
          </ul>
        </section>
        <section v-if="assignments.length" class="vibe64-colleague__watch-card" aria-label="Ongoing assignments">
          <p class="text-title-medium">Ongoing assignments ({{ assignments.length }})</p>
          <ul>
            <li v-for="item in assignments" :key="item.assignmentId">
              <strong>{{ item.projectSlug }}</strong> · {{ item.status }} · {{ item.turnLimit - item.turnsUsed }} turns left
              <p>{{ item.summary }}</p><p>{{ item.criteria }}</p>
            </li>
          </ul>
        </section>
        <p v-if="!watches.length && !assignments.length" class="vibe64-colleague__watch-empty" role="status">No ongoing watches or assignments.</p>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.vibe64-colleague__watch-dialog { border-radius: var(--v64-shape-xl, 28px); background: rgb(var(--v-theme-surface-container-low)); }
.vibe64-colleague__watch-title { gap: 12px; padding: 20px 16px 8px 24px; }
.vibe64-colleague__watch-badge { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; background: rgb(var(--v-theme-primary-container)); color: rgb(var(--v-theme-on-primary-container)); }
.vibe64-colleague__watch-details { padding: 8px 24px 24px; min-height: 0; overflow: auto; overflow-wrap: anywhere; font: var(--v64-type-body-md, inherit); }
.vibe64-colleague__watch-details p { margin-block: 0 8px; }
.vibe64-colleague__watch-card { padding: 16px; border: 1px solid rgb(var(--v-theme-outline-variant)); border-radius: var(--v64-shape-lg, 16px); background: rgb(var(--v-theme-surface)); }
.vibe64-colleague__watch-card > .text-title-medium { margin-bottom: 12px; }
.vibe64-colleague__watch-details section + section { margin-top: 12px; }
.vibe64-colleague__watch-details ul { list-style: none; padding: 0; margin: 0; }
.vibe64-colleague__watch-details li { padding-block: 12px; }
.vibe64-colleague__watch-details li + li { border-top: 1px solid rgb(var(--v-theme-outline-variant)); }
.vibe64-colleague__watch-chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: var(--v64-shape-sm, 8px); background: rgb(var(--v-theme-surface-container-high)); font: var(--v64-type-label-md, 500 .75rem/1rem system-ui, sans-serif); text-transform: capitalize; }
.vibe64-colleague__watch-chip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: rgb(var(--v-theme-on-surface-variant)); }
.vibe64-colleague__watch-chip[data-status="active"] { background: rgb(var(--v-theme-success-container)); }
.vibe64-colleague__watch-chip[data-status="active"]::before { background: rgb(var(--v-theme-success)); }
.vibe64-colleague__watch-chip[data-status="paused"]::before { background: var(--v64-learning, #f5c518); }
.vibe64-colleague__watch-meta { color: rgb(var(--v-theme-on-surface-variant)); font: var(--v64-type-label-md, inherit); }
.vibe64-colleague__watch-empty { padding: 24px 0; text-align: center; color: rgb(var(--v-theme-on-surface-variant)); }
</style>
