import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { theme } from "../../src/theme/index.js";
import { writeAppearance } from "../../src/lib/appearance.js";
import viteConfig from "../../vite.config.mjs";

const LOADING = "Loading Vibe64…";
const FAILURE = "Vibe64 could not open. Reload the page to try again.";

const readText = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");
const squash = (text) => text.replace(/\s+/gu, " ").trim();

// An SVG's drawing: its path data, gradient colours and Vibe64's tile, whatever its size or stroke widths.
const drawing = (svg) => ({
  paths: [...svg.matchAll(/\sd="([^"]+)"/gu)].map(([, data]) => squash(data)),
  stops: [...svg.matchAll(/stop-color="([^"]+)"/gu)].map(([, colour]) => colour.toLowerCase()),
  tile: svg.match(/<rect x="64" y="64" width="384" height="384" rx="90"/u)?.[0]
});

function startupShell(html) {
  const start = html.indexOf('<div id="startup-shell">');
  assert.ok(start > 0, "the document must hold the startup shell");
  return html.slice(start, html.indexOf('<script type="module"'));
}

function startupStyle(html) {
  const style = html.match(/<style>([\s\S]*?)<\/style>/u);
  assert.ok(style, "the startup shell's style must be inline");
  return style[1];
}

// A stylesheet's top-level rules as { prelude, body }, comments removed; a body parses again for nested rules.
function cssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const rules = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{") {
      if (depth === 0) bodyStart = index + 1;
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        rules.push({ prelude: squash(text.slice(preludeStart, bodyStart - 1)), body: text.slice(bodyStart, index) });
        preludeStart = index + 1;
      }
    }
  }
  return rules;
}

function rule(rules, prelude) {
  const found = rules.find((candidate) => candidate.prelude === prelude);
  assert.ok(found, `the startup style must have a ${prelude} rule`);
  return found;
}

// The page as the head's script sees it before the editor's module graph runs.
function startupPage(script) {
  const listeners = {};
  const timers = [];
  const shell = { dataset: {} };
  const status = { textContent: LOADING };
  class HTMLScriptElement {
    constructor(type) {
      this.type = type;
    }
  }
  const elements = { "startup-shell": shell, "startup-status": status };
  const document = {
    readyState: "interactive",
    getElementById: (id) => elements[id] ?? null,
    addEventListener() {}
  };
  vm.runInNewContext(script, {
    HTMLScriptElement,
    document,
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
    window: { addEventListener: (type, listener) => { listeners[type] = listener; } }
  });
  // The editor's mount replaces #app's children, the shell with them.
  const mount = () => {
    delete elements["startup-shell"];
    delete elements["startup-status"];
  };
  return { listeners, timers, shell, status, HTMLScriptElement, mount };
}

test("the initial document is a branded loading screen without JavaScript or fake layout", async () => {
  const html = await readText("index.html");
  const shell = startupShell(html);
  assert.match(html, /<div id="app">\s*<div id="startup-shell">/u);
  assert.match(shell, /id="startup-status" role="status" aria-live="polite">Loading Vibe64…</u);
  assert.match(shell, /<noscript>JavaScript must be enabled to open Vibe64\.<\/noscript>/u);
  assert.match(html, /<style>[\s\S]*#startup-shell[\s\S]*<\/style>/u);
  assert.ok(html.indexOf('id="startup-shell"') < html.indexOf('src="/src/main.js"'));

  assert.doesNotMatch(shell, /startup-placeholder|<aside|<header/u, "no fake sidebar or header");
  assert.match(shell, /<p class="startup-wordmark">Vibe64<\/p>/u);
  assert.match(shell, /<div class="startup-progress" aria-hidden="true">/u);
  assert.match(squash(shell), /<p class="startup-reload"><span class="startup-slow">Taking longer than usual\?<\/span> <a href="">Reload the page<\/a><\/p>/u);
  // Without JavaScript nothing is loading: no moving bar and no loading line, only the noscript explanation.
  assert.match(squash(html), /<noscript><style>#startup-shell \.startup-progress, #startup-status \{ display: none; \}<\/style><\/noscript>/u);
});

test("the mark is Vibe64's logo drawn inline, so it shows before any request", async () => {
  const shell = startupShell(await readText("index.html"));
  const logo = await readText("docs/site/public/vibe64-logo.svg");
  const mark = shell.match(/<svg class="startup-mark"[\s\S]*?<\/svg>/u);
  assert.ok(mark, "the shell must draw the mark inline");
  assert.match(mark[0], /aria-hidden="true"/u);
  assert.ok(drawing(logo).tile, "the logo's tile");
  assert.deepEqual(drawing(mark[0]), drawing(logo));
  assert.doesNotMatch(shell, /<img|\ssrc=|url\((?!#)/u, "nothing in the shell waits for a request");
});

test("the browser tab's icon is Vibe64's logo, cropped to its tile", async () => {
  const html = await readText("index.html");
  const favicon = await readText("favicon.svg");
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/u);
  assert.deepEqual(drawing(favicon), drawing(await readText("docs/site/public/vibe64-logo.svg")));
  assert.match(favicon, /viewBox="64 64 384 384"/u, "the tile fills the tab's 16 px");
});

test("the loading screen paints the editor's Material 3 roles in light and dark", async () => {
  const rules = cssRules(startupStyle(await readText("index.html")));
  const { themes } = createMaterialVuetifyOptions(theme).theme;
  const tokens = (body) => Object.fromEntries([...body.matchAll(/--startup-([a-z-]+)\s*:\s*([^;]+);/gu)]
    .map(([, role, value]) => [role, value.trim().toLowerCase()]));
  const light = tokens(rule(rules, "#startup-shell").body);
  const roles = (scheme) => Object.fromEntries(Object.keys(light).map((name) => [name, themes[scheme].colors[name]?.toLowerCase()]));

  assert.deepEqual(Object.keys(light).sort(), ["background", "on-surface", "on-surface-variant", "primary", "surface-container-highest"]);
  assert.deepEqual(light, roles("light"));
  const systemDark = cssRules(rule(rules, "@media (prefers-color-scheme: dark)").body);
  assert.deepEqual(tokens(rule(systemDark, '#startup-shell:not([data-appearance="light"])').body), roles("dark"));
  assert.deepEqual(tokens(rule(rules, '#startup-shell[data-appearance="dark"]').body), roles("dark"));
});

test("the screen follows this browser's Appearance choice, else the device", async () => {
  const html = await readText("index.html");
  const script = html.match(/<div id="startup-shell">\s*<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script, "the shell's first child reads the Appearance choice before it paints");
  const stored = new Map();
  const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  globalThis.window = { localStorage: storage };
  try {
    for (const [choice, expected] of [["dark", "dark"], ["light", "light"], ["system", undefined]]) {
      writeAppearance(choice);
      const shell = { dataset: {} };
      vm.runInNewContext(script, { localStorage: storage, document: { currentScript: { parentElement: shell } } });
      assert.equal(shell.dataset.appearance, expected, choice);
    }
  } finally {
    delete globalThis.window;
  }
  const shell = { dataset: {} };
  const blocked = { document: { currentScript: { parentElement: shell } } };
  Object.defineProperty(blocked, "localStorage", { get() { throw new Error("storage is blocked"); } });
  assert.doesNotThrow(() => vm.runInNewContext(script, blocked));
  assert.equal(shell.dataset.appearance, undefined);
});

test("the loading bar slides only without a reduced-motion preference, and pulses in place with one", async () => {
  const rules = cssRules(startupStyle(await readText("index.html")));
  assert.match(rule(rules, "@keyframes startup-slide").body, /transform/u);
  const pulse = rule(rules, "@keyframes startup-pulse").body;
  assert.match(pulse, /opacity/u);
  assert.doesNotMatch(pulse, /transform/u);
  const motion = "@media (prefers-reduced-motion: no-preference)";
  for (const { prelude, body } of rules) {
    if (prelude !== motion && prelude !== "@keyframes startup-slide") assert.doesNotMatch(body, /startup-slide/u, prelude);
  }
  assert.match(rule(rules, motion).body, /animation: startup-slide /u);
  // The app's own reduced-motion rule ends every other animation at once; a still bar would read as stopped.
  assert.match(rule(rules, "@media (prefers-reduced-motion: reduce)").body, /animation: startup-pulse [^;]+ !important;/u);
});

test("the reload offer appears only after ten seconds without the editor, or when it fails to load", async () => {
  const html = await readText("index.html");
  const script = html.match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script, "the head's script runs before the module graph");
  const rules = cssRules(startupStyle(html));
  assert.match(rule(rules, "#startup-shell .startup-reload").body, /visibility: hidden;/u);
  assert.match(rule(rules, "#startup-shell[data-startup] .startup-reload").body, /visibility: visible;/u);
  assert.match(rule(rules, '#startup-shell[data-startup="failed"] .startup-progress').body, /visibility: hidden;/u);
  assert.match(rule(rules, '#startup-shell[data-startup="failed"] .startup-slow').body, /display: none;/u);

  const slow = startupPage(script);
  assert.deepEqual(slow.timers.map(({ delay }) => delay), [10_000]);
  assert.equal(slow.shell.dataset.startup, undefined);
  slow.timers[0].callback();
  assert.equal(slow.shell.dataset.startup, "slow");
  assert.equal(slow.status.textContent, LOADING);

  const failed = startupPage(script);
  failed.listeners.error({ target: {} });
  failed.listeners.error({ target: new failed.HTMLScriptElement("") });
  assert.equal(failed.shell.dataset.startup, undefined, "only a module script's failure counts");
  failed.listeners.error({ target: new failed.HTMLScriptElement("module") });
  assert.equal(failed.status.textContent, FAILURE);
  assert.equal(failed.shell.dataset.startup, "failed");
  failed.timers[0].callback();
  assert.equal(failed.shell.dataset.startup, "failed", "a failure stays a failure");

  const mounted = startupPage(script);
  mounted.mount();
  assert.doesNotThrow(() => mounted.timers[0].callback());
});

test("bootstrap failure replaces the loading message without exposing the exception", async () => {
  const source = await readText("src/main.js");
  const handler = source.match(/\}\)\.catch\(\(error\) => \{([\s\S]*)\}\);\s*$/u);
  assert.ok(handler, "bootstrap must retain its failure handler");
  const status = { textContent: LOADING };
  const shell = { dataset: {} };
  const context = {
    error: new Error("private diagnostic"),
    console: { error() {} },
    document: { getElementById: (id) => ({ "startup-status": status, "startup-shell": shell })[id] ?? null }
  };
  vm.runInNewContext(handler[1], context);
  assert.equal(status.textContent, FAILURE);
  assert.equal(shell.dataset.startup, "failed", "the failure offers the reload at once");
  context.document.getElementById = () => null;
  assert.doesNotThrow(() => vm.runInNewContext(handler[1], { ...context }));
});

test("a built page links its stylesheets after the loading screen, so they never hold its first paint", async () => {
  const plugin = viteConfig.plugins.find((candidate) => candidate?.name === "vibe64-stylesheets-after-loading-screen");
  assert.ok(plugin, "vite.config.mjs must move the built page's stylesheets");
  const source = await readText("index.html");
  // As Vite writes the page: the entry module, then its stylesheets, in <head>.
  const entry = '<script type="module" crossorigin src="/assets/index-AbCd1234.js"></script>';
  const stylesheets = ['<link rel="stylesheet" crossorigin href="/assets/index-EfGh5678.css">',
    '<link rel="stylesheet" crossorigin href="/assets/vendor-IjKl9012.css">'];
  const built = source.replace(/\s*<script type="module" src="\/src\/main\.js"><\/script>/u, "")
    .replace("</head>", `  ${entry}\n    ${stylesheets.join("\n    ")}\n  </head>`);
  const page = plugin.transformIndexHtml.handler(built, { bundle: {} });

  const head = page.slice(0, page.indexOf("<body>"));
  assert.ok(head.includes(entry), "the entry module stays in <head>, where it starts downloading at once");
  assert.doesNotMatch(head, /rel="stylesheet"/u);
  const bodyEnd = page.indexOf("</body>");
  const appEnd = page.lastIndexOf("</div>", bodyEnd);
  const positions = stylesheets.map((link) => page.indexOf(link));
  assert.ok(positions.every((position) => position > appEnd && position < bodyEnd), "after the loading screen, before </body>");
  assert.ok(positions[0] < positions[1], "in Vite's order, which keeps the cascade");
  const flat = (text) => text.replace(/\s+/gu, "");
  const links = flat(stylesheets.join(""));
  assert.equal(flat(page), flat(built).replace(links, "").replace("</body>", `${links}</body>`), "nothing else changes");
  // The development server injects styles from the modules themselves.
  assert.equal(plugin.transformIndexHtml.handler(built, {}), built);

  // A lazily loaded module's stylesheets follow the page's own, now at the end of <body>, as they followed them in
  // <head>: one added to <head> would come first in the cascade and lose every tie to the page's.
  const { filter, handler } = plugin.transform;
  assert.match("\0vite/preload-helper.js", filter.id);
  assert.doesNotMatch("/src/main.js", filter.id);
  const helper = "link.href = dep.href;\n\t\t\t\tdocument.head.appendChild(link);\n\t\t\t\tif (isCss) return new Promise(";
  assert.equal(handler.call({}, helper), helper.replace("document.head", "document.body"));
  const build = { error(message) { throw new Error(message); } };
  assert.throws(() => handler.call(build, "document.head.append(link);"), /preload helper no longer appends them/u);
});

test("the entry's static imports come in its own file, and the project page's in one file of its own", () => {
  const { groups } = viteConfig.build.rolldownOptions.output.codeSplitting;
  assert.deepEqual(groups[0], { name: "startup", tags: ["$initial"], priority: 2 });
  assert.equal(groups[1].includeDependenciesRecursively, false);
  const projectChunk = groups[1].name;
  const file = (relative) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));
  const project = file("src/pages/app/project/[slug].vue");
  const dashboard = file("src/pages/app/project/[slug]/dashboard.vue");
  const learning = file("src/pages/app/learning.vue");
  const account = file("src/pages/account.vue");
  const launcher = file("src/pages/launcher.vue");
  // Each module's static and lazy imports. The entry loads the routes lazily; the project page loads a terminal lazily,
  // and so does the launcher, which loads without the project page.
  const graph = {
    [file("index.html")]: { imports: [file("src/main.js")] },
    [file("src/main.js")]: { imports: ["startup.js"], lazy: [project, dashboard, learning, account, launcher] },
    [project]: { imports: ["startup.js", "conversation.js", "layout.js", "toolbar.js", "panel.js"], lazy: ["terminal.js"] },
    "conversation.js": { imports: ["markdown.js"] },
    "layout.js": { imports: ["layout-frame.js", "toolbar.js"] },
    [dashboard]: { imports: ["panel.js", "dashboard-table.js"] },
    [learning]: { imports: [project] },
    [account]: { imports: ["layout.js"] },
    [launcher]: { imports: ["toolbar.js"], lazy: ["terminal.js"] },
    "terminal.js": { imports: ["terminal-font.js"] }
  };
  // Rolldown's view of the graph while it chunks; a module with no entry above imports nothing.
  const chunking = (modules) => {
    const ids = new Set(Object.entries(modules).flatMap(([id, { imports = [], lazy = [] }]) => [id, ...imports, ...lazy]));
    return {
      ids,
      getModuleInfo(id) {
        if (!ids.has(id)) return null;
        const dynamicImporters = Object.keys(modules).filter((importer) => modules[importer].lazy?.includes(id));
        return { importedIds: modules[id]?.imports || [], dynamicallyImportedIds: modules[id]?.lazy || [], dynamicImporters };
      }
    };
  };
  const names = (modules) => {
    const pass = chunking(modules);
    return Object.fromEntries([...pass.ids].map((id) => [id, projectChunk(id, pass)]));
  };
  const chunks = names(graph);
  // The project page with what only it needs, the nested routes' modules it imports among them.
  assert.equal(chunks[project], "project");
  assert.equal(chunks["conversation.js"], "project");
  assert.equal(chunks["markdown.js"], "project");
  assert.equal(chunks["panel.js"], "project", "the dashboard is the project page's nested route");
  // What a page loaded without the project page imports too: one file for each set of such pages, so the account
  // page and the launcher load none of the project page.
  assert.equal(chunks["layout.js"], "project-shared-layout-frame", "named after its first module");
  assert.equal(chunks["layout-frame.js"], "project-shared-layout-frame");
  assert.equal(chunks["toolbar.js"], "project-shared-toolbar");
  // Rolldown's own chunks: what the project page does not import, however it is loaded.
  for (const id of [dashboard, learning, account, launcher, "dashboard-table.js", "terminal.js", "terminal-font.js"]) {
    assert.equal(chunks[id], null, id);
  }

  // A component only the project page loads lazily loads with it; learning shows the project page itself.
  const withTerminalOnlyInProject = { ...graph, [launcher]: { imports: ["toolbar.js"] }, "terminal.js": { imports: ["terminal-font.js", "panel.js"] } };
  assert.equal(names(withTerminalOnlyInProject)["panel.js"], "project");
  const withSharedTerminal = { ...graph, "terminal.js": { imports: ["terminal-font.js", "panel.js"] } };
  assert.equal(names(withSharedTerminal)["panel.js"], "project-shared-panel", "the launcher loads the terminal too");

  const withoutProjectPage = { [file("index.html")]: { imports: [file("src/main.js")] }, [file("src/main.js")]: { imports: ["startup.js"] } };
  assert.throws(() => names(withoutProjectPage), /the build has no .*\[slug\]\.vue/u);
});
