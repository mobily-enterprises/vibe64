<script setup>
const title = "Not Found";
const message = "The page you requested does not exist.";
</script>

<template>
  <v-container class="fill-height d-flex align-center justify-center">
    <v-card class="pa-6 text-center" max-width="560" rounded="lg">
      <v-card-title class="text-h4">{{ title }}</v-card-title>
      <v-card-text class="text-medium-emphasis">{{ message }}</v-card-text>
    </v-card>
  </v-container>
</template>
