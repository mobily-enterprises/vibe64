import { onBeforeUnmount, ref, watch } from "vue";

/**
 * The session's shared ERD layout as this workspace shows it. A newer saved revision replaces it while the workspace
 * is active and none of its own saves is pending. Saves run one at a time in order; each shows its layout at once,
 * and a failed save, if no later save followed, restores the last acknowledged layout. Saves queued for another
 * session, or after the workspace is unmounted, are not sent.
 * @param {{
 *   active: () => boolean,
 *   saveLayout: (layout: Record<string, any>) => Promise<{ layout?: Record<string, any> } | null>,
 *   sessionId: () => string,
 *   state: import("vue").ComputedRef<Record<string, any> | null>
 * }} options
 */
function useDatabaseDiagramLayout({ active, saveLayout, sessionId, state }) {
  const erdLayout = ref({ nodes: [] });
  const diagramSavesPending = ref(0);
  let disposed = false;
  let diagramSaveQueue = Promise.resolve();
  let diagramSaveRevision = 0;

  watch([() => state.value?.layout, active, diagramSavesPending], ([layout, isActive, pending]) => {
    if (isActive && !pending && layout && layout.revision > (erdLayout.value.revision || 0)) {
      erdLayout.value = layout;
    }
  }, { immediate: true });

  onBeforeUnmount(() => {
    disposed = true;
  });

  /**
   * @param {Record<string, any>} layout
   */
  function saveDiagramLayout(layout) {
    const savedSessionId = sessionId();
    const revision = ++diagramSaveRevision;
    const previousLayout = erdLayout.value;
    const pending = JSON.parse(JSON.stringify(layout));
    pending.revision = previousLayout.revision || 0;
    diagramSavesPending.value += 1;
    erdLayout.value = pending;
    diagramSaveQueue = diagramSaveQueue.catch(() => null).then(async () => {
      try {
        if (disposed || sessionId() !== savedSessionId) return;
        const result = await saveLayout(pending);
        if (!disposed && sessionId() === savedSessionId && revision === diagramSaveRevision) {
          erdLayout.value = result?.layout || previousLayout;
        }
      } catch {
        // The command owns failure feedback; restore the last acknowledged layout.
        if (!disposed && sessionId() === savedSessionId && revision === diagramSaveRevision) {
          erdLayout.value = previousLayout;
        }
      } finally {
        diagramSavesPending.value -= 1;
      }
    });
    return diagramSaveQueue;
  }

  return {
    erdLayout,
    saveDiagramLayout
  };
}

export { useDatabaseDiagramLayout };
