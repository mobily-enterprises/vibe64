import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "./files.mjs";
import {
  NAVIGATION_RULES,
  checkBackControl,
  checkLinkAttribute,
  checkNavigationCode,
  checkPageParents,
  checkScriptBackNames,
  readTitledFiles
} from "./navigation.mjs";
import {
  HEX_COLOUR,
  blankCssComments,
  blankHtmlComments,
  blankJsComments,
  exclusiveBranches,
  lineIndex,
  readConditionalBranches,
  readDeclarations,
  readExceptions,
  readInlineDeclarations,
  readTags,
  splitVue
} from "./material3-source.mjs";
import { checkRemovedProps, checkVuetifyByNameAttribute, checkVuetifyByNameCode, readRemovedProps, readVuetifyComponents } from "./ui-components.mjs";

// The conformance check of the JSKIT Material 3 guide, its navigation rules (nav/*), its visual rules (m3/*) and its
// rules for using components (ui/*, ui-components.mjs). It
// reads application source, never runs it. Plain `jskit check` runs it over the whole app and fails on any finding, in
// every JSKIT app's verify (#241); `jskit check m3 [path ...]` runs it alone, narrowed to a section or a task's changed
// files. Nothing turns the check off for an app, a folder or a file: the only exception is one line's
// `m3-check: allow <m3 rule> - <reason>`.

const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/material-3";
const RULES = Object.freeze({
  ...NAVIGATION_RULES,
  "m3/duplicate-h1": "the-top-app-bar-carries-the-page",
  "m3/raw-hex": "colour",
  "m3/dark-scheme": "colour",
  "m3/outlined-card": "colour",
  "m3/mdi-icon": "foundation",
  "m3/fixed-button-height": "exact-sizes",
  "ui/removed-prop": "foundation",
  "ui/vuetify-by-name": "foundation",
  "m3/allow-reason": "exceptions",
  "m3/allow-rule": "exceptions",
  "nav/allow": "exceptions"
});
// The rules one line's exception may excuse: every visual rule, never a navigation rule or an exception rule.
const EXCUSABLE_RULES = new Set(Object.keys(RULES).filter((rule) => rule.startsWith("m3/") && !rule.startsWith("m3/allow-")));
const SOURCE_EXTENSIONS = new Set([".vue", ".js", ".mjs", ".cjs", ".ts", ".mts", ".css", ".scss"]);
// Code that renders no application UI: dependencies, build output, tests and fixtures, server code and migrations.
const SKIPPED_DIRECTORIES = new Set([
  "node_modules", "dist", "build", "coverage", ".git", ".vite", ".jskit", "test", "tests", "__tests__", "e2e",
  "fixtures", "server", "migrations"
]);
const SKIPPED_FILE = /\.(?:test|spec)\.[cm]?[jt]s$|\.d\.ts$/u;
// In JSKIT's own repository, packages/ holds the framework, which implements the navigation, Up and reloads the rules
// send an app to (ShellUpButton, reloadAppPage(), leaveApp(), the system Back button). A whole-app run reads only the
// app code a JSKIT package carries, its patterns and templates; an app's own packages are read in full.
const FRAMEWORK_SCOPE = "@jskit-ai/";
const FRAMEWORK_APP_CODE = new Set(["patterns", "templates"]);
// The generated colour scheme is the one home of hex values.
const THEME_DIRECTORY = "theme";
// Colours that are content, not UI, keep one value in both schemes, so they are not theme colours (which are toned per
// scheme): they are named hex exports of src/theme/palettes.js, which this check, like all of src/theme/, reads as
// the place for hex values.
const CONTENT_COLOUR = "A content colour (an identity palette, artwork, a brand mark, a chart series) is a named export of src/theme/palettes.js, used as it is.";
const WHOLE_APP_ROOTS = Object.freeze(["src", "packages"]);

const hexPattern = () => new RegExp(HEX_COLOUR, "gu");
const exactHex = new RegExp(`^${HEX_COLOUR}$`, "u");
// A colour written as channels, as a hand-made shadow is: rgba(0, 0, 0, 0.15), rgb(0 0 0 / 20%), hsl(...). One that
// reads a theme role, rgba(var(--v-theme-shadow), 0.2), is not.
const CHANNEL_COLOUR = String.raw`\b(?:rgba?|hsla?)\(\s*[\d.][^()]*\)`;
const channelColour = () => new RegExp(CHANNEL_COLOUR, "giu");
const exactChannelColour = new RegExp(`^${CHANNEL_COLOUR}$`, "iu");
const CHANNEL_FIX = "Use rgb(var(--v-theme-<role>)), with an alpha for a shadow or scrim: rgba(var(--v-theme-shadow), 0.2).";
// An attribute that takes a colour as a plain value: a Vuetify colour prop (color, bg-color, baseColor) or SVG paint.
// Any other attribute's "#add" is a fragment or text.
const COLOUR_ATTRIBUTE = /(?:colou?r|^fill|^stroke)$/iu;
// A url(...) in CSS, whose "#fade" names an SVG element, not a colour.
const CSS_URL = /url\([^)]*\)/giu;
// A border attribute that draws none: a bound false, 0, null or undefined, or "0" (Vuetify's border-0).
const NO_BORDER = /^(?:false|0|null|undefined)$/u;
const quotedHex = () => new RegExp(`(["'\`])(${HEX_COLOUR})\\1`, "gu");
const MDI_STRING = /\bmdi-[a-z][a-z0-9-]*/gu;
const MDI_IMPORT = /(?:from\s*|import\s*|require\(\s*)["'](@mdi\/(?:js|font)[^"']*)["']/gu;
const SURFACE_TAGS = new Set(["v-card", "v-sheet"]);
const VUETIFY_BOOTSTRAP = /\bcreateVuetify\s*\(/u;
const DARK_SCHEME = /(?:\bdark|"dark")\s*:\s*true\b/u;
// @jskit-ai/material-web generates the light and dark schemes from the app's seed at startup.
const GENERATED_SCHEMES = /\bcreateMaterialVuetifyOptions\s*\(/u;
const PINNED_LIGHT = /\bdefaultTheme\s*:\s*["']light["']/u;
const SHELL_PACKAGE = "@jskit-ai/shell-web";
const isNavigationRule = (rule) => rule.startsWith("nav/");
const SMALLER_BUTTON = "A smaller button is size=\"small\" or \"x-small\", which keeps the touch target.";

function isSkippedDirectory(name) {
  return SKIPPED_DIRECTORIES.has(name);
}

function isSourceFile(relativePath) {
  if (SKIPPED_FILE.test(relativePath) || !SOURCE_EXTENSIONS.has(path.extname(relativePath))) return false;
  return !relativePath.split("/").slice(0, -1).some(isSkippedDirectory);
}

async function isFrameworkPackage(projectRoot, directory) {
  if (!/^packages\/[^/]+$/u.test(directory)) return false;
  try {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, directory, "package.json"), "utf8"));
    return String(manifest?.name || "").startsWith(FRAMEWORK_SCOPE);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function walk(projectRoot, directory, files, wholeApp = false) {
  let entries;
  try {
    entries = await readdir(path.join(projectRoot, directory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const framework = wholeApp && await isFrameworkPackage(projectRoot, directory);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (framework && !(entry.isDirectory() && FRAMEWORK_APP_CODE.has(entry.name))) continue;
    if (entry.isDirectory()) {
      if (!isSkippedDirectory(entry.name)) await walk(projectRoot, relative, files, wholeApp);
    } else if (entry.isFile() && isSourceFile(relative)) {
      files.add(relative);
    }
  }
}

// The files a run checks and the paths it could not find.
async function collectFiles(projectRoot, paths) {
  const files = new Set();
  const missing = [];
  const targets = paths.length > 0 ? paths : WHOLE_APP_ROOTS;
  for (const target of targets) {
    const absolute = path.resolve(projectRoot, target);
    const relative = toPosixPath(path.relative(projectRoot, absolute));
    if (relative.startsWith("../") || path.isAbsolute(relative)) {
      throw new Error(`jskit check m3 checks paths inside the application only: ${target}`);
    }
    let info;
    try {
      info = await stat(absolute);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (paths.length > 0) missing.push(target);
      continue;
    }
    if (info.isDirectory()) await walk(projectRoot, relative === "" ? "" : relative, files, paths.length === 0);
    else if (isSourceFile(relative)) files.add(relative);
  }
  return { files: [...files].sort(), missing };
}

// One line's `m3-check: allow <m3 rule> - <reason>` excuses that rule on its own line and the next. Any other
// m3-check comment is itself a finding: one naming a nav/* rule (nothing excuses those), an unknown rule, or no reason.
function createReporter(file, source) {
  const position = lineIndex(source);
  const findings = [];
  const exceptions = [];
  const excused = new Map();
  for (const { line, rule, reason } of readExceptions(source)) {
    const at = { file, line, column: 1 };
    if (isNavigationRule(rule)) {
      findings.push({ rule: "nav/allow", ...at, message: `Nothing excuses a navigation rule (${rule}). Delete the comment and fix the line.` });
    } else if (!EXCUSABLE_RULES.has(rule)) {
      const what = rule ? `${rule} is not a Material 3 rule` : "The comment is not \"m3-check: allow <rule> - <reason>\"";
      findings.push({ rule: "m3/allow-rule", ...at, message: `${what}, so it excuses nothing.` });
    } else if (!reason) {
      findings.push({ rule: "m3/allow-reason", ...at, message: `The exception for ${rule} gives no reason ("m3-check: allow ${rule} - <reason>"), so it excuses nothing.` });
    } else {
      exceptions.push({ file, line, rule, reason });
      for (const excusedLine of [line, line + 1]) excused.set(excusedLine, [...(excused.get(excusedLine) || []), rule]);
    }
  }
  function report(rule, offset, message) {
    const at = position(offset);
    if (excused.get(at.line)?.includes(rule)) return;
    findings.push({ rule, file, line: at.line, column: at.column, message });
  }
  return { report, findings, exceptions };
}

// Hex colours and navigation in any JavaScript: a script block, a module, or a bound or event attribute's expression.
function checkCode(code, offset, context) {
  const { report, themed } = context;
  if (!themed) {
    for (const match of code.matchAll(quotedHex())) {
      report("m3/raw-hex", offset + match.index, `Raw colour ${match[2]}. Use a theme colour role. ${CONTENT_COLOUR}`);
    }
    for (const match of code.matchAll(channelColour())) {
      report("m3/raw-hex", offset + match.index, `Raw colour ${match[0]}. ${CHANNEL_FIX} ${CONTENT_COLOUR}`);
    }
  }
  checkNavigationCode(code, offset, report);
  checkVuetifyByNameCode(code, offset, context);
}

function checkScript(code, offset, context) {
  const { report } = context;
  checkCode(code, offset, context);
  checkScriptBackNames(code, offset, report);
  for (const match of code.matchAll(/["'`](mdi-[a-z][a-z0-9-]*)/gu)) {
    report("m3/mdi-icon", offset + match.index, `MDI icon "${match[1]}". Use a Material Symbols alias such as "$add" from the app's Vuetify icon aliases.`);
  }
  for (const match of code.matchAll(MDI_IMPORT)) {
    report("m3/mdi-icon", offset + match.index, `Import of ${match[1]}. Icons are Material Symbols through the app's Vuetify "$" aliases.`);
  }
  for (const match of code.matchAll(/\bVCard\s*:\s*\{[^}]*\bvariant\s*:\s*["']outlined["']/gu)) {
    report("m3/outlined-card", offset + match.index, "VCard defaults to the outlined variant. Material 3 cards are flat surface-container tiers; a default card colour becomes the text colour on outlined cards.");
  }
  for (const match of code.matchAll(/\bVBtn\s*:\s*\{[^}]*\b(?:height|minHeight)\s*:/gu)) {
    report("m3/fixed-button-height", offset + match.index, "VBtn defaults set a height. JSKIT ships the 40dp button with its 48dp touch target.");
  }
}

function checkCss(css, offset, context) {
  for (const declaration of readDeclarations(css, offset)) {
    checkDeclaration(declaration, context);
  }
}

function checkDeclaration(declaration, context) {
  const { report, themed } = context;
  if (!themed) {
    const value = declaration.value.replace(CSS_URL, (url) => " ".repeat(url.length));
    for (const match of value.matchAll(hexPattern())) {
      report("m3/raw-hex", declaration.valueOffset + match.index, `Raw colour ${match[0]}. Use rgb(var(--v-theme-<role>)). ${CONTENT_COLOUR}`);
    }
    for (const match of value.matchAll(channelColour())) {
      report("m3/raw-hex", declaration.valueOffset + match.index, `Raw colour ${match[0]}. ${CHANNEL_FIX} ${CONTENT_COLOUR}`);
    }
  }
  // .v-btn and its modifiers (.v-btn--size-large), not .v-btn-group or .v-btn-toggle.
  const buttonRule = declaration.selectors.some((selector) => /\.v-btn(?:--[\w-]+)?(?![\w-])/u.test(selector));
  if (buttonRule && ["height", "min-height", "--v-btn-height"].includes(declaration.property)) {
    report("m3/fixed-button-height", declaration.offset, `A fixed ${declaration.property} on buttons. JSKIT ships the 40dp button with its 48dp touch target; remove it. ${SMALLER_BUTTON}`);
  }
}

function attribute(tag, name) {
  return tag.attributes.find((entry) => entry.name === name);
}

function checkTemplate(template, context) {
  const { report } = context;
  const tags = readTags(template);
  for (const match of template.text.matchAll(MDI_STRING)) {
    report("m3/mdi-icon", template.offset + match.index, `MDI icon "${match[0]}". Use a Material Symbols alias such as "$add" from the app's Vuetify icon aliases.`);
  }
  // The branches each h1 renders under: h1s on different branches of one v-if chain never show together.
  const branches = readConditionalBranches(template);
  checkRemovedProps(tags, context.script, context.removedProps, report);
  const headings = [];
  for (const tag of tags) {
    for (const entry of tag.attributes) {
      checkAttribute(tag, entry, context);
    }
    if (SURFACE_TAGS.has(tag.name)) checkSurface(tag, report);
    if (tag.name === "v-btn") checkButtonSize(tag, report);
    checkBackControl(tag, report, context.script);
    if (tag.name === "h1") {
      const branch = branches.get(tag.offset) || [];
      if (headings.some((other) => !exclusiveBranches(other, branch))) report("m3/duplicate-h1", tag.offset, "A second h1 in one template. A page has one title, carried by the top app bar.");
      else if (context.titled) report("m3/duplicate-h1", tag.offset, "An in-page h1 under the top app bar, which carries the page title; use a title role (text-title-large) for a section title.");
      headings.push(branch);
    }
  }
}

function checkAttribute(tag, entry, context) {
  const { report, themed } = context;
  if (entry.event || entry.bound) {
    checkCode(entry.value, entry.valueOffset, context);
  } else if (entry.name === "style") {
    for (const declaration of readInlineDeclarations(entry.value, entry.valueOffset)) {
      checkDeclaration({ ...declaration, selectors: tag.name === "v-btn" ? [".v-btn"] : [] }, context);
    }
  } else if (!themed && COLOUR_ATTRIBUTE.test(entry.name) &&
    (exactHex.test(entry.value.trim()) || exactChannelColour.test(entry.value.trim()))) {
    report("m3/raw-hex", entry.valueOffset, `Raw colour ${entry.value.trim()}. Use a theme colour role such as color="primary". ${CONTENT_COLOUR}`);
  }
  checkLinkAttribute(tag, entry, context.report);
  checkVuetifyByNameAttribute(tag, entry, context);
}

function checkSurface(tag, report) {
  const variant = attribute(tag, "variant");
  if (variant && /(^|["'`\s])outlined(["'`\s]|$)/u.test(variant.value)) {
    report("m3/outlined-card", variant.offset, `${tag.name} with variant="outlined". Material 3 separates surfaces by tone: use the flat default or a surface-container colour.`);
  }
  const border = attribute(tag, "border");
  if (border && !(border.bound ? NO_BORDER.test(border.value.trim()) : border.value.trim() === "0")) {
    report("m3/outlined-card", border.offset, `${tag.name} with a border. Material 3 separates surfaces by tone: use the flat default or a surface-container colour.`);
  }
}

function checkButtonSize(tag, report) {
  for (const name of ["height", "min-height"]) {
    const entry = attribute(tag, name);
    if (entry) report("m3/fixed-button-height", entry.offset, `A fixed ${name} on v-btn. JSKIT ships the 40dp button with its 48dp touch target; remove it. ${SMALLER_BUTTON}`);
  }
}

function checkFile(file, source, context) {
  const { report, findings, exceptions } = createReporter(file, source);
  const fileContext = { ...context, report, file, themed: file.split("/").slice(0, -1).includes(THEME_DIRECTORY) };
  const extension = path.extname(file);
  if (extension === ".vue") {
    const { template, scripts, styles } = splitVue(source);
    // The template's handlers are defined in the component's script.
    const script = scripts.map((block) => blankJsComments(block.text)).join("\n");
    if (template) checkTemplate({ offset: template.offset, text: blankHtmlComments(template.text) }, { ...fileContext, script });
    for (const block of scripts) checkScript(blankJsComments(block.text), block.offset, fileContext);
    for (const block of styles) checkCss(blankCssComments(block.text), block.offset, fileContext);
  } else if (extension === ".css" || extension === ".scss") {
    checkCss(blankCssComments(source), 0, fileContext);
  } else {
    checkScript(blankJsComments(source), 0, fileContext);
  }
  return { findings, exceptions };
}

async function readProjectManifest(projectRoot) {
  try {
    return JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function usesShell(manifest) {
  return ["dependencies", "devDependencies"].some((field) => Boolean(manifest?.[field]?.[SHELL_PACKAGE]));
}

// The whole-application rule: Vuetify's bootstrap must offer a dark scheme and follow the person's preference.
async function checkDarkScheme(projectRoot, checkedFiles, wholeApp) {
  const { files } = await collectFiles(projectRoot, ["src"]);
  const sources = new Map();
  for (const file of files) sources.set(file, blankJsComments(await readFile(path.join(projectRoot, file), "utf8")));
  const bootstrap = files.find((file) => VUETIFY_BOOTSTRAP.test(sources.get(file)));
  if (!bootstrap) return [];
  const themeFiles = new Set([bootstrap, ...files.filter((file) => file.split("/").includes(THEME_DIRECTORY))]);
  if (!wholeApp && !checkedFiles.some((file) => themeFiles.has(file))) return [];
  const source = await readFile(path.join(projectRoot, bootstrap), "utf8");
  const { report, findings } = createReporter(bootstrap, source);
  const offset = VUETIFY_BOOTSTRAP.exec(source)?.index ?? 0;
  const all = [...sources.values()];
  if (!all.some((text) => DARK_SCHEME.test(text) || GENERATED_SCHEMES.test(text))) {
    report("m3/dark-scheme", offset, "No dark colour scheme. Generate light and dark schemes from the app's seed colour.");
  }
  if (all.some((text) => PINNED_LIGHT.test(text))) {
    report("m3/dark-scheme", offset, "The theme is pinned to light. Use defaultTheme: \"system\" so the person's light, dark or system choice applies.");
  }
  return findings.filter((finding) => finding.rule === "m3/dark-scheme");
}

/**
 * Checks application source against the Material 3 guide.
 * @param {{ projectRoot?: string, paths?: string[] }} options paths are files or directories relative to the root
 */
async function checkMaterial3({ projectRoot = process.cwd(), paths = [] } = {}) {
  const root = path.resolve(projectRoot);
  const { files, missing } = await collectFiles(root, paths);
  const appFiles = paths.length === 0 ? files : (await collectFiles(root, [])).files;
  // Only a page under the shell's top app bar has its title there; one without a bar has its own h1.
  const titledFiles = usesShell(await readProjectManifest(root))
    ? await readTitledFiles({ root, appFiles: [...new Set([...appFiles, ...files])] })
    : new Set();
  const removedProps = await readRemovedProps(root);
  const vuetifyComponents = await readVuetifyComponents(root);
  const findings = [];
  const exceptions = [];
  for (const file of files) {
    const context = { titled: titledFiles.has(file), removedProps, vuetifyComponents };
    const checked = checkFile(file, await readFile(path.join(root, file), "utf8"), context);
    findings.push(...checked.findings);
    exceptions.push(...checked.exceptions);
  }
  const pages = await checkPageParents({ root, appFiles, pageFiles: files, report: (finding) => findings.push(finding) });
  findings.push(...await checkDarkScheme(root, files, paths.length === 0));
  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column);
  return { projectRoot: root, wholeApp: paths.length === 0, files, missing, pages, findings, exceptions, ok: findings.length === 0 };
}

function formatFindings(result) {
  const lines = [];
  for (const finding of result.findings) {
    lines.push(`${finding.file}:${finding.line}:${finding.column}  ${finding.rule}  ${finding.message}`);
    lines.push(`  ${GUIDE}#${RULES[finding.rule]}`);
  }
  for (const target of result.missing) lines.push(`Skipped ${target}: not found.`);
  return lines;
}

function formatMaterial3Report(result) {
  const lines = formatFindings(result);
  const scope = result.wholeApp ? "the whole app" : "the given paths";
  const fileCount = `${result.files.length} file(s)`;
  const withFindings = new Set(result.findings.map((finding) => finding.file)).size;
  if (result.exceptions.length > 0) lines.push(`Exceptions (${result.exceptions.length}):`);
  for (const { file, line, rule, reason } of result.exceptions) lines.push(`${file}:${line}  ${rule}  ${reason}`);
  const exceptions = ` Exceptions: ${result.exceptions.length}.`;
  lines.push(result.ok
    ? `Material 3 check: no findings in ${fileCount} of ${scope}.${exceptions}`
    : `Material 3 check: ${result.findings.length} finding(s) in ${withFindings} of ${fileCount} of ${scope}.${exceptions}`);
  return lines.join("\n");
}

export { RULES as MATERIAL3_RULES, checkMaterial3, formatMaterial3Report };
