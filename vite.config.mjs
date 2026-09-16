import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";
import VueRouter from "vue-router/vite";
import { createJskitClientBootstrapPlugin } from "@jskit-ai/kernel/client/vite";
import {
  isLocalhostCheckBypassEnabled
} from "@local/vibe64-core/server/localhostCheckBypass";

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const devPort = toPositiveInt(process.env.VITE_DEV_PORT, 5173);
const apiProxyTarget = String(process.env.VITE_API_PROXY_TARGET || "").trim() || "http://localhost:3000";
const bypassLocalhostCheck = isLocalhostCheckBypassEnabled();
const apiProxyHeaders = bypassLocalhostCheck
  ? {
      origin: apiProxyTarget
    }
  : undefined;
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
  esbuild: {
    // Work around xtermjs/xterm.js#5800: @xterm/xterm 6.0.0 ships already
    // minified ESM that breaks when esbuild compresses and mangles it again.
    // Remove this after that issue is fixed and Vibe64 upgrades to the fix.
    minifyIdentifiers: false,
    minifySyntax: false
  },
  resolve: {
    preserveSymlinks: true,
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
      dts: "src/typed-router.d.ts",
      // nestedChildren deprecated: JSKIT now relies on native index/... nesting instead of route rewrites.
      // beforeWriteFiles: reparentNestedChildrenToIndexOwners
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
    server: {
      // The published assistant ships Vue source that needs the Vue transform.
      deps: { inline: ["@jskit-ai/assistant-core", "vuetify"] }
    }
  },
  optimizeDeps: {
    entries: [
      "index.html",
      "src/**/*.{js,ts,vue}"
    ]
  },
  build: {
    chunkSizeWarningLimit: 700
  },
  server: {
    port: devPort,
    warmup: {
      clientFiles: [
        "src/main.{js,ts}",
        "src/router/**/*.{js,ts}",
        "src/pages/**/*.{js,ts,vue}",
        "src/components/**/*.{js,ts,vue}"
      ]
    },
    proxy: {
      "^/app/?(?:\\?.*)?$": {
        target: apiProxyTarget,
        changeOrigin: true,
        headers: apiProxyHeaders
      },
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        headers: apiProxyHeaders,
        rewriteWsOrigin: bypassLocalhostCheck,
        ws: true
      }
    }
  }
});
