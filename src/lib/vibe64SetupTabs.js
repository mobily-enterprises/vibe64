const STUDIO_SETUP_TAB = Object.freeze({
  label: "Studio Setup",
  value: "studio-setup"
});

const PROJECT_SETUP_TAB = Object.freeze({
  label: "Project Setup",
  value: "project-setup"
});

function setupTabs({
  studioSetupEnabled = true
} = {}) {
  return studioSetupEnabled === false
    ? [PROJECT_SETUP_TAB]
    : [STUDIO_SETUP_TAB, PROJECT_SETUP_TAB];
}

function setupTabValues(options = {}) {
  return new Set(setupTabs(options).map((tab) => tab.value));
}

function normalizeSetupTab(value, options = {}) {
  const normalized = String(value || "").trim();
  return setupTabValues(options).has(normalized) ? normalized : "";
}

function fallbackSetupTab(options = {}) {
  return setupTabs(options)[0]?.value || PROJECT_SETUP_TAB.value;
}

export {
  PROJECT_SETUP_TAB,
  STUDIO_SETUP_TAB,
  fallbackSetupTab,
  normalizeSetupTab,
  setupTabs
};
