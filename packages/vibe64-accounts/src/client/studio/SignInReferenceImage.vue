<script setup>
// A closed panel that shows what a sign-in step looks like on the provider's
// own page; its default slot adds a note below the picture.
defineProps({
  title: {
    required: true,
    type: String
  },
  alt: {
    required: true,
    type: String
  },
  src: {
    required: true,
    type: String
  }
});
</script>

<template>
  <v-expansion-panels variant="accordion" flat>
    <v-expansion-panel bg-color="transparent" rounded="lg">
      <v-expansion-panel-title min-height="48" class="text-body-medium px-0">
        {{ title }}
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <img
          :alt="alt"
          class="accounts-setup__reference-image"
          :src="src"
        >
        <slot />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<style scoped>
.accounts-setup__reference-image {
  display: block;
  height: auto;
  max-width: 100%;
}
</style>
