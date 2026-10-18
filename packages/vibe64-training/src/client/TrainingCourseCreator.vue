<script setup>
import { computed, ref } from "vue";
import { trainingIcons as icons } from "./trainingIcons.js";

// Collects a custom course's name and ordered whole topics. The server's
// catalogue owner resolves, pins, validates and enables the course.
const props = defineProps({
  topics: { type: Array, required: true },
  busy: Boolean
});
const emit = defineEmits(["create", "cancel"]);
const name = ref("");
const selected = ref([]);
const key = topic => JSON.stringify([topic.topicId, topic.release]);
const chosen = computed(() => selected.value.map(value => props.topics.find(topic => key(topic) === value)).filter(Boolean));
const createEnabled = computed(() => !props.busy && name.value.trim().length > 0 && name.value.trim().length <= 120 && chosen.value.length > 0);

function toggle(topic, checked) {
  const value = key(topic);
  selected.value = checked ? [...selected.value.filter(item => item !== value), value] : selected.value.filter(item => item !== value);
}
function move(index, offset) {
  const order = chosen.value.map(key);
  [order[index], order[index + offset]] = [order[index + offset], order[index]];
  selected.value = order;
}
function requestCreate() {
  if (createEnabled.value) emit("create", { title: name.value.trim(), topics: chosen.value.map(({ topicId, release }) => ({ topicId, release })) });
}
</script>

<template>
  <section class="training-course-creator" aria-label="New course">
    <header class="tcc-header">
      <span class="tcc-header__icon" aria-hidden="true"><v-icon :icon="icons.path" size="28" /></span>
      <div>
        <h3 id="tcc-title">New course</h3>
        <p>Name the course and choose whole installed topics in the order to learn them. Lessons and their saved progress are shared with every course that contains them.</p>
      </div>
    </header>

    <ol class="tcc-steps">
      <li class="tcc-step" :class="{ 'tcc-step--done': name.trim().length > 0 }">
        <span class="tcc-step__marker" aria-hidden="true"><v-icon v-if="name.trim().length > 0" :icon="icons.check" size="16" /><template v-else>1</template></span>
        <div class="tcc-step__body">
          <p class="tcc-step__title">Name it</p>
          <v-text-field v-model="name" label="Course name" counter="120" maxlength="120" variant="outlined" rounded="lg" :disabled="busy" />
        </div>
      </li>
      <li class="tcc-step" :class="{ 'tcc-step--done': chosen.length > 0 }">
        <span class="tcc-step__marker" aria-hidden="true"><v-icon v-if="chosen.length > 0" :icon="icons.check" size="16" /><template v-else>2</template></span>
        <div class="tcc-step__body">
          <p v-if="!topics.length" class="tcc-empty" role="status">No topics from enabled released courses are installed. Ask the owner to install and enable a course first.</p>
          <fieldset v-else class="training-course-creator__topics" :disabled="busy">
            <legend class="tcc-step__title">Installed topics</legend>
            <div class="tcc-topics">
              <div v-for="topic in topics" :key="key(topic)" class="tcc-topic" :class="{ 'tcc-topic--on': selected.includes(key(topic)) }">
                <v-checkbox :model-value="selected.includes(key(topic))" color="primary" density="comfortable"
                  :label="`${topic.title} · ${topic.release}`" hide-details @update:model-value="toggle(topic, $event)" />
              </div>
            </div>
          </fieldset>
        </div>
      </li>
      <li v-if="chosen.length" class="tcc-step tcc-step--done">
        <span class="tcc-step__marker" aria-hidden="true">3</span>
        <div class="tcc-step__body">
          <p class="tcc-step__title">Topic order</p>
          <ol class="training-course-creator__order">
            <li v-for="(topic, index) in chosen" :key="key(topic)">
              <span class="tcc-order__index" aria-hidden="true">{{ index + 1 }}</span>
              <span class="tcc-order__name">{{ topic.title }} · {{ topic.release }}</span>
              <span class="tcc-order__moves">
                <v-btn variant="text" rounded="pill" min-height="48" :prepend-icon="icons.chevronUp" :disabled="busy || index === 0" :aria-label="`Move ${topic.title} up`" @click="move(index, -1)">Up</v-btn>
                <v-btn variant="text" rounded="pill" min-height="48" :prepend-icon="icons.chevronDown" :disabled="busy || index === chosen.length - 1" :aria-label="`Move ${topic.title} down`" @click="move(index, 1)">Down</v-btn>
              </span>
            </li>
          </ol>
        </div>
      </li>
    </ol>

    <footer class="tcc-actions">
      <v-btn variant="text" rounded="pill" min-height="48" :disabled="busy" @click="emit('cancel')">Cancel</v-btn>
      <v-btn color="primary" variant="flat" rounded="pill" min-height="48" :prepend-icon="icons.plus" :disabled="!createEnabled" @click="requestCreate">Create course</v-btn>
    </footer>
  </section>
</template>

<style scoped>
.training-course-creator {
  display: flex; flex-direction: column; gap: var(--v64-space-4, 16px); min-width: 0;
  padding: var(--v64-space-5, 24px); border-radius: var(--v64-shape-xl, 28px);
  background: var(--v64-surface-container-high); box-shadow: var(--v64-elevation-2);
  animation: tcc-in var(--v64-duration-medium, 300ms) var(--v64-ease-emphasized-decelerate) both;
}
.training-course-creator p, .training-course-creator h3 { overflow-wrap: anywhere; white-space: normal; }
.training-course-creator :deep(.v-label) { white-space: normal; overflow-wrap: anywhere; opacity: 1; }
.training-course-creator :deep(.v-btn) { text-transform: none; letter-spacing: 0.01em; font-weight: 600; }
.tcc-header { display: flex; align-items: flex-start; gap: var(--v64-space-4, 16px); }
.tcc-header__icon { flex: none; display: grid; place-items: center; width: 52px; height: 52px; border-radius: var(--v64-shape-lg, 16px); background: var(--v64-primary-container); color: var(--v64-on-primary-container); }
.tcc-header h3 { margin: 0 0 var(--v64-space-1, 4px); font: var(--v64-type-headline-sm); }
.tcc-header p { margin: 0; font: var(--v64-type-body-md); color: var(--v64-on-surface-variant); }
.tcc-steps { list-style: none; margin: 0; padding: 0; }
.tcc-step { position: relative; display: flex; gap: var(--v64-space-4, 16px); padding-bottom: var(--v64-space-4, 16px); }
.tcc-step:not(:last-child)::before { content: ""; position: absolute; left: 15px; top: 36px; bottom: 4px; width: 2px; border-radius: 2px; background: var(--v64-outline-variant); }
.tcc-step__marker {
  flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%;
  font: var(--v64-type-label-lg); background: var(--v64-surface); color: var(--v64-on-surface-variant); border: 2px solid var(--v64-outline);
  transition: background-color var(--v64-duration-medium) var(--v64-ease-standard), border-color var(--v64-duration-medium) var(--v64-ease-standard);
}
.tcc-step--done .tcc-step__marker { background: var(--v64-primary); border-color: var(--v64-primary); color: var(--v64-on-primary); }
.tcc-step__body { flex: 1; min-width: 0; }
.tcc-step__title { margin: 4px 0 var(--v64-space-3, 12px); padding: 0; font: var(--v64-type-title-md); color: var(--v64-on-surface); }
.training-course-creator__topics { border: 0; margin: 0; padding: 0; min-width: 0; }
.tcc-topics { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr)); gap: var(--v64-space-2, 8px); }
.tcc-topic {
  padding: 2px var(--v64-space-2, 8px) 2px 0; border-radius: var(--v64-shape-md, 12px);
  background: var(--v64-surface); border: 1px solid var(--v64-outline-variant);
  transition: border-color var(--v64-duration-short) var(--v64-ease-standard), background-color var(--v64-duration-short) var(--v64-ease-standard);
}
.tcc-topic:hover { border-color: var(--v64-outline); }
.tcc-topic--on { background: var(--v64-primary-container); border-color: color-mix(in srgb, var(--v64-primary) 55%, transparent); }
.tcc-empty { margin: 4px 0 0; padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px); border-radius: var(--v64-shape-md, 12px); background: var(--v64-surface); color: var(--v64-on-surface-variant); }
.training-course-creator__order { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); }
.training-course-creator__order li {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--v64-space-2, 8px);
  padding: var(--v64-space-1, 4px) var(--v64-space-2, 8px) var(--v64-space-1, 4px) var(--v64-space-3, 12px);
  border-radius: var(--v64-shape-md, 12px); background: var(--v64-surface); box-shadow: var(--v64-elevation-1);
}
.tcc-order__index { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--v64-shape-sm, 8px); background: var(--v64-learning-container); color: var(--v64-on-learning-container); font: var(--v64-type-label-lg); }
.tcc-order__name { flex: 1 1 10rem; min-width: 0; overflow-wrap: anywhere; font: var(--v64-type-body-lg); }
.tcc-order__moves { display: inline-flex; flex-wrap: wrap; }
.tcc-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--v64-space-2, 8px); }
@keyframes tcc-in { from { opacity: 0; transform: translateY(8px) scale(0.99); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .training-course-creator { animation: none; } }
@container (max-width: 34rem) {
  .training-course-creator { padding: var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px); }
  .tcc-step { gap: var(--v64-space-3, 12px); }
  .tcc-actions :deep(.v-btn) { flex: 1 1 auto; }
}
</style>
