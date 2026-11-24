import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { kebab } from "./material3-source.mjs";

// How app code uses components, for the Material 3 check (material3.mjs).
// - ui/removed-prop: a prop a JSKIT component no longer has, which Vue would otherwise pass on as an HTML attribute
//   that does nothing. Each package lists the props its releases removed from its exported components in
//   package.json, as `jskit.metadata.ui.removedProps: { "<Component>": { "<prop>": "<what to do instead>" } }`, read
//   from the installed package, so an app is judged against the release it runs.
// - ui/vuetify-by-name: a Vuetify component named as a string for Vue to resolve at run time (resolveComponent("v-dialog"),
//   resolveDynamicComponent, h("v-dialog"), <component is="v-dialog">). A JSKIT app registers no Vuetify component
//   globally: vite-plugin-vuetify imports each one where a template writes its tag, so the name finds nothing and Vue
//   renders an unknown element. Only the names the app's installed Vuetify exports from vuetify/components count:
//   another library's v-chart is that library's to register.

const PACKAGE_DIRECTORY = path.join("node_modules", "@jskit-ai");
// `import CrudViewScreen from "@jskit-ai/http-web/client/components/CrudViewScreen"`.
const COMPONENT_IMPORT = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*["']@jskit-ai\/([\w-]+)\/client\/components\/([\w-]+?)(?:\.vue)?["']/gu;
// `import { CrudViewScreen, CrudListScreen as List } from "@jskit-ai/http-web/client"`.
const CLIENT_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*["']@jskit-ai\/([\w-]+)\/client["']/gu;

// What a Vuetify component's name looks like: kebab-case with its v- prefix, or PascalCase with its V. Whether it is one
// is the installed Vuetify's to say (readVuetifyComponents).
const VUETIFY_NAME = String.raw`v-[a-z][a-z0-9-]*|V[A-Z][A-Za-z0-9]*`;
const VUETIFY_BY_NAME_CALL = new RegExp(String.raw`\b(resolveComponent|resolveDynamicComponent|h)\s*\(\s*(["'\x60])(${VUETIFY_NAME})\2`, "gu");
const QUOTED_VUETIFY_NAME = new RegExp(String.raw`(["'\x60])(${VUETIFY_NAME})\1`, "gu");
const RESOLVING_CALL = /\b(?:resolveComponent|resolveDynamicComponent|h)\s*\(\s*$/u;
const EXPORT_ALL = /\bexport\s*\*\s*from\s*["']([^"']+)["']/gu;
const EXPORT_LIST = /\bexport\s*\{([^}]*)\}/gu;
const EXPORT_DECLARATION = /\bexport\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gu;

/**
 * The props each installed @jskit-ai package lists as removed from its components, by package name:
 * Map<"@jskit-ai/<name>", Record<component, Record<prop, hint>>>.
 * @param {string} root
 */
async function readRemovedProps(root) {
  const removed = new Map();
  let entries;
  try {
    entries = await readdir(path.join(root, PACKAGE_DIRECTORY));
  } catch (error) {
    if (error?.code === "ENOENT") return removed;
    throw error;
  }
  for (const entry of entries) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(root, PACKAGE_DIRECTORY, entry, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const props = manifest?.jskit?.metadata?.ui?.removedProps;
    if (props && typeof props === "object") removed.set(`@jskit-ai/${entry}`, props);
  }
  return removed;
}

// The names a module exports, following its `export * from`: the components of vuetify/components.
async function readExportNames(file, names = new Set(), seen = new Set()) {
  if (seen.has(file)) return names;
  seen.add(file);
  let code;
  try {
    code = await readFile(file, "utf8");
  } catch {
    return names;
  }
  for (const [, from] of code.matchAll(EXPORT_ALL)) await readExportNames(path.resolve(path.dirname(file), from), names, seen);
  for (const [, list] of code.matchAll(EXPORT_LIST)) {
    for (const specifier of list.split(",")) {
      const name = specifier.trim().split(/\s+as\s+/u).pop();
      if (name) names.add(name);
    }
  }
  for (const [, name] of code.matchAll(EXPORT_DECLARATION)) names.add(name);
  return names;
}

/**
 * The components the app's installed Vuetify exports from vuetify/components, by PascalCase name (VDialog); none when
 * the app has no Vuetify.
 * @param {string} root
 */
async function readVuetifyComponents(root) {
  const packageRoot = path.join(root, "node_modules", "vuetify");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    return new Set();
  }
  const entry = (target) => typeof target === "string" || !target ? target : entry(target.import ?? target.module ?? target.default);
  return await readExportNames(path.join(packageRoot, entry(manifest?.exports?.["./components"]) || "lib/components/index.js"));
}

// The JSKIT components a script imports, by the tag a template writes them as (kebab-case): { name, packageName, local }.
function readComponentImports(script) {
  const components = new Map();
  const add = (local, packageName, name) => components.set(kebab(local), { name, packageName: `@jskit-ai/${packageName}`, local });
  for (const [, local, packageName, name] of script.matchAll(COMPONENT_IMPORT)) add(local, packageName, name);
  for (const [, names, packageName] of script.matchAll(CLIENT_IMPORT)) {
    for (const specifier of names.split(",")) {
      const [name, local = name] = specifier.trim().split(/\s+as\s+/u);
      if (/^[A-Z]\w*$/u.test(name)) add(local, packageName, name);
    }
  }
  return components;
}

// Reports each prop a template passes to a JSKIT component that the installed package lists as removed, written in
// camelCase or kebab-case, static or bound.
function checkRemovedProps(tags, script, removedProps, report) {
  const components = readComponentImports(script);
  for (const tag of tags) {
    const component = components.get(tag.name);
    const removed = component && removedProps.get(component.packageName)?.[component.name];
    if (!removed) continue;
    for (const entry of tag.attributes) {
      const prop = Object.keys(removed).find((name) => [kebab(name), name.toLowerCase()].includes(entry.name));
      if (prop) {
        report("ui/removed-prop", entry.offset, `${component.local} (${component.packageName}) no longer has the prop ${prop}, so Vue ` +
          `passes it on as an HTML attribute that does nothing. ${removed[prop]}`);
      }
    }
  }
}

// Reports a name the installed Vuetify exports a component as (vuetifyComponents, from readVuetifyComponents).
function reportByName({ report, vuetifyComponents }, offset, name, how) {
  const component = name.startsWith("v-") ? name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("") : name;
  if (!vuetifyComponents.has(component)) return;
  report("ui/vuetify-by-name", offset, `${how} names Vuetify's ${component} for Vue to resolve at run time, which finds nothing ` +
    `in a JSKIT app: Vuetify components are imported where a template writes their tag, never registered by name, so Vue ` +
    `renders an unknown element. Import it, import { ${component} } from "vuetify/components", and pass the component itself.`);
}

// Reports each Vuetify component that code (a script, or a template's bound expression) names for Vue to resolve.
// context: { report, vuetifyComponents }.
function checkVuetifyByNameCode(code, offset, context) {
  for (const match of code.matchAll(VUETIFY_BY_NAME_CALL)) reportByName(context, offset + match.index, match[3], `${match[1]}("${match[3]}")`);
}

// Reports a <component> whose `is` names a Vuetify component: written as it is, or as a string in a bound expression.
// context: { report, vuetifyComponents }.
function checkVuetifyByNameAttribute(tag, entry, context) {
  if (tag.name !== "component" || entry.name !== "is") return;
  if (!entry.bound) {
    const name = entry.value.trim();
    if (new RegExp(`^(?:${VUETIFY_NAME})$`, "u").test(name)) reportByName(context, entry.offset, name, `is="${name}"`);
    return;
  }
  for (const match of entry.value.matchAll(QUOTED_VUETIFY_NAME)) {
    // A call's argument is checkVuetifyByNameCode's.
    if (!RESOLVING_CALL.test(entry.value.slice(0, match.index))) reportByName(context, entry.valueOffset + match.index, match[2], `:is="${match[0]}"`);
  }
}

export { checkRemovedProps, checkVuetifyByNameAttribute, checkVuetifyByNameCode, readRemovedProps, readVuetifyComponents };
