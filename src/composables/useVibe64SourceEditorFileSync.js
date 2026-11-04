import { onBeforeUnmount, watch } from "vue";

import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT,
  vibe64SourceEditorChangesStreamPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  parseJsonStreamEvent
} from "@/lib/streamEvents.js";
import {
  resolveStudioRequestUrl
} from "@/lib/studioUrls.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

/**
 * Observes the selected source file through the server's change stream while
 * the editor is active, and hands each change, readiness and error to the
 * editor. The stream follows the file, the session and activity, and closes
 * when the editor unmounts.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.active
 * @param {(payload: Record<string, any>) => void} options.onChange
 * @param {(error: { error?: string, fatal?: boolean, transient?: boolean }) => void} options.onError
 * @param {(payload: Record<string, any>) => void} options.onReady
 * @param {import("vue").MaybeRefOrGetter<string>} options.path
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionId
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionsApiPath
 */
function useVibe64SourceEditorFileSync({
  active = true,
  onChange,
  onError,
  onReady,
  path = "",
  sessionId = "",
  sessionsApiPath = ""
}) {
  let eventSource = null;

  function currentValue(value) {
    return String(readRefOrGetterValue(value) || "").trim();
  }

  function isActive() {
    return readRefOrGetterValue(active) !== false;
  }

  function close() {
    eventSource?.close();
    eventSource = null;
  }

  function start() {
    close();
    const currentPath = currentValue(path);
    const currentSessionId = currentValue(sessionId);
    const currentSessionsApiPath = currentValue(sessionsApiPath);
    if (
      !isActive() ||
      !currentPath ||
      !currentSessionId ||
      !currentSessionsApiPath ||
      typeof EventSource !== "function"
    ) {
      return;
    }

    let source;
    try {
      source = new EventSource(resolveStudioRequestUrl(vibe64SourceEditorChangesStreamPath(
        currentSessionsApiPath,
        currentSessionId,
        currentPath
      )), {
        withCredentials: true
      });
    } catch (error) {
      onError({
        error: String(error?.message || error || "Source file observation could not start."),
        fatal: true
      });
      return;
    }
    eventSource = source;
    const isCurrent = () => eventSource === source;

    source.addEventListener(VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT, (event) => {
      if (isCurrent()) {
        onChange(parseJsonStreamEvent(event));
      }
    });
    source.addEventListener(VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT, (event) => {
      if (!isCurrent()) {
        return;
      }
      onReady(parseJsonStreamEvent(event));
    });
    source.addEventListener(VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT, (event) => {
      if (isCurrent()) {
        const payload = parseJsonStreamEvent(event);
        onError(payload);
        if (payload.fatal === true) {
          close();
        }
      }
    });
    source.onerror = () => {
      if (isCurrent()) {
        onError({
          error: "Source file observation disconnected.",
          transient: true
        });
      }
    };
  }

  watch([
    () => isActive(),
    () => currentValue(path),
    () => currentValue(sessionId),
    () => currentValue(sessionsApiPath)
  ], start, {
    immediate: true
  });

  onBeforeUnmount(close);
}

export {
  useVibe64SourceEditorFileSync
};
