<script setup>
import { computed, ref } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import GithubMentionTextarea from "./GithubMentionTextarea.vue";

const props = defineProps({
  comment: { type: Object, required: true },
  issue: { type: Object, required: true },
  basePath: { type: String, required: true }
});
const emit = defineEmits(["saved"]);
const editing = ref(false);
const body = ref("");
const pending = ref(false);
const feedback = useUiFeedback({ source: "vibe64.issues.commentEditor" });
const path = computed(() => `${props.basePath}/${props.issue.number}/comments/${encodeURIComponent(props.comment.id)}`);
const resource = useEndpointResource({ path, enabled: false });
const canSubmit = computed(() => !pending.value && Boolean(body.value.trim()) && body.value.length <= 65536);

function edit() {
  body.value = props.comment.body;
  editing.value = true;
}
async function submit() {
  if (!canSubmit.value) return;
  const savedIssue = { number: props.issue.number, basePath: props.basePath };
  pending.value = true;
  try {
    await resource.save({ body: body.value }, { method: "PATCH" });
    editing.value = false;
    feedback.success("Comment updated.");
    emit("saved", savedIssue);
  } catch (error) {
    feedback.error(error, "Comment could not be updated. Your changes have been kept.");
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <form v-if="editing" class="d-flex flex-column ga-2" @submit.prevent="submit">
    <GithubMentionTextarea
      v-model="body" label="Edit comment" :base-path="basePath" :issue="issue" :disabled="pending"
      :enabled="editing" variant="outlined" rows="4" auto-grow maxlength="65536"
    />
    <div class="d-flex flex-wrap justify-end ga-2">
      <v-btn variant="text" height="48" :disabled="pending" @click="editing = false">Cancel</v-btn>
      <v-btn type="submit" color="primary" variant="flat" height="48" :disabled="!canSubmit">
        {{ pending ? 'Saving…' : 'Save comment' }}
      </v-btn>
    </div>
  </form>
  <template v-else>
    <slot />
    <v-btn v-if="comment.viewerCanUpdate" variant="text" height="48" @click="edit">Edit comment</v-btn>
  </template>
</template>
