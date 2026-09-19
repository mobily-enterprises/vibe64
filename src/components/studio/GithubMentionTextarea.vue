<script setup>
import { computed, nextTick, ref, useId, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";

defineOptions({ inheritAttrs: false });
const props = defineProps({
  modelValue: { type: String, default: "" },
  basePath: { type: String, required: true },
  issue: { type: Object, default: null },
  enabled: { type: Boolean, default: true },
  disabled: Boolean
});
const emit = defineEmits(["update:modelValue"]);
const field = ref(null);
const mention = ref(null);
const selected = ref(0);
const listId = `github-mentions-${useId()}`;
const path = computed(() => props.basePath.replace(/\/issues$/u, "/issue-mentions"));
const number = computed(() => props.issue?.number || null);
const catalog = useEndpointResource({
  path, readQuery: computed(() => number.value ? { number: number.value } : {}),
  queryKey: computed(() => ["vibe64.issueMentions", path.value, number.value]),
  enabled: computed(() => props.enabled), queryOptions: { retry: false, staleTime: 60_000 }, requestRecovery: false,
  fallbackLoadError: "Mention suggestions could not load. You can still type any @username."
});
const people = computed(() => {
  const users = new Map();
  for (const user of [props.issue?.author, ...(props.issue?.comments?.nodes || []).map((comment) => comment.author),
    ...(catalog.data.value?.users || [])]) {
    if (user?.login) users.set(user.login.toLowerCase(), user);
  }
  return [...users.values()];
});
const suggestions = computed(() => {
  const query = mention.value?.query.toLowerCase() || "";
  const matches = people.value.filter((user) => user.login.toLowerCase().includes(query) || user.name?.toLowerCase().includes(query));
  return matches.sort((a, b) => {
    const aStartsWithQuery = a.login.toLowerCase().startsWith(query);
    const bStartsWithQuery = b.login.toLowerCase().startsWith(query);
    return Number(bStartsWithQuery) - Number(aStartsWithQuery) || a.login.localeCompare(b.login);
  }).slice(0, 8);
});
const open = computed(() => Boolean(mention.value) && props.enabled && !props.disabled);
const warning = computed(() => catalog.loadError.value || catalog.data.value?.warning || "");
watch([path, number, () => props.enabled, () => props.disabled], () => { mention.value = null; });
watch(suggestions, () => { selected.value = 0; });

function updateMention(event) {
  const input = event.target;
  if (input.tagName !== "TEXTAREA") return;
  if (event.isComposing || input.selectionStart !== input.selectionEnd) {
    mention.value = null;
    return;
  }
  const end = input.selectionStart;
  const match = input.value.slice(0, end).match(/(?:^|[\s([{])@([a-z\d-]*)$/iu);
  mention.value = match ? { start: end - match[1].length - 1, end, query: match[1] } : null;
}

async function choose(user) {
  if (!mention.value || !user || props.disabled) return;
  const input = field.value?.$el.querySelector("textarea");
  if (!input) return;
  const { start, end } = mention.value;
  const after = input.value.slice(end).replace(/^[a-z\d-]*/iu, "");
  const insertion = `@${user.login}${/^\s/u.test(after) ? "" : " "}`;
  const value = input.value.slice(0, start) + insertion + after;
  if (input.maxLength >= 0 && value.length > input.maxLength) return;
  const caret = start + insertion.length + (after.startsWith(" ") ? 1 : 0);
  emit("update:modelValue", value);
  mention.value = null;
  await nextTick();
  input.focus();
  input.setSelectionRange(caret, caret);
}

async function onKeydown(event) {
  if (!open.value || event.isComposing || event.keyCode === 229) return;
  const moveSelection = suggestions.value.length > 0 && ["ArrowDown", "ArrowUp"].includes(event.key);
  const acceptSelection = suggestions.value.length > 0 && (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey));
  if (event.key !== "Escape" && !moveSelection && !acceptSelection) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    mention.value = null;
  } else if (moveSelection) {
    selected.value = (selected.value + (event.key === "ArrowDown" ? 1 : -1) + suggestions.value.length) % suggestions.value.length;
    await nextTick();
    document.getElementById(`${listId}-${selected.value}`)?.scrollIntoView({ block: "nearest" });
  } else {
    await choose(suggestions.value[selected.value]);
  }
}
</script>

<template>
  <v-textarea
    ref="field" v-bind="$attrs" :model-value="modelValue" :disabled="disabled"
    hint="Markdown supported · Type @ to mention someone" persistent-hint
    aria-autocomplete="list" :aria-expanded="open" :aria-controls="open ? listId : undefined"
    :aria-activedescendant="open && suggestions.length ? `${listId}-${selected}` : undefined"
    @update:model-value="emit('update:modelValue', $event)"
    @input="updateMention" @click="updateMention" @focus="updateMention" @select="updateMention"
    @compositionstart="mention = null" @compositionend="updateMention" @blur="mention = null"
    @keydown="onKeydown" @keyup="['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes($event.key) && updateMention($event)"
  />
  <v-overlay
    :model-value="open" :target="field?.$el" location-strategy="connected" location="top start" origin="bottom start"
    scroll-strategy="reposition" :scrim="false" :close-on-back="false" :capture-focus="false" :retain-focus="false"
    width="360" max-width="calc(100vw - 32px)" @update:model-value="!$event && (mention = null)"
  >
    <v-sheet rounded="lg" border elevation="3" class="overflow-y-auto" max-height="320">
      <v-list :id="listId" role="listbox" aria-label="Mention suggestions" density="compact" class="pa-1">
        <v-list-item
          v-for="(user, index) in suggestions" :id="`${listId}-${index}`" :key="user.login"
          tag="button" type="button" role="option" tabindex="-1" :aria-selected="index === selected" :active="index === selected"
          :title="`@${user.login}`" :subtitle="user.name || undefined" min-height="48" class="w-100 text-left"
          @pointerdown.prevent @click="choose(user)"
        />
      </v-list>
      <v-skeleton-loader v-if="catalog.isInitialLoading.value" type="list-item" height="48" aria-label="Loading mention suggestions" aria-busy="true" />
      <p v-else-if="!suggestions.length && !warning" class="text-body-medium pa-3 ma-0" role="status">No matching people</p>
      <div v-if="warning" class="pa-3 text-body-small" role="status">
        {{ warning }}
        <v-btn variant="text" height="48" :disabled="catalog.isFetching.value" @pointerdown.prevent @click="catalog.reload()">Retry</v-btn>
      </div>
    </v-sheet>
  </v-overlay>
</template>
