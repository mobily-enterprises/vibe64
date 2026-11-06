// The Vibe64 stylesheet a page links as `_vibe64/page.css`: Vibe64's colours
// as custom properties (with status colours and their tints), its font, light
// and dark modes, good-looking plain elements, and a small set of components
// (header, summary tiles, sections, cards, pills, tags, callouts, progress
// bars, tables, charts) that the page design guide shows the AI how to use. A
// viewer's link knows its Vibe64 theme; without one the device setting decides.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Status colours come in pairs: the text colour and the soft tint behind it.
const STATUS_COLOURS = Object.freeze({
  light: Object.freeze({
    done: ["#23774a", "#dcf0e3"],
    running: ["#1f6fb2", "#dcebf7"],
    waiting: ["#5c6b7a", "#e6ebf0"],
    attention: ["#a8480f", "#fbe7d6"],
    error: ["#b42318", "#fde4e1"],
    later: ["#6a5a8c", "#ebe6f4"],
    neutral: ["#4a5560", "#eef1f4"]
  }),
  dark: Object.freeze({
    done: ["#86d3a6", "#1c3a2a"],
    running: ["#8cc4f0", "#1c3347"],
    waiting: ["#a7b4c0", "#2a333d"],
    attention: ["#f4b083", "#43291a"],
    error: ["#f5a3a3", "#45201f"],
    later: ["#bcaede", "#2f2942"],
    neutral: ["#c3ccd5", "#2a3038"]
  })
});

function statusColours(theme) {
  return Object.fromEntries(Object.entries(STATUS_COLOURS[theme]).flatMap(([status, [text, tint]]) => [
    [`--v64-${status}`, text],
    [`--v64-${status}-tint`, tint]
  ]));
}

const THEME_COLOURS = Object.freeze({
  light: Object.freeze({
    "color-scheme": "light",
    "--v64-background": "#f3f5f7",
    "--v64-surface": "#ffffff",
    "--v64-surface-container": "color-mix(in srgb, #1867c0 5%, #ffffff)",
    "--v64-surface-variant": "#eef3fa",
    "--v64-on-surface": "#18222d",
    "--v64-on-surface-muted": "#5a6876",
    "--v64-on-surface-variant": "#1f2937",
    "--v64-outline": "#d9e0e6",
    "--v64-track": "#e4e9ee",
    "--v64-primary": "#1867c0",
    "--v64-on-primary": "#ffffff",
    "--v64-secondary": "#48a9a6",
    "--v64-info": "#2196f3",
    "--v64-success": "#2e7d32",
    "--v64-warning": "#725c0c",
    "--v64-warning-container": "#f5f0e3",
    "--v64-code": "#eef1f4",
    ...statusColours("light")
  }),
  dark: Object.freeze({
    "color-scheme": "dark",
    "--v64-background": "#111318",
    "--v64-surface": "#1a1c21",
    "--v64-surface-container": "color-mix(in srgb, #2196f3 5%, #1a1c21)",
    "--v64-surface-variant": "#243342",
    "--v64-on-surface": "#e6ebf0",
    "--v64-on-surface-muted": "#9aa8b5",
    "--v64-on-surface-variant": "#edf4fc",
    "--v64-outline": "#2c3743",
    "--v64-track": "#2c3743",
    "--v64-primary": "#2196f3",
    "--v64-on-primary": "#ffffff",
    "--v64-secondary": "#54b6b2",
    "--v64-info": "#2196f3",
    "--v64-success": "#7ddc7a",
    "--v64-warning": "#dfc477",
    "--v64-warning-container": "#353126",
    "--v64-code": "#2a3038",
    ...statusColours("dark")
  })
});

const STATUSES = Object.keys(STATUS_COLOURS.light);

// One status rule per status for each component that takes one.
const STATUS_STYLES = STATUSES.map((status) => [
  `.v64-pill--${status}, .v64-tile--${status} { background: var(--v64-${status}-tint); color: var(--v64-${status}); }`,
  `.v64-callout--${status} { background: var(--v64-${status}-tint); border-left-color: var(--v64-${status}); }`,
  `.v64-progress--${status} > i { background: var(--v64-${status}); }`
].join("\n")).join("\n");

const BASE_STYLES = `
:root {
  --v64-font-family: "Roboto", system-ui, -apple-system, "Segoe UI", sans-serif;
  --v64-mono-font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --v64-radius: 10px;
}
@font-face {
  font-family: "Roboto";
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url("roboto.woff2") format("woff2-variations");
}

/* The page: one readable column on a soft background, with a 16px gutter on phones. */
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--v64-background); color: var(--v64-on-surface); }
body {
  max-width: 880px;
  margin: 0 auto;
  padding: 28px max(16px, env(safe-area-inset-right)) 56px max(16px, env(safe-area-inset-left));
  font: 400 15px/1.5 var(--v64-font-family);
  background: var(--v64-background);
  color: var(--v64-on-surface);
  overflow-wrap: anywhere;
}
body.v64-wide { max-width: 1200px; }
img, svg, video { max-width: 100%; height: auto; }

/* Type: bold titles, muted secondary text, small uppercase section labels. */
h1, h2, h3, h4 { line-height: 1.25; margin: 0 0 8px; text-wrap: balance; }
h1 { font-size: 26px; font-weight: 700; }
h2 { font-size: 18px; font-weight: 700; margin-top: 28px; }
h3 { font-size: 15px; font-weight: 700; }
p { margin: 0 0 12px; }
a { color: var(--v64-primary); }
ul, ol { margin: 0 0 12px; padding-left: 20px; }
li + li { margin-top: 4px; }
li > ul, li > ol { margin: 4px 0 0; }
li li + li { margin-top: 2px; }
code, pre, kbd { font-family: var(--v64-mono-font-family); font-size: 13px; background: var(--v64-code); border-radius: 4px; }
code, kbd { padding: 0.1em 0.35em; }
pre { padding: 12px 14px; overflow: auto; border-radius: 8px; }
pre code { background: none; padding: 0; }
hr { border: 0; border-top: 1px solid var(--v64-outline); margin: 24px 0; }
.v64-muted { color: var(--v64-on-surface-muted); }
.v64-num { font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Header: the title and its "Updated" line. */
.v64-header { margin: 0 0 24px; }
.v64-header h1 { margin: 0 0 4px; }
.v64-subtitle { margin: 0; color: var(--v64-on-surface-muted); font-size: 13px; }

/* Summary tiles: the answer first, one tinted tile per count. */
.v64-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(8.5rem, 100%), 1fr)); gap: 10px; margin: 0 0 28px; padding: 0; list-style: none; }
.v64-tiles > li + li { margin-top: 0; }
.v64-tile { padding: 12px 14px; border-radius: var(--v64-radius); background: var(--v64-surface); border: 1px solid var(--v64-outline); }
.v64-tile[class*="v64-tile--"] { border-color: transparent; }
.v64-tile b, .v64-tile strong { display: block; font-size: 28px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.v64-tile span { font-size: 13px; }

/* Sections: a small uppercase label with its summary on the right. */
.v64-section { margin: 0 0 28px; }
.v64-section-title { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 2px 12px; margin: 0 0 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--v64-on-surface-muted); }
.v64-section-title > span { letter-spacing: 0; text-transform: none; font-weight: 400; font-variant-numeric: tabular-nums; }

/* Cards: white, softly bordered and roomy; a card list shares one border. */
.v64-card { margin: 0 0 12px; padding: 14px 16px; background: var(--v64-surface); border: 1px solid var(--v64-outline); border-radius: var(--v64-radius); }
.v64-card > :last-child, .v64-cards > * > :last-child { margin-bottom: 0; }
.v64-cards { margin: 0 0 12px; padding: 0; list-style: none; background: var(--v64-surface); border: 1px solid var(--v64-outline); border-radius: var(--v64-radius); }
.v64-cards > * { margin: 0; padding: 12px 16px; }
.v64-cards > * + * { margin: 0; border-top: 1px solid var(--v64-outline); }
.v64-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.v64-card-title { margin: 0; font-size: 15px; font-weight: 700; }
.v64-card-head > .v64-pill { margin-left: auto; }
.v64-card-head > .v64-pill ~ .v64-pill { margin-left: 0; }
.v64-card-meta { margin: 4px 0 0; color: var(--v64-on-surface-muted); font-size: 13.5px; }
.v64-card ul, .v64-cards ul { margin: 6px 0 0; list-style: disc; color: var(--v64-on-surface-muted); font-size: 13.5px; }
.v64-card ul b, .v64-cards ul b { color: var(--v64-on-surface); font-weight: 600; }
.v64-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr)); gap: 12px; margin: 0 0 16px; }
.v64-grid > .v64-card { margin: 0; }

/* Status pills, outlined tags and the done tick. */
.v64-pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; line-height: 1.5; white-space: nowrap; background: var(--v64-neutral-tint); color: var(--v64-neutral); }
.v64-tag { display: inline-block; padding: 0 6px; border: 1px solid var(--v64-outline); border-radius: 4px; font-size: 11.5px; line-height: 1.6; color: var(--v64-on-surface-muted); white-space: nowrap; }
.v64-tick { color: var(--v64-done); font-weight: 700; }

/* Callouts and progress bars. */
.v64-callout { margin: 0 0 16px; padding: 12px 14px; border-radius: var(--v64-radius); border-left: 4px solid var(--v64-running); background: var(--v64-running-tint); }
.v64-callout > :last-child { margin-bottom: 0; }
.v64-progress { height: 6px; border-radius: 3px; background: var(--v64-track); overflow: hidden; }
.v64-progress > i { display: block; height: 100%; background: var(--v64-primary); }

/* Tables: a rounded panel with quiet headings; numbers line up. */
table { width: 100%; margin: 0 0 16px; border-collapse: separate; border-spacing: 0; background: var(--v64-surface); border: 1px solid var(--v64-outline); border-radius: var(--v64-radius); font-variant-numeric: tabular-nums; }
th, td { padding: 10px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--v64-outline); }
tr:last-child > td { border-bottom: 0; }
th { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--v64-on-surface-muted); }
th.v64-num, td.v64-num { text-align: right; }
.v64-scroll { overflow-x: auto; margin: 0 0 16px; }
.v64-scroll > table { margin: 0; }

/* Charts: inline SVG at its own size, shrinking to fit a phone; its text follows the page. */
.v64-chart { display: block; max-width: 100%; height: auto; margin: 0 0 16px; color: var(--v64-on-surface-muted); }
.v64-chart text { fill: currentColor; font: 13px var(--v64-font-family); }

${STATUS_STYLES}
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
 * Reads the page design guide the agent command prints, once: how to build a
 * page from this stylesheet's components.
 * @returns {() => Promise<string>}
 */
function createPageDesignGuide() {
  let text = null;
  return () => {
    text ||= readFile(new URL("./pageDesignGuide.md", import.meta.url), "utf8");
    return text;
  };
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

export { createPageDesignGuide, createPageFont, pageStylesheet };
