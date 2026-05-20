import {
  configOptionValues,
  defaultConfigFromFields,
  selectedConfigValue
} from "../../configValues.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG
} from "./constants.js";

const GENERIC_NODE_WEB_CLIENT_LIBRARY_OPTIONS = deepFreeze([
  {
    description: "Let Studio inspect package metadata and source files before deciding what prompt guidance to use.",
    label: "Auto-detect",
    value: "auto"
  },
  {
    description: "Use React-oriented prompt guidance for components, hooks, and app structure.",
    label: "React",
    value: "react"
  },
  {
    description: "Use Vue-oriented prompt guidance for components, composables, and app structure.",
    label: "Vue",
    value: "vue"
  },
  {
    description: "Use Svelte-oriented prompt guidance for components and app structure.",
    label: "Svelte",
    value: "svelte"
  },
  {
    description: "Use Lit-oriented prompt guidance for web components.",
    label: "Lit",
    value: "lit"
  },
  {
    description: "Use Preact-oriented prompt guidance for lightweight React-compatible projects.",
    label: "Preact",
    value: "preact"
  },
  {
    description: "Use Solid-oriented prompt guidance for signals and Solid components.",
    label: "Solid",
    value: "solid"
  },
  {
    description: "Use Angular-oriented prompt guidance for modules, services, and components.",
    label: "Angular",
    value: "angular"
  },
  {
    description: "Use framework-neutral Node/web guidance.",
    label: "None or unknown",
    value: "none"
  }
]);

const GENERIC_NODE_WEB_CLIENT_LIBRARY_VALUES = configOptionValues(GENERIC_NODE_WEB_CLIENT_LIBRARY_OPTIONS);

const GENERIC_NODE_WEB_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: "auto",
    description: "Client-side UI library used in generic prompts. Auto-detect uses package metadata and common project files.",
    id: GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG,
    label: "Client library",
    options: GENERIC_NODE_WEB_CLIENT_LIBRARY_OPTIONS,
    type: "select"
  }
]);

const GENERIC_NODE_WEB_DEFAULT_CONFIG = deepFreeze(defaultConfigFromFields(GENERIC_NODE_WEB_CONFIG_FIELDS));

function selectedGenericNodeWebClientLibrary(config = {}) {
  return selectedConfigValue(
    config,
    GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG,
    GENERIC_NODE_WEB_CLIENT_LIBRARY_VALUES,
    "auto"
  );
}

export {
  GENERIC_NODE_WEB_CONFIG_FIELDS,
  GENERIC_NODE_WEB_DEFAULT_CONFIG,
  selectedGenericNodeWebClientLibrary
};
