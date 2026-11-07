import { createApp } from "vue";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createWebHistory } from "vue-router/auto";
import { routes } from "vue-router/auto-routes";
import "vuetify/styles";
import "./styles/vibe64-font.css";
import "./styles/vibe64-m3.css";
import { createVuetify } from "vuetify";
import { aliases as mdiAliases, mdi } from "vuetify/iconsets/mdi-svg";
import App from "./App.vue";
import NotFoundView from "./views/NotFound.vue";
import { bootInstalledClientModules } from "virtual:jskit-client-bootstrap";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import {
  shouldRetryTransientQueryFailure,
  transientQueryRetryDelay
} from "@jskit-ai/kernel/shared/support";
import {
  bootstrapClientShellApp,
  createShellRouter
} from "@jskit-ai/kernel/client";
import { configureHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { config } from "../config/public.js";
import {
  bootBrowserLifecycle
} from "./lib/browserLifecycleBootstrap.js";
import { resolveStudioRequestUrl } from "./lib/studioUrls.js";
import { readAppearance } from "./lib/appearance.js";
import { vibe64Themes } from "./lib/vibe64Theme.js";
import { hasWindowFunction } from "./lib/browser.js";

configureHttpWebClient({
  csrf: {
    enabled: false
  },
  resolveRequestUrl(url) {
    return resolveStudioRequestUrl(url);
  }
});

bootBrowserLifecycle();

const surfaceRuntime = createSurfaceRuntime({
  allMode: config.surfaceModeAll,
  surfaces: config.surfaceDefinitions,
  defaultSurfaceId: config.surfaceDefaultId
});

const surfaceMode = surfaceRuntime.normalizeSurfaceMode(import.meta.env.VITE_SURFACE);
const { router, fallbackRoute } = createShellRouter({
  createRouter,
  history: createWebHistory(),
  routes,
  surfaceRuntime,
  surfaceMode,
  notFoundComponent: NotFoundView,
  guard: {
    surfaceDefinitions: config.surfaceDefinitions,
    defaultSurfaceId: config.surfaceDefaultId,
    webRootAllowed: config.webRootAllowed
  }
});

// With the device's reduced-motion setting, menus, selects and dialogs open and
// close at once, as the rest of the app's transitions do (src/styles/vibe64-m3.css).
// Vuetify still fades them from JavaScript then, which no stylesheet can end, and
// a menu ignores taps until its fade ends: 125 ms as it opens, 85 ms as it closes.
function menuAndDialogMotion() {
  if (!hasWindowFunction("matchMedia") || !window.matchMedia("(prefers-reduced-motion: reduce)").matches) return {};
  return Object.fromEntries(["VMenu", "VSelect", "VAutocomplete", "VCombobox", "VDialog"].map((name) => [name, { transition: false }]));
}

const vuetify = createVuetify({
  theme: {
    defaultTheme: readAppearance(),
    themes: vibe64Themes
  },
  // Material 3 shape defaults: medium-rounded cards and alerts. Explicit
  // component props still win.
  defaults: {
    VCard: { rounded: "lg" },
    VAlert: { rounded: "lg" },
    ...menuAndDialogMotion()
  },
  icons: {
    defaultSet: "mdi",
    aliases: mdiAliases,
    sets: { mdi }
  }
});
const pinia = createPinia();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: shouldRetryTransientQueryFailure,
      retryDelay: transientQueryRetryDelay
    }
  }
});

void bootstrapClientShellApp({
  createApp,
  rootComponent: App,
  appConfig: config,
  appPlugins: [
    pinia,
    [VueQueryPlugin, { queryClient }],
    vuetify
  ],
  pinia,
  queryClient,
  router,
  bootClientModules: bootInstalledClientModules,
  surfaceRuntime,
  surfaceMode,
  env: import.meta.env,
  fallbackRoute
}).catch((error) => {
  console.error("Failed to bootstrap client app.", error);
  const status = document.getElementById("startup-status");
  if (status) {
    status.textContent = "Vibe64 could not open. Reload the page to try again.";
  }
});
