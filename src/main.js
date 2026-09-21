import { createApp } from "vue";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createWebHistory } from "vue-router/auto";
import { routes } from "vue-router/auto-routes";
import "vuetify/styles";
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

const vuetify = createVuetify({
  theme: {
    defaultTheme: "light",
    themes: {
      light: {
        colors: {
          warning: "#725C0C",
          "on-warning": "#FFFFFF",
          "warning-container": "#F5F0E3",
          "on-warning-container": "#252117"
        }
      },
      dark: {
        colors: {
          warning: "#DFC477",
          "on-warning": "#3D2F00",
          "warning-container": "#353126",
          "on-warning-container": "#EAE1CF"
        }
      }
    }
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
