// Click in Preview: the component a picked element belongs to, the usage
// entry it opens, and the colours of the pick highlight.

import { hasWindowFunction } from "@/lib/browser.js";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";

const PREVIEW_PICK_NO_COMPONENT_TEXT = "No component information on this page. Record while clicking to see its requests.";

const PREVIEW_PICK_NOT_SCANNED_TEXT = "This project has not been scanned yet. Refresh the architecture scan in Usage, then pick again.";

// A component file as the Preview's dev build names it, as a path inside the
// session source; "" when it names a place outside that source.
function previewComponentSourcePath(file = "", sourceRoot = "") {
  const relative = String(sourceEditorLinkTarget({ href: String(file || ""), sourceRoot })?.path || "");
  return relative.split("/").every((part) => part && part !== "." && part !== "..") ? relative : "";
}

// The editor's primary colour and the colour on it, as the element's theme
// declares them (Vuetify's "r,g,b" role channels), for the Preview's Pick
// highlight: { color, onColor } as #rrggbb, else {}.
function previewPickColors(element) {
  const style = element && hasWindowFunction("getComputedStyle") ? window.getComputedStyle(element) : null;
  const hex = (name) => {
    const channels = String(style?.getPropertyValue(name) || "").match(/^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/u)
      ?.slice(1).map(Number);
    return channels?.every((channel) => channel <= 255)
      ? `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
      : "";
  };
  const color = hex("--v-theme-primary");
  const onColor = hex("--v-theme-on-primary");
  return color && onColor ? { color, onColor } : {};
}

// The usage entry a picked component starts from: a component, else a page,
// entry for exactly that file.
function previewUsageEntryForFile(entries = [], file = "") {
  const matches = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.id && entry.file === file);
  return matches.find((entry) => entry.kind === "component") || matches.find((entry) => entry.kind === "page") || null;
}

export {
  PREVIEW_PICK_NO_COMPONENT_TEXT,
  PREVIEW_PICK_NOT_SCANNED_TEXT,
  previewComponentSourcePath,
  previewPickColors,
  previewUsageEntryForFile
};
