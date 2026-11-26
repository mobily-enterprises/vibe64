import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";
import VueRouter from "vue-router/vite";
import { createJskitClientBootstrapPlugin } from "@jskit-ai/kernel/client/vite";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const devPort = toPositiveInt(process.env.VITE_DEV_PORT, 5173);
const developmentPackages = JSON.parse(process.env.VIBE64_DEVELOPMENT_LOCAL_PACKAGES || "[]");
const apiProxyTarget = String(process.env.VITE_API_PROXY_TARGET || "").trim() || "http://localhost:3000";
// A server started with PORT needs its start's access key; the same
// VIBE64_LOCAL_ACCESS_TOKEN given to both lets this proxy send it.
const localAccessToken = String(process.env.VIBE64_LOCAL_ACCESS_TOKEN || "").trim();
const localAccessHeaders = localAccessToken ? { "x-vibe64-local-access": localAccessToken } : {};
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

// The loading screen (index.html) paints before the editor's stylesheets arrive. Vite links them in <head>, where
// every one would hold the first paint, so a built page links them at the end of <body>, after the screen. Vite's
// preload helper adds the stylesheets of lazily loaded modules after them there, so they still follow the page's own
// in the cascade, as at the end of <head>. The editor never shows unstyled: the page's module scripts run only once
// every stylesheet the parser met has loaded, wherever it stands, and a lazy import resolves once its stylesheets
// have. Listed before JSKIT's plugin, so the build id JSKIT digests is the finished page.
const stylesheetsAfterLoadingScreen = {
  name: "vibe64-stylesheets-after-loading-screen",
  enforce: "pre",
  transform: {
    filter: { id: /^\0vite\/preload-helper\.js$/u },
    handler(code) {
      const helper = code.replace("document.head.appendChild(link)", "document.body.appendChild(link)");
      if (helper === code) {
        this.error("vite.config.mjs adds lazily loaded stylesheets after the page's own, but Vite's preload helper no " +
          "longer appends them with document.head.appendChild(link).");
      }
      return helper;
    }
  },
  transformIndexHtml: {
    order: "post",
    handler(html, { bundle } = {}) {
      if (!bundle) {
        return html;
      }
      const stylesheets = [];
      const page = html.replace(/\s*<link rel="stylesheet"[^>]*>/gu, (tag) => {
        stylesheets.push(`\n    ${tag.trim()}`);
        return "";
      });
      return page.replace(/\s*<\/body>/u, `${stylesheets.join("")}\n  </body>`);
    }
  }
};

// What the first screen needs comes in few files: over a slow link a cold start waits a round trip for each handful
// of files, more than for their bytes. Every module the entry imports statically (Rolldown's $initial) comes in the
// entry's own file. The project page (/app/project/:slug, where the editor opens) stays a lazy route: its file holds
// the page and the modules it imports that nothing loaded without the page imports. The modules it shares with pages
// or components loaded without it come one file for each set of those that import them, so none of them loads more
// than before. A lazily loaded page or component loads only with the project page when it is one of the page's
// nested routes, shows the page itself, or only the page's own modules load it. Whatever a shared module imports is
// shared by the same pages or more, so these files import only files shared more widely, never in a circle, and a
// group need not pull in its modules' imports.
const indexPage = fileURLToPath(new URL("./index.html", import.meta.url));
const projectPage = fileURLToPath(new URL("./src/pages/app/project/[slug].vue", import.meta.url));
const projectPageRoutes = projectPage.replace(/\.vue$/u, "/");

// The modules `roots` import, the roots among them: statically, or with `lazy` also lazily.
function importedModules(chunking, roots, { lazy = false } = {}) {
  const modules = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const id = pending.pop();
    const info = modules.has(id) ? null : chunking.getModuleInfo(id);
    if (info) {
      modules.add(id);
      pending.push(...info.importedIds, ...(lazy ? info.dynamicallyImportedIds : []));
    }
  }
  return modules;
}

function projectPageModules(chunking) {
  for (const id of [indexPage, projectPage]) {
    if (!chunking.getModuleInfo(id)) {
      throw new Error(`vite.config.mjs puts the project page's modules in one file, but the build has no ${id}.`);
    }
  }
  const project = importedModules(chunking, [projectPage]);
  const loadedWithoutProjectPage = [...importedModules(chunking, [indexPage], { lazy: true })].filter((id) => {
    const { dynamicImporters } = chunking.getModuleInfo(id);
    return dynamicImporters.length > 0 && id !== projectPage && !id.startsWith(projectPageRoutes) &&
      !dynamicImporters.every((importer) => project.has(importer)) &&
      !importedModules(chunking, [id]).has(projectPage);
  });
  const sharers = new Map([...project].sort().map((id) => [id, []]));
  loadedWithoutProjectPage.forEach((entry, index) => {
    for (const id of importedModules(chunking, [entry])) {
      sharers.get(id)?.push(index);
    }
  });
  // A shared file is named after its first module, as Rolldown names its own, so it keeps its name across builds.
  const sharedChunks = new Map();
  return new Map([...sharers].map(([id, entries]) => {
    const key = entries.join();
    if (key && !sharedChunks.has(key)) {
      sharedChunks.set(key, `project-shared-${path.basename(id).replace(/[?#].*$/u, "").replace(/\.[^.]+$/u, "")}`);
    }
    return [id, key ? sharedChunks.get(key) : "project"];
  }));
}

const projectPageModulesByPass = new WeakMap();
function projectPageChunk(moduleId, chunking) {
  if (!projectPageModulesByPass.has(chunking)) {
    projectPageModulesByPass.set(chunking, projectPageModules(chunking));
  }
  return projectPageModulesByPass.get(chunking).get(moduleId) ?? null;
}

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    dedupe: ["vue", ...(developmentPackages.length ? ["pinia"] : [])],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  plugins: [
    stylesheetsAfterLoadingScreen,
    createJskitClientBootstrapPlugin({
      proxyTarget: apiProxyTarget
    }),
    VueRouter({
      routesFolder: "src/pages",
      dts: "src/typed-router.d.ts",
      // nestedChildren deprecated: JSKIT now relies on native index/... nesting instead of route rewrites.
      // beforeWriteFiles: reparentNestedChildrenToIndexOwners
    }),
    vue({
      features: {
        // A component's id names its scoped styles (data-v-…). In a build it hashes the component's source alone. The
        // default also hashes the path from the build's root, which for a component outside the root (a composition
        // links its packages from elsewhere) changes with the directory the build runs in, so the same source became
        // another client build and every open editor said "Vibe64 was updated". Development keeps the path-only id,
        // which stays put across edits for hot reload.
        componentIdGenerator: (filepath, source, isProduction, getHash) => getHash(isProduction ? source : filepath)
      }
    }),
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
    // As many test files at once as the machine's test budget allows.
    maxWorkers: testConcurrency(),
    // The time budget reporter fails a run that went over tooling/test-time-budgets.json.
    reporters: ["default", "./tooling/vitest-time-budget-reporter.mjs"],
    setupFiles: ["./tooling/test-host-path-guard.mjs"],
    server: {
      // The published assistant ships Vue source that needs the Vue transform.
      deps: { inline: ["@jskit-ai/assistant-core", "@jskit-ai/assistant-runtime", "@jskit-ai/assistant-voice", "vuetify"] }
    }
  },
  optimizeDeps: {
    include: ["vue", "@vue-flow/core"],
    exclude: developmentPackages.flatMap((name) => [name, `${name}/client`]),
    entries: [
      "index.html",
      "src/**/*.{js,ts,vue}",
      ...developmentPackages.map((name) => `node_modules/${name}/{src/client,src/shared,client,shared}/**/*.{js,ts,vue}`)
    ]
  },
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Preserve the xtermjs/xterm.js#5800 workaround when using Vite 8's
        // minifier: do not recompress or mangle xterm's already minified ESM.
        minify: { mangle: false, compress: false },
        codeSplitting: {
          groups: [
            { name: "startup", tags: ["$initial"], priority: 2 },
            { name: projectPageChunk, debugName: "project", priority: 1, includeDependenciesRecursively: false }
          ]
        }
      }
    }
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
        changeOrigin: false,
        headers: localAccessHeaders
      },
      "/api": {
        target: apiProxyTarget,
        changeOrigin: false,
        headers: localAccessHeaders,
        ws: true
      },
      "/socket.io": {
        target: apiProxyTarget,
        changeOrigin: false,
        headers: localAccessHeaders,
        ws: true
      }
    }
  }
});
