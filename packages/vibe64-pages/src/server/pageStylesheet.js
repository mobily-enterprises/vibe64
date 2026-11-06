// The optional Vibe64 stylesheet a page links as `_vibe64/page.css`: Vibe64's
// colours as custom properties, its font, light and dark modes, and plain
// element styles, so a page that links it looks native without effort. A
// viewer's link knows its Vibe64 theme; without one the device setting decides.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const THEME_COLOURS = Object.freeze({
  light: Object.freeze({
    "color-scheme": "light",
    "--v64-background": "#ffffff",
    "--v64-surface": "#ffffff",
    "--v64-surface-container": "color-mix(in srgb, #1867c0 5%, #ffffff)",
    "--v64-surface-variant": "#eef3fa",
    "--v64-on-surface": "rgba(0, 0, 0, 0.87)",
    "--v64-on-surface-muted": "rgba(0, 0, 0, 0.6)",
    "--v64-on-surface-variant": "#1f2937",
    "--v64-outline": "rgba(0, 0, 0, 0.12)",
    "--v64-primary": "#1867c0",
    "--v64-on-primary": "#ffffff",
    "--v64-secondary": "#48a9a6",
    "--v64-error": "#b00020",
    "--v64-info": "#2196f3",
    "--v64-success": "#2e7d32",
    "--v64-warning": "#725c0c",
    "--v64-warning-container": "#f5f0e3",
    "--v64-code": "#f5f5f5"
  }),
  dark: Object.freeze({
    "color-scheme": "dark",
    "--v64-background": "#111318",
    "--v64-surface": "#1a1c21",
    "--v64-surface-container": "color-mix(in srgb, #2196f3 5%, #1a1c21)",
    "--v64-surface-variant": "#243342",
    "--v64-on-surface": "#ffffff",
    "--v64-on-surface-muted": "rgba(255, 255, 255, 0.7)",
    "--v64-on-surface-variant": "#edf4fc",
    "--v64-outline": "rgba(255, 255, 255, 0.12)",
    "--v64-primary": "#2196f3",
    "--v64-on-primary": "#ffffff",
    "--v64-secondary": "#54b6b2",
    "--v64-error": "#cf6679",
    "--v64-info": "#2196f3",
    "--v64-success": "#7ddc7a",
    "--v64-warning": "#dfc477",
    "--v64-warning-container": "#353126",
    "--v64-code": "#343434"
  })
});

const BASE_STYLES = `
:root {
  --v64-font-family: "Roboto", system-ui, -apple-system, "Segoe UI", sans-serif;
  --v64-mono-font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --v64-shape-sm: 8px;
  --v64-shape-md: 12px;
  --v64-space-1: 4px;
  --v64-space-2: 8px;
  --v64-space-3: 12px;
  --v64-space-4: 16px;
  --v64-space-5: 24px;
}
@font-face {
  font-family: "Roboto";
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url("roboto.woff2") format("woff2-variations");
}
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--v64-background); color: var(--v64-on-surface); }
body { margin: 0; padding: var(--v64-space-5); font: 400 0.875rem/1.45 var(--v64-font-family); background: var(--v64-background); color: var(--v64-on-surface); }
h1, h2, h3, h4 { font-weight: 600; line-height: 1.25; margin: 0 0 var(--v64-space-3); }
h1 { font-size: 1.5rem; }
h2 { font-size: 1.25rem; }
h3 { font-size: 1rem; }
p { margin: 0 0 var(--v64-space-3); }
a { color: var(--v64-primary); }
code, pre, kbd { font-family: var(--v64-mono-font-family); font-size: 0.8125rem; background: var(--v64-code); border-radius: 4px; }
code, kbd { padding: 0.1em 0.35em; }
pre { padding: var(--v64-space-3); overflow: auto; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 var(--v64-space-4); }
th, td { text-align: left; padding: var(--v64-space-2) var(--v64-space-3); border-bottom: 1px solid var(--v64-outline); vertical-align: top; }
th { font-weight: 600; color: var(--v64-on-surface-muted); }
hr { border: 0; border-top: 1px solid var(--v64-outline); margin: var(--v64-space-4) 0; }
.v64-muted { color: var(--v64-on-surface-muted); }
.v64-card { background: var(--v64-surface-container); border: 1px solid var(--v64-outline); border-radius: var(--v64-shape-md); padding: var(--v64-space-4); }
.v64-grid { display: grid; gap: var(--v64-space-4); grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); margin: 0 0 var(--v64-space-4); }
.v64-stat { font-size: 1.75rem; font-weight: 600; line-height: 1.2; }
.v64-badge { display: inline-block; padding: 0.1em 0.6em; border-radius: 999px; font-size: 0.75rem; font-weight: 500; background: var(--v64-surface-variant); color: var(--v64-on-surface-variant); }
.v64-badge--success { background: color-mix(in srgb, var(--v64-success) 18%, transparent); color: var(--v64-success); }
.v64-badge--warning { background: var(--v64-warning-container); color: var(--v64-warning); }
.v64-badge--error { background: color-mix(in srgb, var(--v64-error) 16%, transparent); color: var(--v64-error); }
`;

function declarations(colours) {
  return Object.entries(colours).map(([name, value]) => `  ${name}: ${value};`).join("\n");
}

/**
 * The stylesheet for a viewer's Vibe64 theme, or for the device setting.
 * @param {"light" | "dark" | ""} theme
 */
function pageStylesheet(theme) {
  const themed = theme
    ? `:root {\n${declarations(THEME_COLOURS[theme])}\n}\n`
    : `:root {\n${declarations(THEME_COLOURS.light)}\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${declarations(THEME_COLOURS.dark)}\n  }\n}\n`;
  return `/* Vibe64 page stylesheet */\n${themed}${BASE_STYLES}`;
}

/**
 * Reads Vibe64's own font file, the variable Roboto the app uses, once.
 * @returns {() => Promise<Buffer>}
 */
function createPageFont() {
  let file = null;
  return () => {
    file ||= readFile(fileURLToPath(import.meta.resolve("@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2")));
    return file;
  };
}

export { createPageFont, pageStylesheet };
