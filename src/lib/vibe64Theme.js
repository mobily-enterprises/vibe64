// Vibe64's colours on top of Vuetify's light and dark themes. Vuetify adds its
// defaults and an on-* colour for each colour without one; components use only
// the names it declares, or the Material 3 roles in vibe64-m3.css built on them.
const vibe64Themes = {
  light: {
    colors: {
      "surface-variant": "#EEF3FA",
      "on-surface-variant": "#1F2937",
      // A darker green keeps white text on success messages readable.
      success: "#2E7D32",
      warning: "#725C0C",
      "on-warning": "#FFFFFF",
      "warning-container": "#F5F0E3",
      "on-warning-container": "#252117"
    }
  },
  dark: {
    colors: {
      // Material 3 dark surfaces: a cool near-black background with a
      // slightly lighter surface so containers read as tonal tiers.
      background: "#111318",
      surface: "#1A1C21",
      "surface-bright": "#37393F",
      "surface-light": "#2A2D33",
      "surface-variant": "#243342",
      "on-surface-variant": "#EDF4FC",
      // Material 3 dark-scheme green: readable as text on dark and tonal
      // surfaces, with dark text when filled.
      success: "#7DDC7A",
      "on-success": "#00390A",
      warning: "#DFC477",
      "on-warning": "#3D2F00",
      "warning-container": "#353126",
      "on-warning-container": "#EAE1CF"
    }
  }
};

export { vibe64Themes };
