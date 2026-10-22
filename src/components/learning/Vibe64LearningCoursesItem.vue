<script setup>
import { mdiSchoolOutline } from "@mdi/js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// Courses in the project selector's menu, in Learn mode only: in Learn,
// choosing what to work on means choosing a lesson. Both hosts' selectors
// render it.
const learning = useVibe64Learning();
</script>

<template>
  <v-list-item
    v-if="learning?.learnMode"
    data-test="learning-courses"
    data-vibe64-guide="courses"
    :prepend-icon="mdiSchoolOutline"
    subtitle="Start or continue a lesson"
    title="Courses"
    @click="learning.openCourses()"
  />
</template>
