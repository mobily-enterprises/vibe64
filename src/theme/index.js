import extensions from "./extensions.js";
import { icons } from "./icons.js";

// Vibe64's only theme facts. JSKIT's material-web generates the light and dark Material 3 schemes from the seed,
// with every colour role; Vuetify's default blue stays the seed, so Vibe64 keeps its blue. The Learning accent is
// the warm yellow of the Learning L, a custom colour with its four roles that keeps its golden hue (blend: false)
// instead of moving toward the blue seed. The subsystem colour is the teal of Architecture's subsystem map, which
// likewise keeps its hue so subsystems stay apart from the blue pages beside them. An app composed from Vibe64 adds
// its own colours and icons in extensions.js.
export const theme = {
  seed: "#1867C0",
  // Vibe64's own typeface for both Material 3 typefaces, self-hosted by src/styles/vibe64-font.css.
  typography: {
    brand: '"Roboto", sans-serif',
    plain: '"Roboto", sans-serif'
  },
  colors: {
    learning: { value: "#F5C518", blend: false },
    subsystem: { value: "#367E70", blend: false },
    ...extensions.colors
  },
  icons: {
    ...icons,
    ...extensions.icons
  }
};
