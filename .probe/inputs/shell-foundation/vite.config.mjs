import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";
import VueRouter from "vue-router/vite";
import { createJskitClientBootstrapPlugin } from "@jskit-ai/kernel/client/vite";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

const configuredDevPort = Number.parseInt(String(process.env.VITE_DEV_PORT || "").trim(), 10);
const devPort = Number.isInteger(configuredDevPort) && configuredDevPort > 0 ? configuredDevPort : 5173;
const apiProxyTarget = String(process.env.VITE_API_PROXY_TARGET || "").trim() || "http://localhost:3000";
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
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  plugins: [
    createJskitClientBootstrapPlugin({
      proxyTarget: apiProxyTarget
    }),
    VueRouter({
      routesFolder: "src/pages",
      // Generated on the first Vite dev/build scan and intentionally gitignored.
      dts: "src/typed-router.d.ts",
      nestedChildren: false
    }),
    vue(),
    vuetify({
      autoImport: true
    }),
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
    include: ["tests/client/**/*.vitest.js"],
    maxWorkers: testConcurrency()
  },
  optimizeDeps: {
    include: ["vuetify/components/**", "vuetify/directives/**"],
    entries: [
      "index.html",
      "src/**/*.{js,ts,vue}"
    ]
  },
  server: {
    port: devPort,
    warmup: {
      clientFiles: [clientEntry.slice(1)]
    },
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  }
});
