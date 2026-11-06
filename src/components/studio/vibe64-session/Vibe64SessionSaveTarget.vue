<template>
  <span class="vibe64-save-target" :class="{ 'vibe64-save-target--off-main': target.offMain }">
    <span class="vibe64-save-target__repository">{{ target.repository }}</span>
    <span class="vibe64-save-target__separator">{{ " · " }}</span>
    <span class="vibe64-save-target__branch">{{ target.branch }}</span>
    <span v-if="target.note" class="vibe64-save-target__note">{{ ` (${target.note})` }}</span>
  </span>
</template>

<script setup>
// Where a session's Save goes, as vibe64SessionSaveTarget() describes it: the
// repository on its own line and, beneath it, the branch as a chip,
// highlighted with its note when the branch is not the project's main branch.
// Its text reads the same as the target's `text`.
defineProps({
  target: {
    required: true,
    type: /** @type {import("vue").PropType<NonNullable<ReturnType<typeof import("@/lib/vibe64SessionSaveTarget.js").vibe64SessionSaveTarget>>>} */ (Object)
  }
});
</script>

<style scoped>
.vibe64-save-target {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.35rem;
  max-width: 100%;
  overflow-wrap: anywhere;
}

/* A whole line for the repository, so a narrow tooltip never splits its name
   to fit the branch beside it. */
.vibe64-save-target__repository {
  flex: 1 0 100%;
}

/* The separator stays in the text (copying, screen readers) but the line
   break already separates repository and branch on screen. */
.vibe64-save-target__separator {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

/* The branch is an outlined chip in the surrounding text colour, so it reads on
   the tooltip's and the dialog's surfaces in both themes. */
.vibe64-save-target__branch {
  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
  border-radius: 999px;
  font-weight: 600;
  line-height: 1.35;
  max-width: 100%;
  padding: 0 0.5rem;
}

/* A branch other than the project's main branch is a filled warning chip,
   whose on-colour Vibe64's light and dark themes both define. */
.vibe64-save-target--off-main .vibe64-save-target__branch {
  background: rgb(var(--v-theme-warning));
  border-color: transparent;
  color: rgb(var(--v-theme-on-warning));
}

.vibe64-save-target__note {
  font-weight: 600;
}
</style>
