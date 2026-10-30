<script setup>
import { onMounted, ref } from "vue";

import { fetchSessions, postSession } from "../api/sessionsClient.js";

const sessions = ref([]);

async function loadSessions() {
  sessions.value = await fetchSessions();
}

async function addSession() {
  await postSession("New session");
  await loadSessions();
}

onMounted(loadSessions);
</script>

<template>
  <ul>
    <li v-for="session in sessions" :key="session.id">{{ session.title }}</li>
  </ul>
  <button type="button" @click="addSession">Add</button>
</template>
