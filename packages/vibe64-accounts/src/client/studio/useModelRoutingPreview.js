import { ref } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { ACCOUNTS_ENDPOINT } from "../lib/accountsGateApi.js";

/**
 * What the server says a routing draft would do.
 * @param {object} body
 * @param {AbortSignal} [signal]
 */
async function routingPreview(body, signal) {
  const result = await getHttpWebClient().request(`${ACCOUNTS_ENDPOINT}/model-routing/preview`, { method: "POST", body, signal });
  if (result?.ok !== true) throw new Error(result?.error || "Routing preview could not be loaded.");
  return result;
}

/**
 * The Models form's preview of its draft, asked for a moment after the draft stops changing. The form owns `preview`,
 * since reading the setup sets it too.
 * @param {{ preview: import("vue").Ref<object | null> }} options
 */
function useModelRoutingPreview({ preview }) {
  const previewPending = ref(false);
  const previewError = ref("");
  const retryPreview = ref(0);

  // Asks for one serialized draft's preview in 250 ms; returns the cancel, after which a late answer is dropped.
  function requestPreview(serialized) {
    const controller = new AbortController();
    let current = true;
    previewPending.value = true;
    const timer = setTimeout(async () => {
      try {
        const result = await routingPreview(JSON.parse(serialized), controller.signal);
        if (current) preview.value = result;
      } catch (error) { if (current) previewError.value = error.message; }
      finally { if (current) previewPending.value = false; }
    }, 250);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }

  return { previewError, previewPending, requestPreview, retryPreview };
}

export { routingPreview, useModelRoutingPreview };
