<script setup>
// One page's star, on its chat card, its panel and its Pages list row: filled
// when you starred it. Only you see your stars, in every session of the project.
import { computed } from "vue";
import { mdiStar, mdiStarOutline } from "@mdi/js";
import { usePageStars } from "./pageStars.js";

const props = defineProps({
  page: { type: Object, required: true },
  projectSlug: { type: String, required: true }
});

const stars = usePageStars(() => props.projectSlug);
const starred = computed(() => stars.isStarred(props.page.id));
</script>

<template>
  <v-btn
    :aria-label="starred ? 'Unstar page' : 'Star page'"
    :aria-pressed="starred"
    :disabled="stars.pendingIds.value.includes(page.id)"
    :icon="starred ? mdiStar : mdiStarOutline"
    data-test="page-star"
    size="small"
    :title="starred ? 'Unstar page' : 'Star page'"
    variant="text"
    @click="stars.toggle(page)"
  />
</template>
