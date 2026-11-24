import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_IMPORT,
  TEMPLATE_TAG,
  VOID_TAGS,
  balancedFrom,
  blankHtmlComments,
  blankJsComments,
  enclosingObject,
  kebab,
  lineIndex,
  localComponent,
  splitVue
} from "./material3-source.mjs";
import { readPackageRoutes } from "./package-routes.mjs";

// The navigation rules of the JSKIT Material 3 guide (#241). The shell owns Up and the per-tab trail;
// an app declares each inner page's parent and links through JSKIT navigation, nothing more. Plain `jskit check`
// fails on every rule here, for every JSKIT app, and no comment excuses one; `jskit check m3` lists them with the
// visual rules.

const RULES = Object.freeze({
  "nav/history": "forbidden-in-app-code",
  "nav/window-location": "forbidden-in-app-code",
  "nav/raw-link": "forbidden-in-app-code",
  "nav/back-control": "forbidden-in-app-code",
  "nav/missing-parent": "what-an-app-declares",
  "nav/top-level-parent": "what-an-app-declares",
  "nav/placement-data": "what-an-app-declares",
  "nav/missing-shell-layout": "what-an-app-declares",
  "nav/surface-parent": "what-an-app-declares"
});

const HISTORY_CALL = /(?<![\w$.])(?:(?:window|globalThis)\s*\.\s*)?history\s*\.\s*(?:back|go|forward|pushState|replaceState)\s*\(/gu;
const ROUTER_HISTORY_CALL = /(?<![\w$])(?:[\w$]*router|useRouter\(\s*\))\s*\.\s*(?:back|go|forward)\s*\(/giu;
const LOCATION_WRITE = new RegExp([
  String.raw`\b(?:window|document|globalThis)\s*\.\s*location(?:\s*\.\s*(?:href|pathname|search|hash))?\s*=(?!=)`,
  String.raw`(?<![\w$.])location\s*\.\s*(?:href|pathname)\s*=(?!=)`,
  String.raw`(?<![\w$])(?:(?:window|document|globalThis)\s*\.\s*)?location\s*\.\s*(?:assign|replace)\s*\(`
].join("|"), "gu");
const ROUTER_PATH = /(?<![\w$])(?:[\w$]*router|useRouter\(\s*\))\s*\.\s*(?:push|replace)\s*\(\s*(?:\{\s*path\s*:\s*)?(["'`])(\/[^"'`]*)/giu;
const OBJECT_PATH = /(?<![\w$])(?:to|href)\s*:\s*(["'`])(\/[^"'`]*)/gu;
const BOUND_PATH = /^\s*(?:\{\s*path\s*:\s*)?(["'`])(\/[^"'`]*)/u;
// A back handler or back component: goBack, onBack, handleBackClick, useBackNavigation, PageBackButton, backToList.
const BACK_NAME = String.raw`(?:[A-Za-z][\w$]*Back(?:[A-Z][\w$]*)?|Back[A-Z][\w$]*|back(?:To[A-Z][\w$]*)?)`;
const BACK_IDENTIFIER = new RegExp(String.raw`(?<![\w$])${BACK_NAME}(?![\w$])`, "u");
const BACK_DEFINITION = new RegExp(String.raw`\b(?:function\s*\*?\s*|const\s+|let\s+|var\s+)(${BACK_NAME})(?![\w$])`, "gu");
const BACK_TEXT = /^\s*(?:[←‹«]|(?:go\s+)?back\b|return to\b)|\bback to\b/iu;
const BACK_KEY = /\bback(?:To)?\b/iu;
const ARROW_ICON = /arrow[-_]?back|arrow[-_]?left|keyboard[-_]?backspace|keyboard[-_]?return/iu;
const CHEVRON_ICON = /chevron[-_]?left|\$prev\b|navigate[-_]?before/iu;
const CLICKABLE_TAGS = new Set(["v-btn", "router-link", "a", "v-list-item", "v-chip", "v-icon", "v-app-bar-nav-icon"]);
const BREADCRUMB_TAGS = new Set(["v-breadcrumbs", "v-breadcrumbs-item"]);
const LABEL_ATTRIBUTES = new Set(["aria-label", "title", "label", "text"]);
const ICON_ATTRIBUTES = new Set(["icon", "prepend-icon", "append-icon"]);
const LINK_ATTRIBUTES = new Set(["to", "href"]);
const NAVIGATES = /(?<![\w$])(?:[\w$]*router|useRouter\(\s*\))\s*\.\s*(?:push|replace)\s*\(|\.page\s*\(|resolve\w*Url\s*\(/iu;
// App navigation in a handler or a function: the router, JSKIT paths, the shell's up() and finish(), a RouterLink's
// navigate(), and the browser's own history and location.
const APP_NAVIGATION = new RegExp([
  NAVIGATES.source,
  ROUTER_HISTORY_CALL.source,
  HISTORY_CALL.source,
  LOCATION_WRITE.source,
  String.raw`(?<![\w$])(?:up|finish|navigate)\s*\(`,
  String.raw`\.\s*(?:up|finish)\s*\(`
].join("|"), "iu");
// An embedded frame's history and location (a preview browser's Back and Forward) are the frame's, not the app's.
const FRAME_NAVIGATION = /\bcontentWindow\s*\??\.\s*(?:history|location)(?:\s*\??\.\s*[\w$]+)*/gu;
const CALLED_NAME = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/gu;
const UP_OWNER = "Up belongs to the shell's top app bar: ShellLayout's, or ShellUpButton in a bar the layout draws itself";
// Main navigation: the navigation bar, rail and drawer render shell.primary-nav and shell.secondary-nav links.
const MAIN_NAV_TARGET = /\btarget\s*:\s*["']shell\.(?:primary|secondary)-nav["']/gu;
// A layout that imports the app's ShellLayout wrapper or shell-web's ShellLayout renders the top app bar; one that
// draws its own bar renders shell-web's Up control in it.
const SHELL_LAYOUT_IMPORT = /\bfrom\s*["'](?:@\/components\/ShellLayout|@jskit-ai\/shell-web\/client\/components\/ShellLayout)(?:\.vue)?["']/u;
const SHELL_UP_TAG = /<\s*(?:ShellUpButton|shell-up-button)\b/u;
const SHELL_TITLE_TAG = /<\s*(?:ShellPageTitle|shell-page-title)\b/u;
const LOCAL_IMPORT = /\bfrom\s*["']((?:@\/|\.{1,2}\/)[^"']+)["']/gu;
const ROUTER_VIEW_TAG = /<\s*(?:RouterView|router-view)\b/u;

function isInAppPath(value) {
  const target = String(value || "").trim();
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/api/")) return false;
  const pathname = target.split(/[?#]/u)[0];
  // A file the server serves (/favicon.svg, /exports/report.pdf) is not an app page.
  return !/\.[a-z0-9]{1,5}$/iu.test(pathname.split("/").pop() || "");
}

const compact = (text) => text.replace(/\s+/gu, "");
const RAW_LINK_FIX = "Resolve it through JSKIT navigation: usePaths().page(), the CRUD runtime's resolve helpers or a shell link item.";

// History, location and hand-built paths in any JavaScript: a script block, a module, or an attribute's expression.
function checkNavigationCode(code, offset, report) {
  for (const pattern of [HISTORY_CALL, ROUTER_HISTORY_CALL]) {
    for (const match of code.matchAll(pattern)) {
      report("nav/history", offset + match.index, `${compact(match[0])}...) navigates by browser history. The shell's Up arrow and the browser's own Back do that; an app never does.`);
    }
  }
  for (const match of code.matchAll(LOCATION_WRITE)) {
    report("nav/window-location", offset + match.index, `${compact(match[0])} navigates outside the router. Reach in-app pages through JSKIT navigation; for a full reload into one (after sign-in or a user switch) use reloadAppPage(path), and to leave the app leaveApp(url), from @jskit-ai/shell-web/client/navigation/documentNavigation.`);
  }
  for (const pattern of [ROUTER_PATH, OBJECT_PATH]) {
    for (const match of code.matchAll(pattern)) {
      if (!isInAppPath(match[2]) || (pattern === OBJECT_PATH && isPlacementLink(code, match.index))) continue;
      report("nav/raw-link", offset + match.index, `Hand-built in-app path "${match[2]}". ${RAW_LINK_FIX}`);
    }
  }
}

// A placement's link props (to, scopedSuffix, unscopedSuffix) are JSKIT navigation input: shell-web resolves them
// with resolveMenuLinkTarget() and renders router links, so `props: { to: "/auth/login" }` is not a hand-built link.
function isPlacementLink(code, offset) {
  const props = enclosingObject(code, offset);
  if (!props) return false;
  const placement = /\bprops\s*:\s*$/u.test(code.slice(0, props.start)) ? enclosingObject(code, props.start - 1) : props;
  return Boolean(placement) && /\btarget\s*:\s*["'`][\w.-]+["'`]/u.test(placement.text) && /\bkind\s*:/u.test(placement.text);
}

// A back-named function that navigates the app, and the import of a back component (ContextBackButton); a variable,
// a composable's import or an in-component step is not back logic.
function checkScriptBackNames(code, offset, report) {
  for (const match of code.matchAll(BACK_DEFINITION)) {
    if (!navigatesApp(definitionOf(code, match[1]), code)) continue;
    report("nav/back-control", offset + match.index, `${match[1]} navigates back in the app. ${UP_OWNER}; delete it and declare the page's parent.`);
  }
  for (const match of code.matchAll(DEFAULT_IMPORT)) {
    if (!/^[A-Z]/u.test(match[1]) || !isBackComponentName(match[1])) continue;
    report("nav/back-control", offset + match.index, `${match[1]} is a back component. ${UP_OWNER}; remove it and declare the page's parent.`);
  }
}

// The text of a local function's definition: function name(...) { ... }, or const name = ... to its end.
function definitionOf(script, name) {
  const escaped = name.replace(/\$/gu, "\\$");
  const declaration = new RegExp(String.raw`\bfunction\s*\*?\s*${escaped}\s*\(`, "u").exec(script);
  if (declaration) {
    const parameters = balancedFrom(script, declaration.index + declaration[0].length - 1, "(", ")");
    return parameters ? balancedFrom(script, parameters.end)?.text || "" : "";
  }
  const binding = new RegExp(String.raw`\b(?:const|let|var)\s+${escaped}\s*=`, "u").exec(script);
  return binding ? statementFrom(script, binding.index + binding[0].length) : "";
}

// An initialiser up to its statement's end: a semicolon or a line break outside brackets that ends the expression.
function statementFrom(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      if (depth === 0) return text.slice(start, index);
      depth -= 1;
    } else if (depth === 0 && (char === ";" || char === "\n")) {
      const sofar = text.slice(start, index);
      if (char === ";" || (sofar.trim() && !/(?:=>|[=(,?:&|+*/-])\s*$/u.test(sofar))) return sofar;
    }
  }
  return text.slice(start);
}

// Whether code navigates the app, directly or through the functions it calls that the component defines.
function navigatesApp(code, script, seen = new Set()) {
  const own = code.replace(FRAME_NAVIGATION, "");
  if (APP_NAVIGATION.test(own)) return true;
  for (const match of own.matchAll(CALLED_NAME)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    const definition = definitionOf(script, match[1]);
    if (definition && navigatesApp(definition, script, seen)) return true;
  }
  return false;
}

// A control navigates the app when it links into it (to, or an in-app href) or one of its handlers navigates; a bare
// handler name is a call. "Back to top" (href="#top") scrolls the page.
function navigatesFromControl(tag, script) {
  return tag.attributes.some((entry) => {
    if (entry.name === "to") return true;
    if (entry.name === "href") return entry.bound || isInAppPath(entry.value);
    if (!entry.event) return false;
    const handler = entry.value.trim();
    return navigatesApp(/^[\w$.]+$/u.test(handler) ? `${handler}()` : handler, script);
  });
}

function attribute(tag, name) {
  return tag.attributes.find((entry) => entry.name === name);
}

function visibleText(inner) {
  return inner.replace(/<[^>]*>/gu, " ").replace(/\{\{[\s\S]*?\}\}/gu, " ").replace(/\s+/gu, " ").trim();
}

// A back component, in either case (tags are read in kebab case): ContextBackButton, <page-back-link>, GoBack,
// BackToList. Not Vuetify's own tags, a back office, or a back-to-top control, which scrolls the page.
const BACK_COMPONENT = /(?:^|-)back(?:$|-(?:action|arrow|btn|button|chevron|control|icon|link|nav|navigation)(?:-|$)|-to-(?!top(?:-|$)))/u;

function isBackComponentName(name) {
  const tag = kebab(name);
  return !tag.startsWith("v-") && BACK_COMPONENT.test(tag);
}

function looksLikeBack(tag) {
  const mustaches = [...tag.inner.matchAll(/\{\{([\s\S]*?)\}\}/gu)].map((match) => match[1]);
  const labels = tag.attributes.filter((entry) => LABEL_ATTRIBUTES.has(entry.name));
  const icons = tag.attributes.filter((entry) => ICON_ATTRIBUTES.has(entry.name)).map((entry) => entry.value);
  const iconText = [...icons, tag.inner].join(" ");
  return BACK_TEXT.test(visibleText(tag.inner)) ||
    mustaches.some((expression) => BACK_KEY.test(expression)) ||
    labels.some((entry) => (entry.bound ? BACK_KEY : BACK_TEXT).test(entry.value)) ||
    ARROW_ICON.test(iconText) ||
    CHEVRON_ICON.test(iconText);
}

// Every back control but the shell's Up arrow: a control that navigates the app and reads as back ("Back to X", an
// arrow or chevron, a back component or handler), and breadcrumbs. Prose, a variable, an in-component step and an
// embedded frame's own Back and Forward navigate nothing in the app. `script` is the component's script, where its
// handlers are defined.
function checkBackControl(tag, report, script = "") {
  if (BREADCRUMB_TAGS.has(tag.name)) {
    report("nav/back-control", tag.offset, "Breadcrumbs navigate back up the hierarchy. The shell's Up arrow does that; the app bar title says where the person is.");
    return;
  }
  // A back component navigates by itself, so its tag needs no link or handler to be one.
  if (isBackComponentName(tag.name)) {
    report("nav/back-control", tag.offset, `<${tag.name}> is a back control. ${UP_OWNER}; remove it and declare the page's parent.`);
    return;
  }
  if (!navigatesFromControl(tag, script)) return;
  const handler = tag.attributes.find((entry) => entry.event && BACK_IDENTIFIER.test(entry.value));
  if (handler) {
    report("nav/back-control", handler.offset, `${handler.raw}="${handler.value.trim()}" is a back handler. ${UP_OWNER}; remove the control and declare the page's parent.`);
    return;
  }
  if (CLICKABLE_TAGS.has(tag.name) && looksLikeBack(tag)) {
    report("nav/back-control", tag.offset, `A back control in the page. ${UP_OWNER}, from the trail or the declared parent; remove this one.`);
  }
}

function checkLinkAttribute(tag, entry, report) {
  if (!LINK_ATTRIBUTES.has(entry.name) || attribute(tag, "download")) return;
  const value = entry.bound ? BOUND_PATH.exec(entry.value)?.[2] : entry.value;
  if (value !== undefined && isInAppPath(value)) {
    report("nav/raw-link", entry.valueOffset, `Hand-built in-app path "${value.trim()}". ${RAW_LINK_FIX}`);
  }
}

const stringValue = (text, key) => new RegExp(`\\b${key}\\s*:\\s*(["'\\u0060])([^"'\\u0060]*)\\1`, "u").exec(text)?.[2];

// Main-navigation destinations, by surface: every main-navigation placement's suffixes, and its address when it has
// one (`to`). A link that names its surface (props.surface) leads to that surface's page wherever it shows, so it is a
// destination of that surface only; one that names none leads to the page on each surface it shows on. A placement is
// literal data; one whose suffixes, address or surface are computed (built by a helper, spread or interpolated) can't
// be read, and is returned as unreadable.
function readMainNavigation(sources) {
  const destinations = [];
  const unreadable = [];
  for (const { file, source } of sources) {
    for (const match of source.matchAll(MAIN_NAV_TARGET)) {
      const placement = enclosingObject(source, match.index)?.text || "";
      const computed = computedPlacementPart(placement);
      if (computed) {
        unreadable.push({ file, source, offset: match.index, computed });
        continue;
      }
      const surface = stringValue(placement, "surface");
      const surfaces = surface ? [surface] : (/\bsurfaces\s*:\s*\[([^\]]*)\]/u.exec(placement)?.[1] || "")
        .split(",").map((entry) => entry.trim().replace(/^["'`]|["'`]$/gu, "")).filter(Boolean);
      for (const key of ["scopedSuffix", "unscopedSuffix"]) {
        const suffix = stringValue(placement, key);
        if (suffix !== undefined) destinations.push({ suffix: normalisePath(suffix.split(/[?#]/u)[0]), surfaces });
      }
      // A link with an address of its own (`to: "/account"`, a package's global route) leads to that path.
      const to = stringValue(placement, "to");
      if (to?.startsWith("/")) destinations.push({ to: normalisePath(to.split(/[?#]/u)[0]), surfaces });
    }
  }
  return { destinations, unreadable };
}

// What makes a placement computed rather than literal data, or "": a spread, props that aren't an object literal, or
// a link key that isn't a plain string (or a list of strings, for surfaces), such as a variable, a call or an
// interpolated template.
function computedPlacementPart(placement) {
  if (/[{,]\s*\.\.\./u.test(placement)) return "it spreads another object";
  if (/(?<=[{,]\s*)props\s*:(?!\s*\{)/u.test(placement)) return "its props are computed";
  for (const key of ["scopedSuffix", "unscopedSuffix", "surface", "to"]) {
    // The key as a property, `key: value` or shorthand `key`, whose value is not a quoted string without ${}.
    const property = new RegExp(`(?<=[{,]\\s*)${key}\\s*(?::(?!\\s*(["'\\u0060])[^"'\\u0060$]*\\1)|(?=[,}]))`, "u");
    if (property.test(placement)) return `its ${key} is computed`;
  }
  const surfaces = /(?<=[{,]\s*)surfaces\s*:\s*(\[[^\]]*\])?/u.exec(placement);
  if (surfaces && !/^\[\s*(?:(["'`])[^"'`$]*\1\s*,?\s*)*\]$/u.test(surfaces[1] || "")) return "its surfaces are computed";
  return "";
}

function normalisePath(value) {
  const trimmed = `/${String(value || "").replace(/^\/+|\/+$/gu, "")}`;
  return trimmed === "/" ? "/" : trimmed;
}

const PARAM_SEGMENT = /^:[\w$]+$/u;

// Whether a literal path is one a page's route pattern serves: segment by segment, each `:param` stands for exactly
// one non-empty segment and every other segment is the same text. /modules/:moduleKey serves /modules/incidents, not
// /modules or /modules/incidents/open; a catch-all (:rest*) matches only its own text.
function patternServes(pattern, literal) {
  const patternSegments = pattern.split("/");
  const literalSegments = literal.split("/");
  return patternSegments.length === literalSegments.length && patternSegments.every((segment, index) =>
    segment === literalSegments[index] || (PARAM_SEGMENT.test(segment) && literalSegments[index] !== ""));
}

// Whether route pattern `a` ranks above `b` for a literal path both serve, as the router ranks them: at the first
// segment where one is static and the other a :param, the static one wins. /jobs/new comes before /jobs/:jobId, and
// /jobs/:jobId before /:section/new.
function outranks(a, b) {
  const aSegments = a.split("/");
  const bSegments = b.split("/");
  for (const [index, segment] of aSegments.entries()) {
    const param = PARAM_SEGMENT.test(segment);
    if (param !== PARAM_SEGMENT.test(bSegments[index])) return !param;
  }
  return false;
}

// unplugin-vue-router file routes: src/pages/home/suppliers/[supplierId]/edit.vue is home/suppliers/:supplierId/edit,
// and an index file or folder adds no segment.
function routeOf(file) {
  return pageKey(file).split("/").filter((segment) => segment !== "index").join("/");
}

function routePattern(route) {
  return route.replace(/\[\.\.\.([^\]]+)\]/gu, ":$1*").replace(/\[([^\]]+)\]/gu, ":$1");
}

// Each surface's pages root, from config/public.js (config.surfaceDefinitions.<id> = { pagesRoot: "..." }).
function readSurfaces(configSource, pageRoutes) {
  const surfaces = [];
  for (const match of configSource.matchAll(/surfaceDefinitions\s*\.\s*([\w$]+)\s*=\s*\{/gu)) {
    const body = balancedFrom(configSource, match.index + match[0].length - 1)?.text || "";
    const pagesRoot = stringValue(body, "pagesRoot");
    surfaces.push({ id: match[1], pagesRoot: pagesRoot === undefined ? match[1] : pagesRoot.replace(/^\/+|\/+$/gu, "") });
  }
  if (surfaces.length > 0) return surfaces.sort((left, right) => right.pagesRoot.length - left.pagesRoot.length);
  const roots = new Set(pageRoutes.map((route) => route.split("/")[0]).filter(Boolean));
  return [...roots].map((root) => ({ id: root, pagesRoot: root }));
}

function surfaceOf(route, surfaces) {
  return surfaces.find(({ pagesRoot }) => pagesRoot === "" || route === pagesRoot || route.startsWith(`${pagesRoot}/`));
}

// The route block's JSON and the definePage() argument, where a page declares its route meta.
function routeDeclarations(source) {
  const declarations = [];
  const routeBlock = /<route(?:\s[^>]*)?>([\s\S]*?)<\/route\s*>/iu.exec(source);
  if (routeBlock) declarations.push({ text: routeBlock[1], offset: routeBlock.index + routeBlock[0].indexOf(">") + 1 });
  const { scripts } = splitVue(source);
  for (const block of scripts) {
    const code = blankJsComments(block.text);
    const call = /\bdefinePage\s*\(/u.exec(code);
    const argument = call ? balancedFrom(code, call.index + call[0].length) : null;
    if (argument) declarations.push({ text: argument.text, offset: block.offset + argument.start });
  }
  return declarations;
}

const PARENT_KEY = /(?:\bparent|"parent")\s*:/u;
const REDIRECT_KEY = /(?:\bredirect|"redirect")\s*:/u;
// The surface root record carries meta.jskit.surface; a cross-surface parent ({ surface, path }) does not count.
const SURFACE_KEY = /(?:\bsurface|"surface")\s*:/u;
const PARENT_OBJECT = /(?:\bparent|"parent")\s*:\s*\{[^}]*\}/gu;

function readPage(file, source) {
  const declarations = routeDeclarations(source);
  const meta = declarations.map(({ text }) => text).join("\n");
  return {
    file,
    source,
    declarations,
    layout: ROUTER_VIEW_TAG.test(splitVue(source).template?.text || ""),
    redirect: REDIRECT_KEY.test(meta),
    parent: declarations.find(({ text }) => PARENT_KEY.test(text)),
    surfaceRoot: SURFACE_KEY.test(meta.replace(PARENT_OBJECT, "")),
    shell: "none"
  };
}

// Whether a component draws the shell's top app bar, and with it Up: it, or a component it imports from the app,
// renders ShellLayout (directly or through the app's wrapper) or shell-web's ShellUpButton in a bar of its own (or,
// given SHELL_TITLE_TAG, the bar's page title).
function createShellBarReader(appFiles, read, tag = SHELL_UP_TAG) {
  const known = new Set(appFiles);
  const verdicts = new Map();
  async function drawsShellBar(file) {
    if (verdicts.has(file)) return verdicts.get(file);
    verdicts.set(file, false);
    const source = await read(file);
    let verdict = SHELL_LAYOUT_IMPORT.test(source) || tag.test(splitVue(source).template?.text || "");
    for (const match of source.matchAll(LOCAL_IMPORT)) {
      if (verdict) break;
      const imported = localComponent(file, match[1], known);
      verdict = Boolean(imported) && await drawsShellBar(imported);
    }
    verdicts.set(file, verdict);
    return verdict;
  }
  return drawsShellBar;
}

const SHELL_LAYOUT_SPECIFIER = /^(?:@\/components\/ShellLayout|@jskit-ai\/shell-web\/client\/components\/ShellLayout)(?:\.vue)?$/u;

/**
 * Where a layout renders its pages: "all" under the shell's top app bar (every <RouterView /> inside ShellLayout or
 * an app component that draws the bar, or a bar drawn beside them: ShellUpButton, or such a component around no
 * RouterView), "some" when a branch renders them without it (a shop device's sign-in in a v-if beside the
 * ShellLayout), or "none".
 * @param {string} file
 * @param {string} source
 * @param {(file: string) => Promise<boolean>} drawsShellBar
 * @param {Set<string>} known The app's files.
 * @param {RegExp} [barTag] The shell-web piece that marks a bar of the layout's own: Up, or, for the page title,
 *   ShellPageTitle (with drawsShellBar then reading the title too).
 */
async function shellPlacement(file, source, drawsShellBar, known, barTag = SHELL_UP_TAG) {
  const { template, scripts } = splitVue(source);
  const text = blankHtmlComments(template?.text || "");
  if (barTag.test(text)) return "all";
  const shellTags = new Set();
  for (const block of scripts) {
    for (const [, name, specifier] of blankJsComments(block.text).matchAll(DEFAULT_IMPORT)) {
      const imported = localComponent(file, specifier, known);
      if (SHELL_LAYOUT_SPECIFIER.test(specifier) || (imported && await drawsShellBar(imported))) shellTags.add(kebab(name));
    }
  }
  const open = [];
  let inside = 0;
  let outside = 0;
  let barBeside = false;
  for (const [, closing, rawName, , selfClosing] of text.matchAll(TEMPLATE_TAG)) {
    const name = kebab(rawName);
    if (closing) {
      const index = open.findLastIndex((entry) => entry.name === name);
      if (index < 0) continue;
      barBeside ||= open.slice(index).some((entry) => entry.shell && !entry.view);
      open.length = index;
      continue;
    }
    const shell = shellTags.has(name);
    if (name === "router-view") {
      const around = open.filter((entry) => entry.shell);
      for (const entry of around) entry.view = true;
      if (around.length > 0) inside += 1;
      else outside += 1;
    }
    if (selfClosing || VOID_TAGS.has(name)) barBeside ||= shell;
    else open.push({ name, shell, view: false });
  }
  if (barBeside) return "all";
  if (inside === 0) return "none";
  return outside === 0 ? "all" : "some";
}

/**
 * The app's .vue files that render under the shell's page title, where an in-page h1 would be a second one: a file
 * that shows the title (ShellLayout's bar, or ShellPageTitle in a bar of its own), a page a layout always renders
 * under it, and a component such a file imports. A component no .vue file imports (routed or placed from JavaScript) counts
 * too, as where it renders can't be read, unless JavaScript hands it to the shell to render outside every layout (the
 * router's notFoundComponent or fallbackRoute, the app's rootComponent) or it is a package route's page, which the
 * kernel adds at the top level: that one counts only as App.vue does, which counts only when it shows the title itself.
 * @param {{ root: string, appFiles: string[] }} options
 */
async function readTitledFiles({ root, appFiles }) {
  const sources = new Map();
  const read = async (file) => {
    if (!sources.has(file)) sources.set(file, await readFile(path.join(root, file), "utf8"));
    return sources.get(file);
  };
  const known = new Set(appFiles);
  const vueFiles = appFiles.filter((file) => file.endsWith(".vue"));
  const showsTitle = createShellBarReader(appFiles, read, SHELL_TITLE_TAG);
  const importers = new Map();
  for (const file of vueFiles) {
    for (const match of (await read(file)).matchAll(LOCAL_IMPORT)) {
      const imported = localComponent(file, match[1], known);
      if (imported) importers.set(imported, [...(importers.get(imported) || []), file]);
    }
  }
  // Whether each component JavaScript imports is handed to the shell only to render outside every layout.
  const outsideLayouts = new Map();
  for (const file of appFiles.filter((entry) => /\.(?:[cm]?[jt]s)$/u.test(entry))) {
    const code = blankJsComments(await read(file));
    for (const [, name, specifier] of code.matchAll(DEFAULT_IMPORT)) {
      const imported = localComponent(file, specifier, known);
      if (!imported) continue;
      const outside = rendersOutsideLayouts(code, name);
      outsideLayouts.set(imported, (outsideLayouts.get(imported) ?? true) && outside);
    }
  }
  const packagePages = new Set((await readPackageRoutes(root, known)).map((route) => route.file));
  const verdicts = new Map();
  async function titled(file) {
    if (verdicts.has(file)) return verdicts.get(file);
    verdicts.set(file, false);
    let verdict = await showsTitle(file);
    if (!verdict && isPageFile(file)) {
      // The layouts that render the page: src/pages/home/settings.vue renders home/settings/*.
      const segments = pageKey(file).split("/");
      for (let length = segments.length - 1; length > 0 && !verdict; length -= 1) {
        const layout = `src/pages/${segments.slice(0, length).join("/")}.vue`;
        // A layout that renders its pages without the title on one branch (a shop device's sign-in in a bare v-main
        // beside the ShellLayout) leaves them unjudged, as which branch shows a page is decided at runtime.
        if (known.has(layout) && ROUTER_VIEW_TAG.test(splitVue(await read(layout)).template?.text || "")) {
          verdict = await shellPlacement(layout, await read(layout), showsTitle, known, SHELL_TITLE_TAG) === "all";
        }
      }
    } else if (!verdict && path.posix.basename(file) !== "App.vue") {
      const users = importers.get(file) || [];
      verdict = users.length === 0;
      if (verdict && (outsideLayouts.get(file) === true || packagePages.has(file))) {
        verdict = known.has("src/App.vue") && await showsTitle("src/App.vue");
      }
      for (const user of users) {
        if (verdict) break;
        verdict = await titled(user);
      }
    }
    verdicts.set(file, verdict);
    return verdict;
  }
  const result = new Set();
  for (const file of vueFiles) if (await titled(file)) result.add(file);
  return result;
}

// A component JavaScript gives the shell to render outside every layout: the router's notFoundComponent or
// fallbackRoute component, or the app's rootComponent.
function rendersOutsideLayouts(code, name) {
  const escaped = name.replaceAll("$", "\\$");
  const named = String.raw`(?<![\w$.])${escaped}(?![\w$])`;
  const handed = new RegExp(String.raw`\b(?:notFoundComponent|rootComponent)\s*:\s*${named}|\bcreateFallbackNotFoundRoute\s*\(\s*${named}|\bfallbackRoute\s*:\s*\{[^{}]*\bcomponent\s*:\s*${named}`, "gu");
  // Every use after the import (whose specifier may spell the name too) is a hand-over, or it may render anywhere.
  const body = code.replace(new RegExp(String.raw`\bimport\s+${escaped}\s+from\s*["'][^"']+["']`, "gu"), "");
  const uses = [...body.matchAll(new RegExp(named, "gu"))].length;
  const handovers = [...body.matchAll(handed)].length;
  return handovers > 0 && handovers === uses;
}

/**
 * The page rules: an inner page of a shell surface has a parent, its own or its layout's; a main-navigation
 * destination declares none.
 * @param {{ root: string, appFiles: string[], pageFiles: string[], report: Function }} options appFiles are the whole
 * app's source files (for surfaces, layouts and main navigation); pageFiles are the pages to judge
 */
async function checkPageParents({ root, appFiles, pageFiles, report }) {
  const read = async (file) => readFile(path.join(root, file), "utf8");
  let configSource = "";
  try {
    configSource = blankJsComments(await readFile(path.join(root, "config", "public.js"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const pages = new Map();
  for (const file of appFiles.filter(isPageFile)) pages.set(pageKey(file), readPage(file, await read(file)));
  const drawsShellBar = createShellBarReader(appFiles, read);
  const known = new Set(appFiles);
  for (const page of pages.values()) {
    if (page.layout) page.shell = await shellPlacement(page.file, page.source, drawsShellBar, known);
  }
  const surfaces = readSurfaces(configSource, [...pages.values()].map(({ file }) => routeOf(file)));
  const packageRoutes = await readPackageRoutes(root, known);
  // Every route the router has, by its address: the app's pages and the packages' routes.
  const routes = [...[...pages.values()].map(({ file }) => normalisePath(routePattern(routeOf(file)))),
    ...packageRoutes.map((route) => normalisePath(route.path))];
  // Whether the route at an address is the one the router renders for a literal path: it serves the path and no route
  // that ranks above it does. A link to /jobs/new leads to jobs/new.vue when there is one, not to jobs/[jobId].
  const leadsTo = (address, literal) => patternServes(address, literal)
    && !routes.some((other) => patternServes(other, literal) && outranks(other, address));
  const scripts = appFiles.filter((file) => /\.(?:[cm]?[jt]s|vue)$/u.test(file));
  const navigation = readMainNavigation(await Promise.all(scripts.map(async (file) => ({ file, source: blankJsComments(await read(file)) }))));
  for (const { file, source, offset, computed } of navigation.unreadable) {
    if (!pageFiles.includes(file)) continue;
    report({ rule: "nav/placement-data", file, ...lineIndex(source)(offset), message: `A main-navigation placement that isn't literal data: ${computed}. Declare each placement literally, with plain string suffixes and surface, so its destination can be read; until then no page is judged for nav/missing-parent.` });
  }
  const surfacePath = (file, surface) => normalisePath(routePattern(routeOf(file).slice(surface.pagesRoot.length)));
  const addressOf = (relative, surface) => normalisePath(routePattern(`${surface.pagesRoot}${relative}`));
  const shownOn = (owners, surface) => owners.length === 0 || owners.includes(surface.id) || owners.includes("*");
  // A destination by its suffix on the surface, or by its address (`to`). A page with a dynamic route (one page for
  // every module, at /modules/:moduleKey) is a destination when a destination's literal path is one it serves and no
  // route the router prefers (a static page such as /modules/new) serves too.
  const isDestination = (relative, surface) => navigation.destinations.some(({ suffix, to, surfaces: owners }) =>
    to === undefined
      ? shownOn(owners, surface) && leadsTo(addressOf(relative, surface), addressOf(suffix, surface))
      : leadsTo(addressOf(relative, surface), to));
  // A global route's address is a destination when a link's `to` names it, or a suffix leads there on a surface.
  const isAddress = (address) => navigation.destinations.some(({ suffix, to, surfaces: owners }) =>
    to === undefined
      ? surfaces.some((surface) => shownOn(owners, surface) && leadsTo(address, addressOf(suffix, surface)))
      : leadsTo(address, to));
  // An App.vue that wraps every page in the shell's bar leaves no page outside it.
  const appShell = appFiles.includes("src/App.vue") && await drawsShellBar("src/App.vue");
  const judged = [];
  for (const file of pageFiles.filter(isPageFile)) {
    const page = pages.get(pageKey(file));
    const surface = surfaceOf(routeOf(file), surfaces);
    if (!surface || page.redirect) continue;
    // The record that carries jskit.surface is the surface root, where Up stops, so a parent beside it is never read.
    if (page.surfaceRoot && page.parent) {
      const at = lineIndex(page.source)(page.parent.offset + PARENT_KEY.exec(page.parent.text).index);
      const fix = page.layout ? "move jskit.parent to the page this layout renders" : "remove jskit.surface and keep jskit.parent";
      report({ rule: "nav/surface-parent", file, ...at, message: `${path.posix.basename(file)} declares jskit.parent beside jskit.surface, so the shell never reads it and the page shows no Up: the record with the surface is the surface root, where Up stops. Declare the surface only on the surface's layout page (ShellLayout around <RouterView />) and the parent on the page it renders; here, ${fix}.` });
    }
    // The layouts that render this page, nearest first: src/pages/home/settings.vue renders home/settings/*.
    const segments = pageKey(file).split("/");
    const layouts = segments.slice(1).map((_, index) => pages.get(segments.slice(0, segments.length - 1 - index).join("/")))
      .filter((entry) => entry?.layout);
    const relative = surfacePath(file, surface);
    const position = lineIndex(page.source);
    // Up lives in the shell's top app bar, so only pages a shell layout renders have one. A page that declares a
    // parent expects that bar, with its title, Up and page actions; under no shell layout it shows none of them.
    if (!layouts.some((entry) => entry.shell !== "none")) {
      if (page.parent && !appShell && !await drawsShellBar(file)) {
        const at = position(page.parent.offset + PARENT_KEY.exec(page.parent.text).index);
        const layout = surface.pagesRoot ? `, src/pages/${surface.pagesRoot}.vue` : "";
        report({ rule: "nav/missing-shell-layout", file, ...at, message: `${relative} of ${surface.id} declares a parent, but no layout that draws the shell's top app bar renders it, so its title, Up and page actions never show. Give the surface its layout${layout}: ShellLayout around <RouterView />, with meta.jskit.surface "${surface.id}".` });
      }
      continue;
    }
    const destination = isDestination(relative, surface);
    if (destination && page.parent) {
      const at = position(page.parent.offset + PARENT_KEY.exec(page.parent.text).index);
      report({ rule: "nav/top-level-parent", file, ...at, message: `${relative} is a main-navigation destination of ${surface.id}, so it declares no parent: choosing it starts a fresh trail.` });
    }
    if (page.layout) continue;
    // A parent is inherited through the layouts below the surface root; a top-level layout's tabs are top-level.
    const chain = [];
    for (const entry of layouts) {
      if (entry.surfaceRoot) break;
      chain.push(entry);
    }
    const inherited = chain.find((entry) => entry.parent);
    const topLevel = destination || relative === "/" || chain.some((entry) => isDestination(surfacePath(entry.file, surface), surface));
    judged.push({ file, route: relative, surface: surface.id, topLevel, parent: page.parent ? "own" : inherited ? "inherited" : null });
    // A layout that also renders its pages without the shell (a shop device's sign-in) leaves which of them show Up
    // unreadable, so only a page that always renders under the bar needs a parent.
    const alwaysInShell = layouts.some((entry) => entry.shell === "all");
    if (!topLevel && !page.parent && !inherited && alwaysInShell && navigation.unreadable.length === 0) {
      const at = position(page.declarations[0]?.offset ?? 0);
      report({ rule: "nav/missing-parent", file, ...at, message: `Inner page ${relative} of ${surface.id} has no parent. Declare it once in the page's route meta (or its layout's, for tabs), so Up works after a direct entry.` });
    }
  }
  for (const route of packageRoutes) {
    if (!pageFiles.includes(route.file) && !pageFiles.includes(route.manifest)) continue;
    const verdict = await judgePackageRoute(route, { surfaces, appShell, drawsShellBar, isDestination, isAddress, readable: navigation.unreadable.length === 0, report });
    if (verdict) judged.push(verdict);
  }
  return judged;
}

/**
 * The page rules for a package's route, which the kernel adds at the top level: under the shell's bar only when its
 * component (or App.vue) draws it, with the parent its package.json declares in meta.jskit.parent. Findings point at
 * the route's entry in package.json.
 */
async function judgePackageRoute(route, { surfaces, appShell, drawsShellBar, isDestination, isAddress, readable, report }) {
  const position = lineIndex(route.source);
  const at = (offset) => ({ file: route.manifest, ...position(offset) });
  const address = normalisePath(route.path);
  const name = `${address} (route "${route.id}" of ${route.manifest})`;
  // A surface route's path starts at its surface's base: /app/manage/:view is /manage/:view of app.
  let surface = { id: "", pagesRoot: "" };
  let relative = address;
  if (route.scope === "surface") {
    surface = surfaces.find(({ id }) => id === route.surface);
    if (!surface) return null;
    const base = normalisePath(routePattern(surface.pagesRoot));
    if (base !== "/" && address !== base && !address.startsWith(`${base}/`)) return null;
    relative = normalisePath(address.slice(base === "/" ? 0 : base.length));
  }
  const where = surface.id ? ` of ${surface.id}` : "";
  if (route.surfaceRoot && route.parent) {
    report({ rule: "nav/surface-parent", ...at(route.parentOffset), message: `${name} declares jskit.parent beside jskit.surface, so the shell never reads it and the page shows no Up: the record with the surface is the surface root, where Up stops. Remove meta.jskit.surface; the route's own "surface" chooses where it is served.` });
  }
  if (!appShell && !await drawsShellBar(route.file)) {
    if (route.parent) {
      report({ rule: "nav/missing-shell-layout", ...at(route.parentOffset), message: `${name} declares a parent, but its component, ${route.file}, doesn't draw the shell's top app bar, so its title, Up and page actions never show. A package's route renders at the top level, under no layout: render ShellLayout around the page.` });
    }
    return null;
  }
  const destination = route.scope === "surface" ? isDestination(relative, surface) : isAddress(address);
  if (destination && route.parent) {
    report({ rule: "nav/top-level-parent", ...at(route.parentOffset), message: `${name} is a main-navigation destination${where}, so it declares no parent: choosing it starts a fresh trail.` });
  }
  const topLevel = destination || relative === "/";
  if (!topLevel && !route.parent && readable) {
    report({ rule: "nav/missing-parent", ...at(route.offset), message: `Inner page ${name}${where} has no parent. Declare it in the route's meta, "meta": { "jskit": { "parent": ... } }, so Up works after a direct entry.` });
  }
  return { file: route.file, route: relative, surface: surface.id || "global", topLevel, parent: route.parent ? "own" : null };
}

// src/pages/home/suppliers.vue is home/suppliers and src/pages/home/suppliers/index.vue is home/suppliers/index.
function pageKey(file) {
  return file.replace(/^src\/pages\//u, "").replace(/\.vue$/u, "");
}

// A folder or file whose name starts with "_" (such as a CRUD screen's _components) holds components, not pages.
function isPageFile(file) {
  return file.startsWith("src/pages/") && file.endsWith(".vue") && !pageKey(file).split("/").some((segment) => segment.startsWith("_"));
}

export {
  RULES as NAVIGATION_RULES,
  checkBackControl,
  checkLinkAttribute,
  checkNavigationCode,
  checkPageParents,
  checkScriptBackNames,
  isInAppPath,
  isPageFile,
  readTitledFiles
};
