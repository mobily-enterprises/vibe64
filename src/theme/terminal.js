import { materialThemes } from "@jskit-ai/material-web/client";
import { theme } from "./index.js";

// The terminal is a dark console in either appearance: it draws with the dark scheme's surface and on-surface.
const dark = materialThemes(theme.seed, theme.colors).dark.colors;

export const terminalColours = Object.freeze({
  background: dark.surface,
  foreground: dark["on-surface"]
});
