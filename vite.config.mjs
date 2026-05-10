import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import VueRouter from "vue-router/vite";
import { createJskitClientBootstrapPlugin } from "@jskit-ai/kernel/client/vite";
import { loadViteDevProxyEntries, toPositiveInt } from "./vite.shared.mjs";

const devPort = toPositiveInt(process.env.VITE_DEV_PORT, 5173);
const apiProxyTarget = String(process.env.VITE_API_PROXY_TARGET || "").trim() || "http://localhost:3000";
const viteModuleProxyEntries = loadViteDevProxyEntries({
  appRootUrl: import.meta.url,
  fallbackTarget: apiProxyTarget
});
const clientEntry = (() => {
  const normalized = String(process.env.VITE_CLIENT_ENTRY || "").trim();
  if (!normalized) {
    return "/src/main.js";
  }
  if (normalized.startsWith("/")) {
    return normalized;
  }
  if (normalized.startsWith("src/")) {
    return `/${normalized}`;
  }
  return `/src/${normalized}`;
})();

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  plugins: [
    createJskitClientBootstrapPlugin(),
    VueRouter({
      routesFolder: "src/pages",
      dts: "src/typed-router.d.ts",
      // nestedChildren deprecated: JSKIT now relies on native index/... nesting instead of route rewrites.
      // beforeWriteFiles: reparentNestedChildrenToIndexOwners
    }),
    vue(),
    {
      name: "jskit-client-entry",
      transformIndexHtml(source) {
        return String(source || "")
          .replace(/\/src\/%VITE_CLIENT_ENTRY%/g, clientEntry)
          .replace(/\/src\/main\.js/g, clientEntry);
      }
    }
  ],
  test: {
    include: ["tests/client/**/*.vitest.js"]
  },
  server: {
    port: devPort,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      },
      ...viteModuleProxyEntries
    }
  }
});
