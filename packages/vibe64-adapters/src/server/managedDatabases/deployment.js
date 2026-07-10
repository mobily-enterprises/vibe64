import crypto from "node:crypto";
import path from "node:path";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";

const RELATIONAL_DATABASE_HOST = "127.0.0.1";
const RELATIONAL_DATABASE_PROVIDERS = Object.freeze({
  mariadb: Object.freeze({
    appUserMaxLength: 32,
    client: "mysql2",
    portBase: 23060,
    portRange: 20000,
    urlScheme: "mysql"
  }),
  postgres: Object.freeze({
    appUserMaxLength: 63,
    client: "pg",
    portBase: 43060,
    portRange: 19000,
    urlScheme: "postgresql"
  })
});

function relationalDatabaseProvider(provider = "") {
  const id = normalizeText(provider).toLowerCase();
  const definition = RELATIONAL_DATABASE_PROVIDERS[id];
  if (!definition) {
    throw vibe64Error(
      `Unsupported relational database provider: ${id || "(missing)"}.`,
      "vibe64_relational_database_provider_unsupported"
    );
  }
  return {
    ...definition,
    id
  };
}

function relationalDatabaseServiceSeed({
  provider = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const definition = relationalDatabaseProvider(provider);
  const serviceRoot = normalizeText(serviceDataRoot);
  if (serviceRoot) {
    return path.resolve(serviceRoot);
  }
  const projectRoot = normalizeText(targetRoot);
  return projectRoot ? path.resolve(projectRoot) : `vibe64-managed-${definition.id}-database`;
}

function relationalDatabasePort({
  provider = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const definition = relationalDatabaseProvider(provider);
  const hash = crypto
    .createHash("sha256")
    .update(relationalDatabaseServiceSeed({
      provider: definition.id,
      serviceDataRoot,
      targetRoot
    }))
    .digest();
  return String(definition.portBase + (hash.readUInt32BE(0) % definition.portRange));
}

function relationalDatabaseNamePart(value = "") {
  return normalizeText(value)
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function relationalDatabaseAppUser(databaseName = "", {
  provider = ""
} = {}) {
  const definition = relationalDatabaseProvider(provider);
  const normalized = relationalDatabaseNamePart(databaseName).toLowerCase() || "app";
  const suffix = "_app";
  const raw = `${normalized}${suffix}`;
  if (raw.length <= definition.appUserMaxLength) {
    return raw;
  }
  const hash = crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 8);
  const prefixLength = definition.appUserMaxLength - suffix.length - hash.length - 1;
  return `${normalized.slice(0, Math.max(1, prefixLength))}_${hash}${suffix}`;
}

function relationalDatabaseSecretKey(provider = "") {
  const id = relationalDatabaseProvider(provider).id;
  return `VIBE64_${id.toUpperCase()}_DATABASE_APP_PASSWORD`;
}

async function deploymentRelationalDatabasePassword(deployment = {}, provider = "") {
  if (typeof deployment.secret !== "function") {
    throw vibe64Error(
      "Deployment relational database secrets are unavailable.",
      "vibe64_relational_database_secret_provider_missing"
    );
  }
  const password = String(await deployment.secret({
    byteLength: 32,
    key: relationalDatabaseSecretKey(provider)
  }) ?? "");
  if (!password) {
    throw vibe64Error(
      "Deployment relational database application password is empty.",
      "vibe64_relational_database_secret_empty"
    );
  }
  return password;
}

function relationalDatabaseUrl({
  databaseName = "",
  host = RELATIONAL_DATABASE_HOST,
  password = "",
  port = "",
  provider = "",
  user = ""
} = {}) {
  const definition = relationalDatabaseProvider(provider);
  return `${definition.urlScheme}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(databaseName)}`;
}

function relationalDatabaseConnectionEnvironment(input = {}) {
  return {
    DB_CLIENT: normalizeText(input.client),
    DB_HOST: normalizeText(input.host),
    DB_NAME: normalizeText(input.databaseName),
    DB_PASSWORD: String(input.password ?? ""),
    DB_PORT: normalizeText(input.port),
    DB_USER: normalizeText(input.user)
  };
}

async function deploymentRelationalDatabaseConnection({
  databaseName = "",
  deployment = {},
  provider = "",
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const definition = relationalDatabaseProvider(provider);
  const name = relationalDatabaseNamePart(databaseName);
  if (!name || name !== normalizeText(databaseName)) {
    throw vibe64Error(
      "Deployment relational database name is invalid.",
      "vibe64_relational_database_name_invalid"
    );
  }
  const password = await deploymentRelationalDatabasePassword(deployment, definition.id);
  const connection = {
    client: definition.client,
    databaseName: name,
    host: RELATIONAL_DATABASE_HOST,
    password,
    port: relationalDatabasePort({
      provider: definition.id,
      serviceDataRoot,
      targetRoot
    }),
    provider: definition.id,
    user: relationalDatabaseAppUser(name, {
      provider: definition.id
    })
  };
  return {
    ...connection,
    url: relationalDatabaseUrl(connection)
  };
}

export {
  RELATIONAL_DATABASE_HOST,
  deploymentRelationalDatabaseConnection,
  relationalDatabaseAppUser,
  relationalDatabaseConnectionEnvironment,
  relationalDatabaseNamePart,
  relationalDatabasePort,
  relationalDatabaseProvider
};
