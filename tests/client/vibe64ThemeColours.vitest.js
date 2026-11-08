import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createVuetify } from "vuetify";
import { describe, expect, it } from "vitest";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { theme as vibe64Theme } from "../../src/theme/index.js";

const STYLED_SOURCE = /\.(?:css|js|ts|vue)$/u;
const THEME_VARIABLE = /--v-theme-[a-z0-9-]+/gu;
// A Vibe64 token read without a fallback, and one declared (in CSS or a style binding).
const TOKEN_READ = /var\((--v64-[a-z0-9-]+)\)/gu;
const TOKEN_DECLARED = /(--v64-[a-z0-9-]+)["']?\s*:/gu;
// A quoted `$name` in a client source: an icon alias, unless it is one of Vue's own instance properties.
const ICON_ALIAS = /["']\$([a-z][A-Za-z0-9]*)["']/gu;
const VUE_INSTANCE_PROPERTIES = new Set(["attrs", "el", "emit", "event", "props", "refs", "route", "router", "slots", "vuetify"]);

// Every --v-theme-* variable Vuetify declares for Vibe64's theme: the Material 3
// roles JSKIT generates from the seed, the Learning colour's roles, the on-*
// colours and overlay multipliers Vuetify adds, and its own theme variables. The
// browser ignores a declaration that names any other.
function declaredThemeVariables() {
  const { theme } = createVuetify(createMaterialVuetifyOptions(vibe64Theme));
  return new Set(theme.styles.value.match(/--v-theme-[a-z0-9-]+(?=:)/gu));
}

function styledSources({ clientOnly = false } = {}) {
  const packageSources = readdirSync(path.resolve("packages"))
    .map((name) => path.resolve("packages", name, clientOnly ? "src/client" : "src"))
    .filter((root) => existsSync(root));
  return [path.resolve("src"), ...packageSources].flatMap((root) => readdirSync(root, {
    recursive: true,
    withFileTypes: true
  })
    .filter((entry) => entry.isFile() && STYLED_SOURCE.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name)));
}

describe("Vibe64 theme colours", () => {
  it("derives the declared names from the generated Material 3 scheme and Vibe64's Learning colour", () => {
    const declared = declaredThemeVariables();

    expect(declared).toContain("--v-theme-on-surface");
    expect(declared).toContain("--v-theme-warning-container");
    expect(declared).toContain("--v-theme-surface-container-low");
    expect(declared).toContain("--v-theme-outline-variant");
    expect(declared).toContain("--v-theme-learning-container");
    expect(declared).not.toContain("--v-theme-learning-variant");
  });

  it("names only theme colours Vuetify declares, so every one renders", () => {
    const declared = declaredThemeVariables();
    const undeclared = styledSources().flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
      [...line.matchAll(THEME_VARIABLE)]
        .filter(([name]) => !declared.has(name))
        .map(([name]) => `${path.relative(process.cwd(), file)}:${index + 1}: ${name}`)));

    expect(undeclared, "Use a colour role the generated theme declares").toEqual([]);
  });

  it("reads only Vibe64 tokens some stylesheet declares, or gives a fallback", () => {
    const sources = styledSources({ clientOnly: true }).map((file) => [file, readFileSync(file, "utf8")]);
    const declared = new Set(sources.flatMap(([, source]) => [...source.matchAll(TOKEN_DECLARED)].map(([, name]) => name)));
    const undeclared = sources.flatMap(([file, source]) => source.split("\n").flatMap((line, index) =>
      [...line.matchAll(TOKEN_READ)]
        .filter(([, name]) => !declared.has(name))
        .map(([, name]) => `${path.relative(process.cwd(), file)}:${index + 1}: ${name}`)));

    expect(undeclared, "An undeclared token makes the property invalid, so the colour falls back to inherited").toEqual([]);
  });
});

describe("Vibe64 theme icons", () => {
  it("names only icon aliases the theme registers, so every icon draws", () => {
    const aliases = createMaterialVuetifyOptions(vibe64Theme).icons.aliases;
    const unknown = styledSources({ clientOnly: true }).flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
      [...line.matchAll(ICON_ALIAS)]
        .filter(([, name]) => !VUE_INSTANCE_PROPERTIES.has(name) && !Object.hasOwn(aliases, name))
        .map(([, name]) => `${path.relative(process.cwd(), file)}:${index + 1}: $${name}`)));

    expect(aliases).toHaveProperty("crown");
    expect(unknown, "Add the glyph to src/theme/icons.js").toEqual([]);
  });
});
