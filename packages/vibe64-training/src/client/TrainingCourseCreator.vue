<script setup>
import { computed, ref } from "vue";

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
  <v-card variant="outlined" class="training-course-creator" aria-label="New course">
    <v-card-title>New course</v-card-title>
    <v-card-text>
      <p>Name the course and choose whole installed topics in the order to learn them. Lessons and their saved progress are shared with every course that contains them.</p>
      <v-text-field v-model="name" label="Course name" counter="120" maxlength="120" :disabled="busy" />
      <p v-if="!topics.length" role="status">No topics from enabled released courses are installed. Ask the owner to install and enable a course first.</p>
      <fieldset v-else class="training-course-creator__topics" :disabled="busy">
        <legend>Installed topics</legend>
        <v-checkbox v-for="topic in topics" :key="key(topic)" :model-value="selected.includes(key(topic))"
          :label="`${topic.title} · ${topic.release}`" hide-details @update:model-value="toggle(topic, $event)" />
      </fieldset>
      <template v-if="chosen.length">
        <p>Topic order</p>
        <ol class="training-course-creator__order">
          <li v-for="(topic, index) in chosen" :key="key(topic)">
            <span>{{ topic.title }} · {{ topic.release }}</span>
            <v-btn variant="text" min-height="48" :disabled="busy || index === 0" :aria-label="`Move ${topic.title} up`" @click="move(index, -1)">Up</v-btn>
            <v-btn variant="text" min-height="48" :disabled="busy || index === chosen.length - 1" :aria-label="`Move ${topic.title} down`" @click="move(index, 1)">Down</v-btn>
          </li>
        </ol>
      </template>
    </v-card-text>
    <v-card-actions>
      <v-btn variant="tonal" min-height="48" :disabled="!createEnabled" @click="requestCreate">Create course</v-btn>
      <v-btn variant="text" min-height="48" :disabled="busy" @click="emit('cancel')">Cancel</v-btn>
    </v-card-actions>
  </v-card>
</template>

<style scoped>
.training-course-creator__topics { border: 0; margin: 0; padding: 0; min-width: 0; }
.training-course-creator__topics legend { font-weight: 600; }
.training-course-creator__order { padding-left: 1.25rem; }
.training-course-creator__order li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; }
.training-course-creator__order span { flex: 1 1 12rem; min-width: 0; overflow-wrap: anywhere; }
.training-course-creator p { margin-bottom: 0.5rem; overflow-wrap: anywhere; }
.training-course-creator :deep(.v-label) { white-space: normal; overflow-wrap: anywhere; }
</style>
