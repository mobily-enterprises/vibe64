import { computed, ref } from "vue";

/**
 * The watches, ongoing assignments and recent operation receipts that
 * Colleague's product read reports, and what their dialogs do: resume or
 * cancel a watch, open an operation's saved target, or prepare a draft that
 * inspects or retries an uncertain or failed operation.
 * @param {object} options
 * @param {import("vue").Ref<object>} options.product
 * @param {import("vue").WritableComputedRef<string>} options.draft
 * @param {(suffix: string, options: object) => Promise<object>} options.requestColleague
 * @param {() => Promise<void>} options.refresh
 * @param {(error: unknown) => void} options.reportFailure
 * @param {() => ((target: object) => Promise<object>) | null} options.readNavigate
 */
function useColleagueWatchesAndOperations({ product, draft, requestColleague, refresh, reportFailure, readNavigate }) {
  const watchDetails = ref(false);
  const operationDetails = ref(false);
  const watches = computed(() => (product.value.watches || []).filter((item) => !item.assignmentId && ["active", "pending", "paused"].includes(item.status)));
  const operations = computed(() => product.value.operations || (product.value.operation ? [product.value.operation] : []));
  const assignments = computed(() => (product.value.assignments || []).filter((item) => ["active", "waiting", "needs-user"].includes(item.status)));
  const watchControlCount = computed(() => watches.value.length + assignments.value.length);
  async function changeWatch(watch, operation) {
    try {
      await requestColleague(`/watches/${operation}`, { method: "POST", body: { watchId: watch.watchId } });
      await refresh();
    } catch (error) { reportFailure(error); }
  }
  async function openOperationTarget(item) {
    const target = item?.target;
    const navigate = readNavigate();
    if (!target?.projectSlug || !navigate) return reportFailure("This operation target cannot be opened from the current app.");
    try {
      const result = await navigate({ projectSlug: target.projectSlug,
        ...(target.sessionId ? { sessionId: target.sessionId } : {}),
        ...(target.conversationId ? { conversationId: target.conversationId } : {}) });
      const opened = result?.focus || result;
      if (opened?.projectSlug !== target.projectSlug || target.sessionId && opened.sessionId !== target.sessionId ||
          target.conversationId && opened.conversationId !== target.conversationId) {
        throw new Error("The operation target did not open.");
      }
      operationDetails.value = false;
    } catch (error) { reportFailure(error); }
  }
  function prepareOperationRecovery(item) {
    if (!item?.id || !["failed", "unknown"].includes(item.status)) return false;
    const target = [item.target?.projectSlug, item.target?.sessionId, item.target?.conversationId].filter(Boolean).join(" / ") || "its saved target";
    draft.value = item.status === "unknown"
      ? `Inspect the saved target for the uncertain ${item.label} receipt (${item.id}) at ${target}. Tell me what actually happened. Do not repeat the operation unless inspection proves no effect and I explicitly ask you to continue.`
      : `Recheck the saved target for the failed ${item.label} receipt (${item.id}) at ${target}, then retry only if the operation is still needed and safe. Do not repeat any confirmed side effect.`;
    operationDetails.value = false;
    return true;
  }
  return { watchDetails, operationDetails, watches, operations, assignments, watchControlCount,
    changeWatch, openOperationTarget, prepareOperationRecovery };
}

export { useColleagueWatchesAndOperations };
