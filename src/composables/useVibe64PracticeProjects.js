import { computed, ref, toValue } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "@local/vibe64-training/shared/learner-events";
import { VIBE64_PROJECT_CHANGED_EVENT } from "@/lib/studioGateApi.js";
import { VIBE64_LEARNING_ROUTES } from "@/lib/vibe64Learning.js";

const LEARNING_PATH = "/api/vibe64/training/learning";

// Local practice projects live in the learner's private namespace, so the
// standalone source is the learner's own learning.read: its `attempts[]` name
// each attempt's `practiceSlug`, `pin.lesson.code` and `ended`. The v1
// active/history shape has no practice slug and yields no rows, so no delete is
// offered against a server without vibe64.training.practice.delete. This
// adapter owns no admission; the Training actions re-authorize every read and delete.
function practiceProjectsFromLearning(result = null) {
  if (result?.ok !== true || result.available !== true || !Array.isArray(result.attempts)) return [];
  const attempts = result.attempts;
  const seen = new Set();
  const projects = [];
  for (const attempt of attempts) {
    const slug = String(attempt?.practiceSlug || "").trim();
    const attemptId = String(attempt?.attemptId || "").trim();
    if (!slug || !attemptId || seen.has(slug)) continue;
    seen.add(slug);
    projects.push({
      slug,
      attemptId,
      lessonCode: String(attempt?.pin?.lesson?.code || ""),
      lessonTitle: String(attempt?.lessonTitle || ""),
      ended: Boolean(attempt?.ended),
      mine: true,
      deleteAvailable: true
    });
  }
  return projects;
}

function useVibe64PracticeProjects({ enabled = true } = {}) {
  const deletingSlug = ref("");
  const active = computed(() => toValue(enabled) === true);
  const resource = useEndpointResource({
    enabled: active,
    fallbackLoadError: "Practice projects could not load.",
    path: LEARNING_PATH,
    queryKey: ["vibe64", "training", "learning", VIBE64_SURFACE_ID, "practice-projects"],
    queryOptions: { retry: false },
    refreshOnPull: true,
    requestRecoveryLabel: "Practice projects",
    realtime: { events: [VIBE64_TRAINING_LEARNER_CHANGED_EVENT, VIBE64_PROJECT_CHANGED_EVENT] }
  });
  const practiceProjects = computed(() => active.value ? practiceProjectsFromLearning(resource.data.value) : []);
  const deleteCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/training",
    buildCommandOptions: (_model, { context }) => ({ method: "POST", path: VIBE64_LEARNING_ROUTES.practiceDelete(String(context.attemptId || "")) }),
    buildRawPayload: () => ({}),
    fallbackRunError: "Practice project could not be deleted.",
    messages: { error: "Practice project could not be deleted.", success: "Practice project deleted." },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.training.practice.delete",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const deleteError = computed(() => deleteCommand.messageType === "error" ? String(deleteCommand.message || "") : "");

  // D-b: the learner's own practice project is deleted with one click; the
  // command's snackbar reports the outcome. No archive is kept.
  async function deletePracticeProject(project = {}) {
    if (!project?.attemptId || project.deleteAvailable !== true || deletingSlug.value) return false;
    deletingSlug.value = String(project.slug || "");
    try {
      const result = await deleteCommand.run({ attemptId: project.attemptId });
      await resource.reload();
      return result?.ok !== false && Boolean(result);
    } finally {
      deletingSlug.value = "";
    }
  }

  return { deleteError, deletePracticeProject, deletingSlug, practiceProjects, reload: resource.reload, resource };
}

export { practiceProjectsFromLearning, useVibe64PracticeProjects };
