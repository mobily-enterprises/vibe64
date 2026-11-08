import extensions from "./extensions.js";
import { icons } from "./icons.js";

// Vibe64's only theme facts. JSKIT's material-web generates the light and dark Material 3 schemes from the seed,
// with every colour role; Vuetify's default blue stays the seed, so Vibe64 keeps its blue. The Learning accent is
// the warm yellow of the Learning L, a custom colour with its four roles. An app composed from Vibe64 adds its own
// colours and icons in extensions.js.
export const theme = {
  seed: "#1867C0",
  // Vibe64's own typeface for both Material 3 typefaces, self-hosted by src/styles/vibe64-font.css.
  typography: {
    brand: '"Roboto", sans-serif',
    plain: '"Roboto", sans-serif'
  },
  colors: {
    learning: "#F5C518",
    ...extensions.colors
  },
  icons: {
    ...icons,
    ...extensions.icons
  }
};
