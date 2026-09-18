import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { githubProjectAvailable, githubProjectRepositoryName, invalidateGithubIssueQueries } from "@/lib/vibe64GithubProject.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

// Unsent comments belong to this browser tab, not project source or GitHub.
const drafts = reactive(new Map());

export function useVibe64Issues(context) {
  const route = useRoute();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useUiFeedback({ source: "vibe64.issues" });
  const projectSlug = computed(() => projectSlugFromRoute(route));
  const repository = computed(() => githubProjectRepositoryName(context.value.projectContext));
  const available = computed(() => githubProjectAvailable(context.value.projectContext));
  const active = computed(() => available.value && context.value.active !== false);
  const basePath = computed(() => scopedDevelopmentApiUrl("/api/vibe64/issues", projectSlug.value));
  const state = computed(() => ["open", "closed", "all"].includes(route.query.issueState) ? route.query.issueState : "open");
  const search = computed(() => typeof route.query.issueSearch === "string" ? route.query.issueSearch : "");
  const searchDraft = ref(search.value);
  watch(search, (value) => { searchDraft.value = value; });
  const selectedLabels = computed(() => {
    const labels = route.query.issueLabel;
    return (Array.isArray(labels) ? labels : [labels]).filter((label) => typeof label === "string" && label.trim());
  });
  const number = computed(() => /^\d+$/u.test(String(route.query.issue || "")) ? String(route.query.issue) : "");
  const commentCursor = ref("");
  watch([basePath, number], () => { commentCursor.value = ""; });
  const listQuery = computed(() => ({ state: state.value, search: search.value, labels: selectedLabels.value,
    ...(route.query.issueCursor ? { cursor: route.query.issueCursor } : {}) }));
  const listKey = computed(() => ["vibe64.issues", basePath.value, listQuery.value]);
  const list = useEndpointResource({
    path: basePath, readQuery: listQuery, queryKey: listKey,
    enabled: computed(() => active.value && !number.value), queryOptions: { retry: false },
    requestRecoveryLabel: "GitHub issues", fallbackLoadError: "Issues could not load."
  });
  const labelsPath = computed(() => basePath.value.replace(/\/issues$/u, "/issue-labels"));
  const labelCatalog = useEndpointResource({
    path: labelsPath, queryKey: computed(() => ["vibe64.issueLabels", labelsPath.value]),
    enabled: computed(() => active.value && !number.value), queryOptions: { retry: false },
    fallbackLoadError: "Labels could not load."
  });
  const detailPath = computed(() => `${basePath.value}/${number.value}`);
  const detail = useEndpointResource({
    path: detailPath, readQuery: computed(() => commentCursor.value ? { cursor: commentCursor.value } : {}),
    queryKey: computed(() => ["vibe64.issue", detailPath.value, commentCursor.value]),
    enabled: computed(() => active.value && Boolean(number.value)), queryOptions: { retry: false },
    requestRecoveryLabel: "GitHub issue", fallbackLoadError: "This issue could not load."
  });
  const issue = computed(() => detail.data.value?.issue || null);
  const draft = computed({
    get: () => drafts.get(detailPath.value) || "",
    set: (value) => value ? drafts.set(detailPath.value, value) : drafts.delete(detailPath.value)
  });
  const pending = ref("");

  function navigate(changes) {
    return router.push({ query: { ...route.query, ...changes } });
  }
  function filter(nextState = state.value, nextLabels = selectedLabels.value) {
    return navigate({ issueState: nextState, issueSearch: String(searchDraft.value || "").trim() || undefined,
      issueLabel: nextLabels?.length ? nextLabels : undefined,
      issueCursor: undefined, issue: undefined });
  }
  async function issueSaved({ number: issueNumber, basePath: requestBasePath }) {
    await invalidateGithubIssueQueries(queryClient, requestBasePath, `${requestBasePath}/${issueNumber}`);
    if (basePath.value === requestBasePath) await navigate({ issue: String(issueNumber) });
  }
  async function mutate(kind) {
    if (pending.value || !issue.value || !active.value) return;
    const requestBasePath = basePath.value;
    const requestPath = detailPath.value;
    const submitted = draft.value;
    const commenting = kind === "comment";
    if (commenting && (!submitted.trim() || submitted.length > 65536)) return;
    pending.value = kind;
    try {
      await detail.save(commenting ? vibe64RealtimeOriginPayload({ body: submitted }) : {
        state: issue.value.state === "OPEN" ? "closed" : "open"
      }, { path: commenting ? `${requestPath}/comments` : requestPath,
        method: commenting ? "POST" : "PATCH" });
      if (commenting && drafts.get(requestPath) === submitted) drafts.delete(requestPath);
      if (detailPath.value === requestPath) commentCursor.value = "";
      feedback.success(commenting ? "Comment added." : "Issue updated.");
      await invalidateGithubIssueQueries(queryClient, requestBasePath, requestPath);
    } catch (error) {
      feedback.error(error, commenting ? "Comment could not be confirmed. Refresh before posting again." : "Issue could not be updated.");
    } finally { pending.value = ""; }
  }
  return { available, repository, projectSlug, basePath, list, detail, labelCatalog, issue, number, state, searchDraft, selectedLabels,
    draft, pending, commentCursor, navigate, filter, mutate, issueSaved };
}
