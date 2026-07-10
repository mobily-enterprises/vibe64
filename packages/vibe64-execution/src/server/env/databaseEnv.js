import {
  envRecord,
  normalizeText
} from "../normalize.js";

const DATABASE_ENV_NAMES = Object.freeze([
  "DATABASE_URL",
  "DB_CLIENT",
  "DB_DATABASE",
  "DB_HOST",
  "DB_NAME",
  "DB_PASSWORD",
  "DB_PORT",
  "DB_USER",
  "DB_USERNAME",
  "MYSQL_DATABASE",
  "MYSQL_HOST",
  "MYSQL_PWD",
  "MYSQL_TCP_PORT",
  "PGDATABASE",
  "PGHOST",
  "PGPASSWORD",
  "PGPORT",
  "PGUSER",
  "VIBE64_MYSQL_USER"
]);
const DATABASE_CLIENT_FAMILIES = Object.freeze({
  mariadb: "mariadb",
  mysql: "mariadb",
  mysql2: "mariadb",
  pg: "postgres",
  postgres: "postgres",
  postgresql: "postgres"
});
const DATABASE_CLIENT_ENV_PROJECTIONS = Object.freeze({
  mariadb: Object.freeze([
    ["DB_HOST", "MYSQL_HOST"],
    ["DB_NAME", "MYSQL_DATABASE"],
    ["DB_PASSWORD", "MYSQL_PWD"],
    ["DB_PORT", "MYSQL_TCP_PORT"],
    ["DB_USER", "VIBE64_MYSQL_USER"]
  ]),
  postgres: Object.freeze([
    ["DB_HOST", "PGHOST"],
    ["DB_NAME", "PGDATABASE"],
    ["DB_PASSWORD", "PGPASSWORD"],
    ["DB_PORT", "PGPORT"],
    ["DB_USER", "PGUSER"]
  ])
});

function applyDatabaseClientProjection(output = {}) {
  const family = DATABASE_CLIENT_FAMILIES[normalizeText(output.DB_CLIENT).toLowerCase()];
  for (const [canonical, native] of DATABASE_CLIENT_ENV_PROJECTIONS[family] || []) {
    if (output[canonical] !== undefined && output[canonical] !== "" && !output[native]) {
      output[native] = output[canonical];
    }
  }
  return output;
}

function databaseEnv(...records) {
  const output = {};
  for (const record of records) {
    const env = envRecord(record);
    for (const name of DATABASE_ENV_NAMES) {
      if (env[name] !== undefined && env[name] !== "") {
        output[name] = env[name];
      }
    }
  }
  return applyDatabaseClientProjection(output);
}

export {
  DATABASE_ENV_NAMES,
  databaseEnv
};
