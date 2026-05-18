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
import { config } from "../config/public.js";

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
    defaultTheme: "light"
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
});
