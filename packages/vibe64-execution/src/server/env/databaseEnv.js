import {
  envRecord
} from "../normalize.js";

const DATABASE_ENV_NAMES = Object.freeze([
  "DATABASE_URL",
  "DB_CLIENT",
  "DB_HOST",
  "DB_NAME",
  "DB_PASSWORD",
  "DB_PORT",
  "DB_USER",
  "MYSQL_DATABASE",
  "MYSQL_HOST",
  "MYSQL_PWD",
  "MYSQL_TCP_PORT",
  "VIBE64_MYSQL_USER"
]);
const DATABASE_ENV_ALIASES = Object.freeze([
  ["DB_HOST", "MYSQL_HOST"],
  ["DB_NAME", "MYSQL_DATABASE"],
  ["DB_PASSWORD", "MYSQL_PWD"],
  ["DB_PORT", "MYSQL_TCP_PORT"],
  ["DB_USER", "VIBE64_MYSQL_USER"]
]);

function applyDatabaseAliases(output = {}) {
  for (const [canonical, alias] of DATABASE_ENV_ALIASES) {
    if (output[canonical] !== undefined && output[canonical] !== "" && !output[alias]) {
      output[alias] = output[canonical];
    }
    if (output[alias] !== undefined && output[alias] !== "" && !output[canonical]) {
      output[canonical] = output[alias];
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
  return applyDatabaseAliases(output);
}

export {
  DATABASE_ENV_ALIASES,
  DATABASE_ENV_NAMES,
  databaseEnv
};
