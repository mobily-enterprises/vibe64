import {
  configOptionValues,
  configTextValue,
  defaultConfigFromFields,
  selectedConfigValue
} from "../../configValues.js";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  DEFAULT_NODE_PACKAGE_MANAGER,
  NODE_PACKAGE_MANAGER_OPTIONS,
  nodePackageManagerValueSet
} from "../../nodePackageManagers.js";
import {
  NEXTJS_DATABASE_RUNTIME_CONFIG,
  NEXTJS_DATA_LAYER_CONFIG,
  NEXTJS_PACKAGE_MANAGER_CONFIG,
  NEXTJS_SEED_BUNDLER_CONFIG,
  NEXTJS_SEED_IMPORT_ALIAS_CONFIG,
  NEXTJS_SEED_LANGUAGE_CONFIG,
  NEXTJS_SEED_LINTER_CONFIG,
  NEXTJS_SEED_SOURCE_LAYOUT_CONFIG,
  NEXTJS_SEED_STYLING_CONFIG
} from "./constants.js";

const NEXTJS_PACKAGE_MANAGER_OPTIONS = NODE_PACKAGE_MANAGER_OPTIONS;
const NEXTJS_SEED_LANGUAGE_OPTIONS = deepFreeze([
  {
    description: "Seed TypeScript files and prompt Codex to preserve typed code.",
    label: "TypeScript",
    value: "typescript"
  },
  {
    description: "Seed JavaScript files for projects that do not want TypeScript.",
    label: "JavaScript",
    value: "javascript"
  }
]);
const NEXTJS_SEED_STYLING_OPTIONS = deepFreeze([
  {
    description: "Include Tailwind CSS when Studio seeds a new Next.js app.",
    label: "Tailwind CSS",
    value: "tailwind"
  },
  {
    description: "Do not add a styling framework during seeding.",
    label: "None",
    value: "none"
  }
]);
const NEXTJS_SEED_LINTER_OPTIONS = deepFreeze([
  {
    description: "Include ESLint when Studio seeds a new Next.js app.",
    label: "ESLint",
    value: "eslint"
  },
  {
    description: "Include Biome instead of ESLint for formatting and linting.",
    label: "Biome",
    value: "biome"
  },
  {
    description: "Do not add a linter during seeding.",
    label: "None",
    value: "none"
  }
]);
const NEXTJS_SEED_SOURCE_LAYOUT_OPTIONS = deepFreeze([
  {
    description: "Put app source under a src directory.",
    label: "src/app",
    value: "src"
  },
  {
    description: "Put the app directory at the project root.",
    label: "app at root",
    value: "root"
  }
]);
const NEXTJS_SEED_BUNDLER_OPTIONS = deepFreeze([
  {
    description: "Use Turbopack for local Next.js development when seeded.",
    label: "Turbopack",
    value: "turbopack"
  },
  {
    description: "Use the Webpack bundler path for projects that prefer the older default.",
    label: "Webpack",
    value: "webpack"
  }
]);
const NEXTJS_DATA_LAYER_OPTIONS = deepFreeze([
  {
    description: "Do not assume a database access library in prompts.",
    label: "None",
    value: "none"
  },
  {
    description: "Use Prisma conventions when Codex plans and edits data access.",
    label: "Prisma",
    value: "prisma"
  },
  {
    description: "Use Drizzle conventions when Codex plans and edits data access.",
    label: "Drizzle",
    value: "drizzle"
  }
]);
const NEXTJS_PACKAGE_MANAGERS = nodePackageManagerValueSet();
const NEXTJS_DATA_LAYERS = configOptionValues(NEXTJS_DATA_LAYER_OPTIONS);
const NEXTJS_SEED_BUNDLERS = configOptionValues(NEXTJS_SEED_BUNDLER_OPTIONS);
const NEXTJS_SEED_LANGUAGES = configOptionValues(NEXTJS_SEED_LANGUAGE_OPTIONS);
const NEXTJS_SEED_LINTERS = configOptionValues(NEXTJS_SEED_LINTER_OPTIONS);
const NEXTJS_SEED_SOURCE_LAYOUTS = configOptionValues(NEXTJS_SEED_SOURCE_LAYOUT_OPTIONS);
const NEXTJS_SEED_STYLING_VALUES = configOptionValues(NEXTJS_SEED_STYLING_OPTIONS);

const NEXTJS_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: DEFAULT_NODE_PACKAGE_MANAGER,
    description: "Package manager to use when Studio seeds a new Next.js app.",
    id: NEXTJS_PACKAGE_MANAGER_CONFIG,
    label: "Seed package manager",
    options: NEXTJS_PACKAGE_MANAGER_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "typescript",
    description: "Language mode used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_LANGUAGE_CONFIG,
    label: "Seed language",
    options: NEXTJS_SEED_LANGUAGE_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "tailwind",
    description: "Styling scaffold used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_STYLING_CONFIG,
    label: "Seed styling",
    options: NEXTJS_SEED_STYLING_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "eslint",
    description: "Linter scaffold used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_LINTER_CONFIG,
    label: "Seed linter",
    options: NEXTJS_SEED_LINTER_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "src",
    description: "Project source layout used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_SOURCE_LAYOUT_CONFIG,
    label: "Seed source layout",
    options: NEXTJS_SEED_SOURCE_LAYOUT_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "turbopack",
    description: "Bundler preference used when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_BUNDLER_CONFIG,
    label: "Seed bundler",
    options: NEXTJS_SEED_BUNDLER_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "@/*",
    description: "Import alias passed to create-next-app when Studio seeds a new Next.js app.",
    id: NEXTJS_SEED_IMPORT_ALIAS_CONFIG,
    label: "Seed import alias",
    type: "string"
  },
  {
    defaultValue: "postgres",
    description: "Optional Vibe64-managed database runtime for local setup, target scripts, and launch targets.",
    id: NEXTJS_DATABASE_RUNTIME_CONFIG,
    label: "Database runtime",
    options: [
      {
        description: "Do not start a managed database service for this target.",
        label: "None",
        value: "none"
      },
      {
        description: "Use a managed PostgreSQL service on the Studio runtime network.",
        label: "PostgreSQL",
        value: "postgres"
      },
      {
        description: "Use a managed MariaDB service on the Studio runtime network.",
        label: "MariaDB",
        value: "mariadb"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "prisma",
    description: "Application data-access convention included in Next.js prompts.",
    id: NEXTJS_DATA_LAYER_CONFIG,
    label: "Data layer",
    options: NEXTJS_DATA_LAYER_OPTIONS,
    type: "select"
  }
]);

const NEXTJS_DEFAULT_CONFIG = deepFreeze(defaultConfigFromFields(NEXTJS_CONFIG_FIELDS));

function selectedNextjsPackageManager(config = {}) {
  return selectedConfigValue(config, NEXTJS_PACKAGE_MANAGER_CONFIG, NEXTJS_PACKAGE_MANAGERS, DEFAULT_NODE_PACKAGE_MANAGER);
}

function selectedNextjsDataLayer(config = {}) {
  return selectedConfigValue(config, NEXTJS_DATA_LAYER_CONFIG, NEXTJS_DATA_LAYERS, "prisma");
}

function selectedNextjsSeedBundler(config = {}) {
  return selectedConfigValue(config, NEXTJS_SEED_BUNDLER_CONFIG, NEXTJS_SEED_BUNDLERS, "turbopack");
}

function selectedNextjsSeedLanguage(config = {}) {
  return selectedConfigValue(config, NEXTJS_SEED_LANGUAGE_CONFIG, NEXTJS_SEED_LANGUAGES, "typescript");
}

function selectedNextjsSeedLinter(config = {}) {
  return selectedConfigValue(config, NEXTJS_SEED_LINTER_CONFIG, NEXTJS_SEED_LINTERS, "eslint");
}

function selectedNextjsSeedSourceLayout(config = {}) {
  return selectedConfigValue(config, NEXTJS_SEED_SOURCE_LAYOUT_CONFIG, NEXTJS_SEED_SOURCE_LAYOUTS, "src");
}

function selectedNextjsSeedStyling(config = {}) {
  return selectedConfigValue(config, NEXTJS_SEED_STYLING_CONFIG, NEXTJS_SEED_STYLING_VALUES, "tailwind");
}

function selectedNextjsSeedImportAlias(config = {}) {
  return configTextValue(config, NEXTJS_SEED_IMPORT_ALIAS_CONFIG, "@/*") || "@/*";
}

export {
  NEXTJS_CONFIG_FIELDS,
  NEXTJS_DEFAULT_CONFIG,
  selectedNextjsDataLayer,
  selectedNextjsPackageManager,
  selectedNextjsSeedBundler,
  selectedNextjsSeedImportAlias,
  selectedNextjsSeedLanguage,
  selectedNextjsSeedLinter,
  selectedNextjsSeedSourceLayout,
  selectedNextjsSeedStyling
};
