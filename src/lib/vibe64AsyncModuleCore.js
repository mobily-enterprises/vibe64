import { reactive } from "vue";

const DYNAMIC_IMPORT_ERROR_PATTERNS = Object.freeze([
  /ChunkLoadError/iu,
  /Failed to fetch dynamically imported module/iu,
  /Importing a module script failed/iu,
  /error loading dynamically imported module/iu,
  /Loading chunk .+ failed/iu,
  /Unable to preload CSS/iu
]);

const asyncModuleErrorState = reactive({
  attempt: 0,
  error: null,
  label: "",
  message: "",
  retry: null,
  stale: false,
  visible: false
});

let handlersInstalled = false;

function errorText(error = null) {
  return String(error?.message || error || "").trim();
}

function isVibe64AsyncImportError(error = null) {
  const text = errorText(error);
  return Boolean(text && DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => pattern.test(text)));
}

function vibe64AsyncModuleErrorMessage(error = null, {
  label = "Vibe64 module",
  stale = isVibe64AsyncImportError(error)
} = {}) {
  const moduleLabel = String(label || "Vibe64 module").trim();
  if (stale) {
    return `${moduleLabel} did not download. The app may have been updated, or the network request failed.`;
  }
  return `${moduleLabel} could not load.`;
}

function reloadVibe64App() {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

function notifyVibe64AsyncModuleError(error = null, {
  label = "Vibe64 module",
  retry = null,
  stale = isVibe64AsyncImportError(error)
} = {}) {
  asyncModuleErrorState.attempt += 1;
  asyncModuleErrorState.error = error || null;
  asyncModuleErrorState.label = String(label || "Vibe64 module").trim();
  asyncModuleErrorState.message = vibe64AsyncModuleErrorMessage(error, {
    label: asyncModuleErrorState.label,
    stale
  });
  asyncModuleErrorState.retry = typeof retry === "function" ? retry : null;
  asyncModuleErrorState.stale = stale;
  asyncModuleErrorState.visible = true;
}

function dismissVibe64AsyncModuleError() {
  asyncModuleErrorState.visible = false;
}

function installVibe64AsyncModuleErrorHandlers({
  router = null
} = {}) {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;

  if (router && typeof router.onError === "function") {
    router.onError((error, to = {}) => {
      if (!isVibe64AsyncImportError(error)) {
        return;
      }
      const fullPath = String(to?.fullPath || "");
      notifyVibe64AsyncModuleError(error, {
        label: "Page",
        retry: fullPath && typeof router.replace === "function"
          ? () => router.replace(fullPath)
          : null,
        stale: true
      });
    });
  }

  if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", (event) => {
      const error = event?.reason;
      if (!isVibe64AsyncImportError(error)) {
        return;
      }
      notifyVibe64AsyncModuleError(error, {
        label: "Vibe64 module",
        stale: true
      });
    });
  }
}

export {
  asyncModuleErrorState,
  dismissVibe64AsyncModuleError,
  installVibe64AsyncModuleErrorHandlers,
  isVibe64AsyncImportError,
  notifyVibe64AsyncModuleError,
  reloadVibe64App,
  vibe64AsyncModuleErrorMessage
};
