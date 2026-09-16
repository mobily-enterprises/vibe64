import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const STATIC_SERVER_ENTRY_PATH = "server.static.mjs";
const STATIC_SERVER_PROVIDER_REGISTRY_PATH = ".jskit/static-server-provider-registry.mjs";
const SERVER_BUNDLE_PATH = "server.bundle.mjs";
const SERVER_BUNDLE_LINE_LIMIT = 120;
const SERVER_BUNDLE_EXTERNALS = [
  "@fastify/ajv-compiler", "@fastify/fast-json-stringify-compiler",
  "@vue/compiler-sfc", "@vue/compiler-sfc/*", "fast-json-stringify", "fast-json-stringify/*",
  "genesis-compiler", "genesis-compiler/*", "knex", "knex/*",
  "node-pty", "node-pty/*", "ts-morph", "ts-morph/*"
];

function sortStrings(values = []) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function jsString(value = "") {
  return JSON.stringify(String(value || ""));
}

function importPathBetween(fromFile = "", toFile = "") {
  const relative = path.relative(path.dirname(path.resolve(fromFile)), path.resolve(toFile)).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function normalizeUiRoutePath(pathValue = "") {
  const rawPath = String(pathValue || "").trim();
  if (!rawPath || !rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return "";
  }
  const normalized = rawPath.replace(/\/{2,}/g, "/");
  return normalized === "/" ? "/" : normalized.replace(/\/+$/g, "") || "/";
}

function collectGlobalUiPaths(descriptorEntries = []) {
  const paths = [];
  for (const entry of descriptorEntries) {
    const routes = Array.isArray(entry?.descriptor?.metadata?.ui?.routes)
      ? entry.descriptor.metadata.ui.routes
      : [];
    for (const route of routes) {
      const record = route && typeof route === "object" && !Array.isArray(route) ? route : {};
      if (String(record.scope || "").trim().toLowerCase() !== "global") {
        continue;
      }
      const routePath = normalizeUiRoutePath(record.path);
      if (routePath) {
        paths.push(routePath);
      }
    }
  }
  return sortStrings([...new Set(paths)]);
}

function resolveDescriptorLoadOrder(descriptorEntries = []) {
  const byPackageId = new Map(descriptorEntries.map((entry) => [entry.packageId, entry]));
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  function visit(packageId = "", lineage = []) {
    if (visited.has(packageId)) {
      return;
    }
    if (visiting.has(packageId)) {
      throw new Error(`Package dependency cycle detected: ${[...lineage, packageId].join(" -> ")}`);
    }
    const entry = byPackageId.get(packageId);
    if (!entry) {
      return;
    }
    visiting.add(packageId);
    for (const dependencyPackageId of Array.isArray(entry.descriptor?.dependsOn) ? entry.descriptor.dependsOn : []) {
      if (byPackageId.has(dependencyPackageId)) {
        visit(dependencyPackageId, [...lineage, packageId]);
      }
    }
    visiting.delete(packageId);
    visited.add(packageId);
    ordered.push(entry);
  }

  for (const packageId of sortStrings(byPackageId.keys())) {
    visit(packageId);
  }
  return ordered;
}

async function collectStaticProviderImports({
  descriptorEntry = {},
  registryPath = ""
} = {}) {
  const providers = Array.isArray(descriptorEntry.descriptor?.runtime?.server?.providers)
    ? descriptorEntry.descriptor.runtime.server.providers
    : [];
  const imports = [];
  let index = 0;
  for (const provider of providers) {
    const record = provider && typeof provider === "object" && !Array.isArray(provider) ? provider : {};
    if (record.discover) {
      throw new Error(
        `Static server provider registry does not support discovered providers yet: ${descriptorEntry.packageId}`
      );
    }
    const entrypoint = String(record.entrypoint || "").trim();
    const exportName = String(record.export || "").trim();
    if (!entrypoint || !exportName) {
      throw new Error(`Static server provider registry requires explicit entrypoint/export for ${descriptorEntry.packageId}.`);
    }
    if (entrypoint.startsWith("/") || entrypoint.includes("..")) {
      throw new Error(`Static server provider entrypoint must stay inside package root: ${descriptorEntry.packageId}`);
    }
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(exportName)) {
      throw new Error(`Static server provider export is invalid for ${descriptorEntry.packageId}: ${exportName}`);
    }
    const providerPath = path.join(descriptorEntry.packageRoot, entrypoint);
    const packageToken = descriptorEntry.packageId.replace(/[^A-Za-z0-9_$]/gu, "_");
    const localName = `Provider_${packageToken}_${index}`;
    imports.push({
      exportName,
      importPath: importPathBetween(registryPath, providerPath),
      localName,
      packageId: descriptorEntry.packageId
    });
    index += 1;
  }
  return imports;
}

async function writeStaticServerProviderRegistry({
  appRoot = ""
} = {}) {
  const installedPackagesModulePath = path.join(
    appRoot,
    "node_modules",
    "@jskit-ai",
    "kernel",
    "internal",
    "node",
    "installedPackages.js"
  );
  const { discoverInstalledPackages } = await import(pathToFileURL(installedPackagesModulePath).href);
  const installedPackages = await discoverInstalledPackages({
    appRoot
  });
  const descriptorEntries = installedPackages.map((installedPackage) => ({
    descriptor: {
      dependsOn: installedPackage.dependencyIds,
      metadata: installedPackage.packageMetadata.metadata,
      runtime: installedPackage.packageMetadata.runtime
    },
    packageId: installedPackage.packageId,
    // Every provider must enter the bundle through this composed node_modules
    // tree. Importing public providers through their discovered real paths
    // while other providers enter through composed package paths gives stateful local
    // packages two module identities when esbuild preserves symlinks.
    packageRoot: path.join(
      appRoot,
      "node_modules",
      ...installedPackage.packageId.split("/")
    )
  }));
  const orderedDescriptors = resolveDescriptorLoadOrder(descriptorEntries);
  const registryPath = path.join(appRoot, STATIC_SERVER_PROVIDER_REGISTRY_PATH);
  const providerImports = [];
  const providerPackageOrder = [];
  for (const descriptorEntry of orderedDescriptors) {
    const imports = await collectStaticProviderImports({
      descriptorEntry,
      registryPath
    });
    if (imports.length > 0) {
      providerPackageOrder.push(descriptorEntry.packageId);
      providerImports.push(...imports);
    }
  }

  const importLines = [
    ...providerImports.map((entry) => (
      `import { ${entry.exportName} as ${entry.localName} } from ${jsString(entry.importPath)};`
    ))
  ];
  const providerNames = providerImports.map((entry) => entry.localName);

  await mkdir(path.dirname(registryPath), {
    recursive: true
  });
  await writeFile(
    registryPath,
    `${[
      ...importLines,
      "",
      `const packageOrder = Object.freeze(${JSON.stringify(orderedDescriptors.map((entry) => entry.packageId), null, 2)});`,
      `const globalUiPaths = Object.freeze(${JSON.stringify(collectGlobalUiPaths(orderedDescriptors), null, 2)});`,
      `const providerPackageOrder = Object.freeze(${JSON.stringify(providerPackageOrder, null, 2)});`,
      `const providers = Object.freeze([${providerNames.join(", ")}]);`,
      "",
      "export {",
      "  globalUiPaths,",
      "  packageOrder,",
      "  providers,",
      "  providerPackageOrder",
      "};",
      ""
    ].join("\n")}`,
    "utf8"
  );
  return STATIC_SERVER_PROVIDER_REGISTRY_PATH;
}

async function writeStaticServerEntry({
  appRoot = ""
} = {}) {
  const entryPath = path.join(appRoot, STATIC_SERVER_ENTRY_PATH);
  await writeFile(
    entryPath,
    `${[
      'import { createActionProvider } from "@jskit-ai/kernel/server/actions";',
      'import { HttpProvider } from "@jskit-ai/kernel/server/http";',
      'import { BootstrapProvider, EventProvider } from "@jskit-ai/kernel/server/runtime";',
      'import { createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";',
      'import {',
      '  createServer as createBaseServer,',
      '  startServer as startBaseServer',
      '} from "./server.js";',
      'import {',
      '  globalUiPaths,',
      '  packageOrder,',
      '  providers,',
      '  providerPackageOrder',
      '} from "./.jskit/static-server-provider-registry.mjs";',
      'export {',
      '  browserUrlForListenAddress,',
      '  browserUrlForPublicOrigin,',
      '  createSignalShutdownHandler,',
      '  DEFAULT_SHUTDOWN_TIMEOUT_MS,',
      '  defaultListenSocketPath,',
      '  forceCloseServerConnections,',
      '  resolveListenTarget,',
      '  resolveServerRuntimeProfile,',
      '  startupBrowserPath',
      '} from "./server.js";',
      '',
      'async function createStaticInstalledRuntime({',
      '  appRoot = "",',
      '  config = {},',
      '  env = {},',
      '  fastify = null,',
      '  logger = console,',
      '  profile = ""',
      '} = {}) {',
      '  const runtime = createCapabilityRuntime({',
      '    profile,',
      '    inputs: {',
      '      "runtime.app-root": appRoot,',
      '      "runtime.config": Object.freeze({ ...config }),',
      '      "runtime.env": Object.freeze({ ...env }),',
      '      "runtime.fastify": fastify,',
      '      "runtime.logger": logger || console',
      '    },',
      '    providers: [',
      '      EventProvider,',
      '      createActionProvider({ logger }),',
      '      HttpProvider,',
      '      BootstrapProvider,',
      '      ...providers',
      '    ]',
      '  });',
      '  await runtime.start();',
      '  fastify.addHook("onClose", async () => runtime.shutdown());',
      '  return Object.freeze({',
      '    runtime,',
      '    globalUiPaths,',
      '    packageOrder,',
      '    providerPackageOrder',
      '  });',
      '}',
      '',
      'function withStaticInstalledRuntime(options = {}) {',
      '  return {',
      '    ...options,',
      '    createInstalledRuntime: createStaticInstalledRuntime',
      '  };',
      '}',
      '',
      'function createServer(options = {}) {',
      '  return createBaseServer(withStaticInstalledRuntime(options));',
      '}',
      '',
      'function startServer(options = {}) {',
      '  return startBaseServer(withStaticInstalledRuntime(options));',
      '}',
      '',
      'export {',
      '  createServer,',
      '  startServer',
      '};',
      ''
    ].join("\n")}`,
    "utf8"
  );
  return STATIC_SERVER_ENTRY_PATH;
}

async function buildNodeBundle({ appRoot, entryPoint, outfile, external = SERVER_BUNDLE_EXTERNALS, plugins = [], minify = true }) {
  const resolvedAppRoot = path.resolve(appRoot);
  const requireFromApp = createRequire(path.join(resolvedAppRoot, "package.json"));
  const esbuild = requireFromApp("esbuild");
  const preserveModuleUrlsPlugin = {
    name: "vibe64-preserve-module-urls",
    setup(build) {
      build.onLoad({ filter: /\.[cm]?js$/ }, async (args) => {
        const sourcePath = path.resolve(args.path);
        if (!sourcePath.startsWith(`${resolvedAppRoot}${path.sep}`)) {
          return null;
        }
        const source = await readFile(sourcePath, "utf8");
        if (!source.includes("import.meta.url")) {
          return null;
        }
        const moduleUrlExpression = `new URL(${jsString(`./${path.relative(path.dirname(entryPoint), sourcePath).split(path.sep).join("/")}`)}, import.meta.url).href`;
        // Let the parser distinguish actual expressions from generated worker
        // source inside string literals. Replacing text corrupts those workers.
        const transformed = await esbuild.transform(source, {
          loader: "js",
          define: { "import.meta.url": "__vibe64BundledModuleUrl" },
          banner: `const __vibe64BundledModuleUrl = ${moduleUrlExpression};`
        });
        return {
          contents: transformed.code,
          loader: "js"
        };
      });
    }
  };
  return esbuild.build({
    absWorkingDir: resolvedAppRoot,
    banner: {
      js: "import { createRequire as __vibe64CreateRequire } from 'node:module';const require=__vibe64CreateRequire(import.meta.url);"
    },
    bundle: true,
    metafile: true,
    entryPoints: [entryPoint],
    external,
    format: "esm",
    legalComments: "eof",
    lineLimit: SERVER_BUNDLE_LINE_LIMIT,
    logLevel: "silent",
    minify,
    outfile,
    platform: "node",
    plugins: [
      ...plugins,
      preserveModuleUrlsPlugin
    ],
    preserveSymlinks: true,
    target: "node26"
  });
}


async function prepareServerBuild({ appRoot }) {
  return {
    staticServerProviderRegistryPath: await writeStaticServerProviderRegistry({ appRoot }),
    staticServerEntryPath: await writeStaticServerEntry({ appRoot })
  };
}

async function buildServerBundle({ appRoot, outputPath = path.join(appRoot, SERVER_BUNDLE_PATH), extraExternals = [], minify = true }) {
  await prepareServerBuild({ appRoot });
  const result = await buildNodeBundle({
    appRoot, entryPoint: path.join(appRoot, STATIC_SERVER_ENTRY_PATH), outfile: outputPath, minify,
    external: [...SERVER_BUNDLE_EXTERNALS, ...extraExternals]
  });
  return { ...result, bundlePath: SERVER_BUNDLE_PATH, outputPath };
}

export { buildNodeBundle, buildServerBundle, prepareServerBuild, SERVER_BUNDLE_EXTERNALS,
  SERVER_BUNDLE_PATH, STATIC_SERVER_ENTRY_PATH, STATIC_SERVER_PROVIDER_REGISTRY_PATH };
