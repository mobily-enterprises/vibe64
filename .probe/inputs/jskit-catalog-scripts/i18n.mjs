import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "./files.mjs";
import { resolveInstalledPackage } from "./project-packages.mjs";

// `jskit i18n export|check <locale>`: an app translates JSKIT by supplying
// src/locales/<locale>/jskit.json, keyed exactly like the merged locales/en.json
// catalogs of its installed @jskit-ai packages.

const JSKIT_SCOPE_PREFIX = "@jskit-ai/";
const LOCALE_CATALOG_EXPORT = "./locales/en.json";
// The sections the app's runtime follows, so the export holds what the app renders.
const RUNTIME_DEPENDENCY_FIELDS = Object.freeze(["dependencies", "optionalDependencies", "peerDependencies"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalLocale(code = "") {
  const value = String(code || "").trim();
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    if (canonical) return canonical;
  } catch {
    // Reported below.
  }
  throw new Error(`Invalid locale code "${value}": use a BCP 47 tag such as fr or pt-BR.`);
}

function translationFile(projectRoot, locale) {
  return path.join(path.resolve(projectRoot), "src", "locales", locale, "jskit.json");
}

// --- Mirror of @jskit-ai/kernel/shared/i18n ---------------------------------------
// @jskit-ai/jskit-catalog has no dependencies (apps run it through npx), so it
// cannot import the kernel. These copies must match kernel/shared/i18n exactly;
// test/i18n.test.js runs the same messages through both.

function mergeCatalogs(...catalogs) {
  const merged = {};
  for (const catalog of catalogs) {
    if (!isRecord(catalog)) {
      continue;
    }
    for (const [name, value] of Object.entries(catalog)) {
      merged[name] = isRecord(value) && isRecord(merged[name]) ? mergeCatalogs(merged[name], value) : value;
    }
  }
  return merged;
}

function flattenCatalog(catalog, prefix = "") {
  const flat = {};
  if (!isRecord(catalog)) {
    return flat;
  }
  for (const [name, value] of Object.entries(catalog)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (isRecord(value)) {
      Object.assign(flat, flattenCatalog(value, key));
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function placeholderEnd(template, start) {
  let index = start + 1;
  let quoted = false;
  while (index < template.length) {
    const char = template[index];
    if (char === "'") {
      quoted = !quoted;
    } else if (char === "}" && !quoted) {
      return index;
    }
    index += 1;
  }
  throw new SyntaxError(`Unclosed placeholder in message: ${template}`);
}

function parseMessage(template = "") {
  const source = String(template);
  const choices = [[]];
  let text = "";
  const flush = () => {
    if (text) {
      choices.at(-1).push({ text });
      text = "";
    }
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "{") {
      const end = placeholderEnd(source, index);
      const body = source.slice(index + 1, end).trim();
      flush();
      choices.at(-1).push(body.startsWith("'") ? { text: body.slice(1, -1) } : { param: body });
      index = end + 1;
      continue;
    }
    if (char === "|") {
      flush();
      choices.push([]);
      index += 1;
      continue;
    }
    text += char;
    index += 1;
  }
  flush();
  if (choices.length > 1) {
    for (const parts of choices) {
      if (parts[0]?.text !== undefined) parts[0] = { text: parts[0].text.trimStart() };
      const last = parts.length - 1;
      if (parts[last]?.text !== undefined) parts[last] = { text: parts[last].text.trimEnd() };
    }
  }
  return choices;
}

function messageParams(template = "") {
  const names = new Set();
  for (const parts of parseMessage(template)) {
    for (const part of parts) {
      if (part.param !== undefined) names.add(part.param);
    }
  }
  return [...names].sort();
}

// --- Installed catalogs ------------------------------------------------------------

function localeCatalogTarget(manifest) {
  const target = isRecord(manifest.exports) ? manifest.exports[LOCALE_CATALOG_EXPORT] : undefined;
  return typeof target === "string" ? target : isRecord(target) ? target.default : undefined;
}

async function readJsonFile(file) {
  const contents = await readFile(file, "utf8");
  let value;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) {
    throw new TypeError(`${file} must contain a JSON object.`);
  }
  return value;
}

// Walks the app's runtime dependency graph (local packages included) and returns the
// English catalog of every @jskit-ai package that exports ./locales/en.json, in
// package order, so the merge is deterministic.
async function collectInstalledCatalogs(projectRoot) {
  const root = path.resolve(projectRoot);
  const rootManifest = await realpath(path.join(root, "package.json")).catch(() => null);
  if (!rootManifest) {
    throw new Error(`JSKIT project root has no package.json: ${root}`);
  }
  const pending = [rootManifest];
  const visited = new Set();
  const catalogs = [];
  while (pending.length > 0) {
    const manifestPath = pending.pop();
    if (visited.has(manifestPath)) continue;
    visited.add(manifestPath);
    const manifest = await readJsonFile(manifestPath);
    const directory = path.dirname(manifestPath);
    const target = localeCatalogTarget(manifest);
    if (String(manifest.name || "").startsWith(JSKIT_SCOPE_PREFIX) && target) {
      const file = path.join(directory, target);
      catalogs.push({ packageId: manifest.name, file, catalog: await readJsonFile(file) });
    }
    for (const field of RUNTIME_DEPENDENCY_FIELDS) {
      for (const name of Object.keys(isRecord(manifest[field]) ? manifest[field] : {})) {
        const resolved = await resolveInstalledPackage(directory, name);
        if (resolved && !visited.has(resolved)) pending.push(resolved);
      }
    }
  }
  return catalogs.sort((left, right) => left.packageId.localeCompare(right.packageId) || left.file.localeCompare(right.file));
}

async function readInstalledEnglish(projectRoot) {
  const catalogs = await collectInstalledCatalogs(projectRoot);
  if (catalogs.length < 1) {
    throw new Error(`No installed @jskit-ai package ships ${LOCALE_CATALOG_EXPORT.slice(2)} under ${path.resolve(projectRoot)}; run npm install first.`);
  }
  return {
    packageIds: [...new Set(catalogs.map((entry) => entry.packageId))],
    english: flattenCatalog(mergeCatalogs(...catalogs.map((entry) => entry.catalog)))
  };
}

async function readTranslationFile(file) {
  try {
    return await readJsonFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

// Rebuilds a nested catalog from flat keys in their given order. A key that is both
// a message and a group of messages cannot be written, so it stops the export.
function nestCatalog(flat, file) {
  const keys = new Set(Object.keys(flat));
  const nested = {};
  for (const [key, value] of Object.entries(flat)) {
    const segments = key.split(".");
    let current = nested;
    for (let index = 1; index < segments.length; index += 1) {
      const group = segments.slice(0, index).join(".");
      if (keys.has(group)) {
        throw new Error(`${file} cannot hold both ${group} and ${key}; rename or remove one, then export again.`);
      }
      current = current[segments[index - 1]] ??= {};
    }
    current[segments.at(-1)] = value;
  }
  return nested;
}

function relativeFile(projectRoot, file) {
  return toPosixPath(path.relative(path.resolve(projectRoot), file));
}

// --- export ------------------------------------------------------------------------

async function exportTranslations({ projectRoot = process.cwd(), locale } = {}) {
  const code = canonicalLocale(locale);
  const file = translationFile(projectRoot, code);
  const { packageIds, english } = await readInstalledEnglish(projectRoot);
  const existing = flattenCatalog(await readTranslationFile(file));
  const merged = {};
  let added = 0;
  let kept = 0;
  for (const [key, text] of Object.entries(english)) {
    if (Object.hasOwn(existing, key)) {
      merged[key] = existing[key];
      kept += 1;
    } else {
      merged[key] = text;
      added += 1;
    }
  }
  const extra = Object.keys(existing).filter((key) => !Object.hasOwn(english, key));
  for (const key of extra) merged[key] = existing[key];

  const contents = `${JSON.stringify(nestCatalog(merged, relativeFile(projectRoot, file)), null, 2)}\n`;
  const previous = await readFile(file, "utf8").catch(() => null);
  if (contents !== previous) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, contents, "utf8");
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return { locale: code, file, packageIds, added, kept, extra: extra.length, changed: contents !== previous };
}

function formatExportSummary(result, projectRoot = process.cwd()) {
  const name = relativeFile(projectRoot, result.file);
  const source = `${result.packageIds.length} JSKIT package(s): ${result.added} added, ${result.kept} kept, ${result.extra} extra.`;
  const lines = [result.changed ? `Wrote ${name} from ${source}` : `${name} is already up to date with ${source}`];
  if (result.extra > 0) {
    lines.push(`Extra keys are kept; jskit i18n check ${result.locale} lists them.`);
  }
  return lines.join("\n");
}

// --- check -------------------------------------------------------------------------

function describeParams(names) {
  return names.map((name) => `{${name}}`).join(", ");
}

function placeholderProblem(englishText, translation) {
  const englishChoices = parseMessage(englishText).length;
  const translatedChoices = parseMessage(translation).length;
  const problems = [];
  if (englishChoices !== translatedChoices) {
    problems.push(englishChoices > 1
      ? `${translatedChoices} plural choice(s), English has ${englishChoices}`
      : `${translatedChoices} plural choices, English has none (write a literal | as {'|'})`);
  }
  const expected = messageParams(englishText);
  const actual = messageParams(translation);
  const missing = expected.filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.includes(name));
  if (missing.length > 0) problems.push(`missing ${describeParams(missing)}`);
  if (unexpected.length > 0) problems.push(`unexpected ${describeParams(unexpected)}`);
  return problems.join("; ");
}

function hasWords(englishText) {
  return /\p{L}/u.test(parseMessage(englishText).flat().map((part) => part.text ?? "").join(""));
}

async function checkTranslations({ projectRoot = process.cwd(), locale } = {}) {
  const code = canonicalLocale(locale);
  const file = translationFile(projectRoot, code);
  const { packageIds, english } = await readInstalledEnglish(projectRoot);
  const document = await readTranslationFile(file);
  if (!document) {
    throw new Error(`${relativeFile(projectRoot, file)} does not exist; run jskit i18n export ${code} first.`);
  }
  const translations = flattenCatalog(document);
  const missing = [];
  const invalid = [];
  const mismatched = [];
  const untranslated = [];
  for (const [key, text] of Object.entries(english)) {
    if (!Object.hasOwn(translations, key)) {
      missing.push(key);
      continue;
    }
    const translation = translations[key];
    if (typeof translation !== "string") {
      invalid.push(`${key}: not a string`);
      continue;
    }
    let problem;
    try {
      problem = placeholderProblem(text, translation);
    } catch (error) {
      invalid.push(`${key}: ${error.message}`);
      continue;
    }
    if (problem) {
      mismatched.push(`${key}: ${problem}`);
    } else if (translation === text && hasWords(text)) {
      untranslated.push(key);
    }
  }
  const extra = Object.keys(translations).filter((key) => !Object.hasOwn(english, key));
  return {
    locale: code,
    file,
    packageIds,
    total: Object.keys(english).length,
    missing,
    invalid,
    mismatched,
    extra,
    untranslated,
    ok: missing.length === 0 && invalid.length === 0 && mismatched.length === 0
  };
}

function formatCheckReport(result, projectRoot = process.cwd()) {
  const groups = [
    ["Missing keys", result.missing],
    ["Invalid messages", result.invalid],
    ["Placeholder mismatches", result.mismatched],
    ["Extra keys (not used by the installed packages)", result.extra],
    ["Untranslated, same as English (warning)", result.untranslated]
  ];
  const lines = [];
  for (const [title, entries] of groups) {
    if (entries.length < 1) continue;
    lines.push(`${title} (${entries.length}):`, ...entries.map((entry) => `  ${entry}`));
  }
  const name = relativeFile(projectRoot, result.file);
  const scope = `the English of ${result.packageIds.length} JSKIT package(s), ${result.total} message(s)`;
  lines.push(result.ok
    ? `${name} covers ${scope}.`
    : `${name} does not match ${scope}.`);
  return lines.join("\n");
}

export {
  canonicalLocale,
  checkTranslations,
  collectInstalledCatalogs,
  exportTranslations,
  formatCheckReport,
  formatExportSummary,
  messageParams,
  parseMessage
};
