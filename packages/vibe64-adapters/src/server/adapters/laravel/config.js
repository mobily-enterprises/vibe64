import {
  defaultConfigFromFields
} from "../../configValues.js";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  DEFAULT_NODE_PACKAGE_MANAGER
} from "../../nodePackageManagers.js";
import {
  LARAVEL_DATABASE_RUNTIME_CONFIG
} from "./constants.js";

const LARAVEL_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: "sqlite",
    description: "Database runtime Studio should prepare for local Laravel runs. The seed workflow chooses Laravel starter kits and modules later.",
    id: LARAVEL_DATABASE_RUNTIME_CONFIG,
    label: "Database runtime",
    options: [
      {
        description: "Use local SQLite files for the simplest local Laravel setup.",
        label: "SQLite",
        value: "sqlite"
      },
      {
        description: "Use a managed PostgreSQL service on the Studio runtime network.",
        label: "PostgreSQL",
        value: "postgres"
      },
      {
        description: "Use a managed MySQL-compatible service on the Studio runtime network.",
        label: "MySQL",
        value: "mysql"
      },
      {
        description: "Use a managed MariaDB service on the Studio runtime network.",
        label: "MariaDB",
        value: "mariadb"
      }
    ],
    type: "select"
  }
]);

const LARAVEL_DEFAULT_CONFIG = deepFreeze(defaultConfigFromFields(LARAVEL_CONFIG_FIELDS));

function selectedLaravelPackageManager() {
  return DEFAULT_NODE_PACKAGE_MANAGER;
}

export {
  LARAVEL_CONFIG_FIELDS,
  LARAVEL_DEFAULT_CONFIG,
  selectedLaravelPackageManager
};
