// The pages an app's own packages give the router, for the navigation rules: each package.json route in
// jskit.metadata.ui.routes with the component its client entry's routeComponents names.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_IMPORT, balancedFrom, blankJsComments, enclosingObject, localComponent } from "./material3-source.mjs";

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const ROUTE_COMPONENTS = /\brouteComponents\s*=\s*(?:Object\s*\.\s*freeze\s*\(\s*)?(?=\{)/u;
// One routeComponents entry: `key: () => import("./page.vue")` or `"key": ImportedPage`.
const ROUTE_COMPONENT = /(?<=[{,]\s*)(?:(["'])([^"']+)\1|([A-Za-z_$][\w$]*))\s*:\s*(?:\(\s*\)\s*=>\s*import\s*\(\s*(["'])([^"']+)\4\s*\)|([A-Za-z_$][\w$]*))(?=\s*[,}])/gu;

// The file a package's "./client" export names, relative to the app: packages/shelves/src/client/index.js.
function clientEntryOf(manifest, directory) {
  const target = manifest?.exports?.["./client"];
  const entry = typeof target === "string" ? target : target?.import || target?.default;
  return typeof entry === "string" ? path.posix.join(directory, entry) : "";
}

// The app's .vue file of each routeComponents key in a client entry, from its literal map: an entry another module
// builds, or one naming a file outside the app, has none.
function readRouteComponents(entry, code, known) {
  const components = new Map();
  const start = ROUTE_COMPONENTS.exec(code);
  const map = start ? balancedFrom(code, start.index + start[0].length)?.text || "" : "";
  const imports = new Map([...code.matchAll(DEFAULT_IMPORT)].map(([, name, specifier]) => [name, specifier]));
  for (const match of map.matchAll(ROUTE_COMPONENT)) {
    const specifier = match[5] ?? imports.get(match[6]);
    const file = specifier ? localComponent(entry, specifier, known) : null;
    if (file) components.set(match[2] ?? match[3], file);
  }
  return components;
}

/**
 * The pages an app's own packages give the router: each packages/<name>/package.json's jskit.metadata.ui.routes entry
 * the kernel registers (not autoRegister: false), with the component its client entry's literal routeComponents map
 * names for componentKey. The kernel adds each at the top level, so no layout renders it: it is under the shell's top
 * app bar only when its component (or App.vue) draws the bar. Its parent and surface are its meta.jskit, as declared.
 * @param {string} root
 * @param {Set<string>} known The app's files; a package whose client entry or component is not among them is skipped.
 */
async function readPackageRoutes(root, known) {
  let directories = [];
  try {
    directories = (await readdir(path.join(root, "packages"), { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const pages = [];
  for (const directory of directories.map((entry) => `packages/${entry.name}`).sort()) {
    const manifestFile = `${directory}/package.json`;
    let manifestSource;
    let manifest;
    try {
      manifestSource = await readFile(path.join(root, manifestFile), "utf8");
      manifest = JSON.parse(manifestSource);
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) continue;
      throw error;
    }
    const routes = manifest?.jskit?.metadata?.ui?.routes;
    const entry = clientEntryOf(manifest, directory);
    if (!Array.isArray(routes) || !known.has(entry)) continue;
    const components = readRouteComponents(entry, blankJsComments(await readFile(path.join(root, entry), "utf8")), known);
    for (const route of routes) {
      const file = isRecord(route) && route.autoRegister !== false ? components.get(String(route.componentKey || "").trim()) : null;
      if (!file) continue;
      const id = String(route.id || "").trim();
      const jskit = isRecord(route.meta?.jskit) ? route.meta.jskit : {};
      const parent = typeof jskit.parent === "string" ? jskit.parent.trim() : isRecord(jskit.parent) ? jskit.parent : "";
      // Where package.json declares the route, and its parent, for findings.
      const declared = new RegExp(String.raw`"id"\s*:\s*${JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u").exec(manifestSource);
      const object = declared ? enclosingObject(manifestSource, declared.index) : null;
      const parentKey = object ? /"parent"\s*:/u.exec(object.text) : null;
      pages.push({
        file,
        manifest: manifestFile,
        source: manifestSource,
        id,
        path: String(route.path || "").trim(),
        scope: String(route.scope || "surface").trim().toLowerCase() === "global" ? "global" : "surface",
        surface: String(route.surface || "").trim().toLowerCase(),
        parent,
        surfaceRoot: Boolean(jskit.surface),
        offset: declared?.index ?? 0,
        parentOffset: parentKey ? object.start + parentKey.index : declared?.index ?? 0
      });
    }
  }
  return pages;
}

export { readPackageRoutes };
