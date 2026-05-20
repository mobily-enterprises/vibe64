import { onBeforeUnmount, ref, watch } from "vue";
import { parseJsonStreamEvent } from "@/lib/streamEvents.js";

function statusListKey(statusItemsKey = "checks", status = null) {
  if (statusItemsKey === "stages") {
    return "stages";
  }
  if (statusItemsKey === "checks") {
    return "checks";
  }
  return Array.isArray(status?.stages) ? "stages" : "checks";
}

function cloneStatus(status = null, statusItemsKey = "checks") {
  if (!status) {
    const key = statusListKey(statusItemsKey, null);
    return {
      ok: true,
      ready: false,
      [key]: []
    };
  }
  return {
    ...status,
    checks: Array.isArray(status.checks) ? [...status.checks] : status.checks,
    stages: Array.isArray(status.stages) ? [...status.stages] : status.stages
  };
}

function withRefreshQuery(endpoint, refresh = false) {
  if (!refresh) {
    return endpoint;
  }
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}refresh=true`;
}

function useDoctorStream({
  onRefresh = null,
  onStatusUpdated = null,
  statusItemsKey = () => "checks",
  streamAutoStart = () => true,
  streamEnabled = () => false,
  streamEndpoint = () => "",
  status = () => null
} = {}) {
  const liveStatus = ref(null);
  const streamError = ref("");
  const streamRunning = ref(false);

  let eventSource = null;
  let eventSourceEndpoint = "";

  const refreshFallback = typeof onRefresh === "function" ? onRefresh : () => null;
  const notifyStatusUpdated = typeof onStatusUpdated === "function" ? onStatusUpdated : () => null;

  function currentStatusItemsKey(nextStatus = liveStatus.value || status()) {
    return statusListKey(statusItemsKey(), nextStatus);
  }

  function closeDoctorStream(source = eventSource) {
    if (source) {
      source.close();
    }
    if (!source || source === eventSource) {
      eventSource = null;
      eventSourceEndpoint = "";
    }
  }

  function replaceStatusItem(item) {
    const nextStatus = cloneStatus(liveStatus.value || status(), statusItemsKey());
    const key = currentStatusItemsKey(nextStatus);
    const items = Array.isArray(nextStatus[key]) ? [...nextStatus[key]] : [];
    const itemIndex = items.findIndex((candidate) => candidate.id === item.id);
    if (itemIndex >= 0) {
      items[itemIndex] = {
        ...items[itemIndex],
        ...item
      };
    } else {
      items.push(item);
    }
    nextStatus[key] = items;
    nextStatus.ready = false;
    liveStatus.value = nextStatus;
  }

  function startDoctorStream({
    force = false,
    refresh = false
  } = {}) {
    const endpoint = withRefreshQuery(String(streamEndpoint() || ""), refresh);
    if (!endpoint || !streamEnabled()) {
      return false;
    }
    if (typeof EventSource !== "function") {
      refreshFallback({ refresh });
      return false;
    }
    if (!force && eventSource && streamRunning.value && eventSourceEndpoint === endpoint) {
      return true;
    }

    closeDoctorStream();
    streamError.value = "";
    streamRunning.value = true;
    liveStatus.value = cloneStatus(status(), statusItemsKey());

    const source = new EventSource(endpoint, {
      withCredentials: true
    });
    eventSource = source;
    eventSourceEndpoint = endpoint;

    const isCurrentStream = () => source === eventSource;

    source.addEventListener("run.started", () => {
      if (!isCurrentStream()) {
        return;
      }
      streamRunning.value = true;
      streamError.value = "";
    });
    source.addEventListener("check.started", (event) => {
      if (!isCurrentStream()) {
        return;
      }
      const payload = parseJsonStreamEvent(event);
      replaceStatusItem({
        explanation: "Studio is checking this now.",
        expected: "Check is running.",
        id: payload.id,
        label: payload.label || payload.id,
        observed: "Running...",
        required: true,
        status: "running"
      });
    });
    source.addEventListener("check.finished", (event) => {
      if (!isCurrentStream()) {
        return;
      }
      const payload = parseJsonStreamEvent(event);
      if (payload.check?.id) {
        replaceStatusItem(payload.check);
      }
    });
    source.addEventListener("check.error", (event) => {
      if (!isCurrentStream()) {
        return;
      }
      const payload = parseJsonStreamEvent(event);
      replaceStatusItem({
        explanation: "The check raised an unexpected error.",
        expected: "Check completes without throwing.",
        id: payload.id,
        label: payload.label || payload.id,
        observed: payload.error || "Check failed.",
        required: true,
        status: "fail"
      });
    });
    source.addEventListener("run.finished", (event) => {
      if (!isCurrentStream()) {
        return;
      }
      const payload = parseJsonStreamEvent(event);
      liveStatus.value = payload.status || liveStatus.value;
      if (payload.status) {
        notifyStatusUpdated(payload.status);
      }
      streamRunning.value = false;
      closeDoctorStream(source);
    });
    source.addEventListener("run.error", (event) => {
      if (!isCurrentStream()) {
        return;
      }
      const payload = parseJsonStreamEvent(event);
      streamError.value = payload.error || "Doctor stream failed.";
      streamRunning.value = false;
      closeDoctorStream(source);
    });
    source.onerror = () => {
      if (!isCurrentStream()) {
        return;
      }
      if (streamRunning.value) {
        streamError.value = "Doctor stream disconnected.";
        streamRunning.value = false;
      }
      closeDoctorStream(source);
    };
    return true;
  }

  function refreshDoctorStatus() {
    if (!startDoctorStream({ force: true, refresh: true })) {
      refreshFallback({ refresh: true });
    }
  }

  watch(status, (nextStatus) => {
    if (nextStatus && !streamRunning.value) {
      liveStatus.value = nextStatus;
    }
  }, {
    immediate: true
  });

  watch(() => [streamEndpoint(), streamEnabled(), streamAutoStart()], () => {
    if (streamEnabled() && streamEndpoint() && streamAutoStart()) {
      startDoctorStream();
      return;
    }
    if (!streamEnabled() || !streamEndpoint()) {
      closeDoctorStream();
      streamRunning.value = false;
    }
  }, {
    immediate: true
  });

  onBeforeUnmount(() => {
    closeDoctorStream();
  });

  return {
    closeDoctorStream,
    liveStatus,
    refreshDoctorStatus,
    startDoctorStream,
    streamError,
    streamRunning
  };
}

export {
  useDoctorStream
};
