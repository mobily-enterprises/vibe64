import {
  runtimeConfigKeyIsVibe64Reserved
} from "@local/vibe64-core/server/runtimeConfig";
import {
  rejectCallerEnvPolicy
} from "@local/vibe64-execution/server";

const RESOURCE_ENVIRONMENT_CONTRACT = "vibe64.resource-environment.v2";
const DATABASE_TOOL_ENVIRONMENT_CONTRACT = "vibe64.database-tool-environment.v1";
const DATABASE_RESOURCE_KINDS = new Set(["mysql", "postgresql"]);
const DATABASE_CONNECTION_SEMANTICS = new Set([
  "database",
  "host",
  "password",
  "port",
  "url",
  "username"
]);
const SECRET_RESOURCE_SEMANTICS = new Set(["password", "url"]);
const FORBIDDEN_RESOURCE_ENVIRONMENT_NAMES = new Set(["NODE_OPTIONS"]);
const RESOURCE_PROVIDER_RESULT_KEYS = new Set([
  "contract",
  "databaseToolEnvironment",
  "ok",
  "prepared",
  "requiredUnits",
  "resourceValues"
]);

function resourceEnvironmentError(message, code = "vibe64_resource_environment_invalid") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function text(value = "") {
  return String(value ?? "").trim();
}

function declarationIdentity(component = "", resource = {}) {
  return `${text(component)}\u0000${text(resource.id)}\u0000${text(resource.kind)}`;
}

function normalizedSemanticValues(value = {}) {
  const record = objectRecord(value);
  if (!record) {
    throw resourceEnvironmentError("A resource provider returned invalid semantic values.");
  }
  return Object.fromEntries(Object.entries(record).map(([semantic, entry]) => {
    const name = text(semantic);
    if (!/^[a-z][A-Za-z0-9]*$/u.test(name) || !["number", "string"].includes(typeof entry)) {
      throw resourceEnvironmentError("A resource provider returned an invalid semantic value.");
    }
    return [name, String(entry)];
  }));
}

function declaredSemantics(resource = {}) {
  return new Set([
    ...(Array.isArray(resource.environmentAlternatives)
      ? resource.environmentAlternatives.flatMap((alternative) => Object.keys(alternative?.bindings || {}))
      : []),
    ...Object.keys(objectRecord(resource.optionalBindings) || {})
  ]);
}

function assertSafeResourceEnvironmentName(name = "") {
  const key = text(name);
  rejectCallerEnvPolicy({ [key]: "value" });
  if (runtimeConfigKeyIsVibe64Reserved(key) || FORBIDDEN_RESOURCE_ENVIRONMENT_NAMES.has(key)) {
    throw resourceEnvironmentError(
      `Managed resource binding cannot target reserved environment variable ${key}.`,
      "vibe64_resource_environment_name_reserved"
    );
  }
}

function preferredAlternative(resource = {}) {
  const alternatives = Array.isArray(resource.environmentAlternatives)
    ? resource.environmentAlternatives
    : [];
  const preferred = alternatives.filter((alternative) => alternative?.preferred === true);
  if (preferred.length !== 1 || !objectRecord(preferred[0].bindings)) {
    throw resourceEnvironmentError(
      `Genesis resource ${text(resource.id) || "(unknown)"} has no unambiguous preferred semantic binding.`,
      "vibe64_resource_bindings_required"
    );
  }
  return preferred[0];
}

function bindingValuePresent(environment = {}, semantic = "", name = "", allowEmpty = []) {
  if (!Object.hasOwn(environment, name) || typeof environment[name] !== "string") {
    return false;
  }
  const value = environment[name].trim();
  if (value === `$${name}` || value === `\${${name}}`) {
    return false;
  }
  return value.length > 0 || allowEmpty.includes(semantic);
}

function satisfiedAlternative(resource = {}, environment = {}) {
  const alternatives = Array.isArray(resource.environmentAlternatives)
    ? resource.environmentAlternatives
    : [];
  for (const alternative of alternatives) {
    const bindings = objectRecord(alternative?.bindings);
    const allowEmpty = Array.isArray(alternative?.allowEmpty) ? alternative.allowEmpty : [];
    if (bindings && Object.entries(bindings).every(([semantic, name]) => (
      bindingValuePresent(environment, semantic, name, allowEmpty)
    ))) {
      return alternative;
    }
  }
  return null;
}

function normalizedConnectionEndpoint(value = {}, kind = "") {
  const endpoint = objectRecord(value);
  if (!endpoint) {
    throw resourceEnvironmentError("Database tool connection endpoint is invalid.");
  }
  const url = text(endpoint.url);
  if (url) {
    if (Object.keys(endpoint).some((name) => name !== "url")) {
      throw resourceEnvironmentError("Database tool URL connections cannot mix structured fields.");
    }
    return { url };
  }
  const port = Number(endpoint.port);
  const normalized = {
    database: text(endpoint.database),
    host: text(endpoint.host),
    password: String(endpoint.password ?? ""),
    port,
    username: text(endpoint.username)
  };
  if (
    !normalized.database ||
    !normalized.host ||
    !normalized.username ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    Object.keys(endpoint).some((name) => !["database", "host", "password", "port", "username"].includes(name))
  ) {
    throw resourceEnvironmentError(
      `The ${kind || "database"} tool connection is incomplete.`,
      "vibe64_database_tool_connection_incomplete"
    );
  }
  return normalized;
}

function normalizeDatabaseToolEnvironment(value = {}, {
  requireDistinctReader = false
} = {}) {
  const environment = objectRecord(value);
  const kind = text(environment?.kind);
  if (
    environment?.contract !== DATABASE_TOOL_ENVIRONMENT_CONTRACT ||
    !DATABASE_RESOURCE_KINDS.has(kind) ||
    Object.keys(environment).some((name) => !["contract", "kind", "read", "write"].includes(name))
  ) {
    throw resourceEnvironmentError(
      "The database tool environment contract is invalid.",
      "vibe64_database_tool_environment_invalid"
    );
  }
  const read = normalizedConnectionEndpoint(environment.read, kind);
  const write = normalizedConnectionEndpoint(environment.write, kind);
  if (requireDistinctReader) {
    if (
      read.url ||
      write.url ||
      read.host !== write.host ||
      read.port !== write.port ||
      read.database !== write.database ||
      read.username === write.username ||
      read.password === write.password
    ) {
      throw resourceEnvironmentError(
        "A managed database tool requires a distinct reader for the same development database.",
        "vibe64_database_tool_reader_required"
      );
    }
  }
  return Object.freeze({
    contract: DATABASE_TOOL_ENVIRONMENT_CONTRACT,
    kind,
    read: Object.freeze(read),
    write: Object.freeze(write)
  });
}

function normalizeResourceEnvironment(resources = [], provided = {}, {
  allowUnprepared = false,
  requireDatabaseTool = true
} = {}) {
  if (
    provided?.contract !== RESOURCE_ENVIRONMENT_CONTRACT ||
    (provided.prepared !== undefined && typeof provided.prepared !== "boolean") ||
    !Array.isArray(provided.resourceValues) ||
    Object.keys(objectRecord(provided) || {}).some((name) => !RESOURCE_PROVIDER_RESULT_KEYS.has(name))
  ) {
    throw resourceEnvironmentError(
      `The host must return ${RESOURCE_ENVIRONMENT_CONTRACT}.`,
      "vibe64_resource_environment_contract_invalid"
    );
  }
  const declarations = new Map((Array.isArray(resources) ? resources : []).map((declaration) => [
    declarationIdentity(declaration.component, declaration.resource),
    declaration
  ]));
  const entries = new Map();
  for (const providedResource of provided.resourceValues) {
    const descriptor = objectRecord(providedResource?.declaration);
    if (
      !descriptor ||
      Object.keys(objectRecord(providedResource) || {}).some((name) => !["declaration", "values"].includes(name)) ||
      Object.keys(descriptor).some((name) => !["component", "id", "kind"].includes(name))
    ) {
      throw resourceEnvironmentError(
        "A resource provider returned an invalid resource declaration.",
        "vibe64_resource_environment_declaration_mismatch"
      );
    }
    const identity = declarationIdentity(descriptor?.component, {
      id: descriptor?.id,
      kind: descriptor?.kind
    });
    if (!declarations.has(identity) || entries.has(identity)) {
      throw resourceEnvironmentError(
        "The host returned an unknown or duplicate resource declaration.",
        "vibe64_resource_environment_declaration_mismatch"
      );
    }
    const values = normalizedSemanticValues(providedResource.values);
    const declaration = declarations.get(identity);
    const semantics = declaredSemantics(declaration.resource);
    if (Object.keys(values).some((semantic) => !semantics.has(semantic))) {
      throw resourceEnvironmentError(
        `The host returned an undeclared semantic value for resource ${declaration.resource.id}.`,
        "vibe64_resource_environment_semantic_undeclared"
      );
    }
    entries.set(identity, values);
  }

  const environment = {};
  const secretKeys = new Set();
  const sources = {};
  const managedDatabases = [];
  for (const [identity, declaration] of declarations) {
    const values = entries.get(identity);
    if (!values) {
      if (allowUnprepared && provided.prepared === false) {
        continue;
      }
      throw resourceEnvironmentError(
        `The host did not satisfy managed resource ${declaration.resource.id}.`,
        DATABASE_RESOURCE_KINDS.has(declaration.resource.kind)
          ? "vibe64_managed_database_resource_missing"
          : "vibe64_managed_resource_missing"
      );
    }
    const alternative = preferredAlternative(declaration.resource);
    const allowEmpty = Array.isArray(alternative.allowEmpty) ? alternative.allowEmpty : [];
    const bindings = {
      ...alternative.bindings,
      ...Object.fromEntries(Object.entries(objectRecord(declaration.resource.optionalBindings) || {})
        .filter(([semantic]) => Object.hasOwn(values, semantic)))
    };
    for (const [semantic, name] of Object.entries(bindings)) {
      assertSafeResourceEnvironmentName(name);
      if (!Object.hasOwn(values, semantic) || (!values[semantic] && !allowEmpty.includes(semantic))) {
        throw resourceEnvironmentError(
          `The host did not supply ${semantic} for resource ${declaration.resource.id}.`,
          "vibe64_resource_environment_value_missing"
        );
      }
      if (Object.hasOwn(environment, name) && environment[name] !== values[semantic]) {
        throw resourceEnvironmentError(
          `Managed resources assign conflicting values to ${name}.`,
          "vibe64_resource_environment_collision"
        );
      }
      environment[name] = values[semantic];
      sources[name] = `vibe64-host:managed-resource:${declaration.resource.kind}:${declaration.resource.id}`;
      if (SECRET_RESOURCE_SEMANTICS.has(semantic)) {
        secretKeys.add(name);
      }
    }
    if (DATABASE_RESOURCE_KINDS.has(declaration.resource.kind)) {
      managedDatabases.push({ declaration, values });
    }
  }

  if (managedDatabases.length > 1) {
    throw resourceEnvironmentError(
      "The session declares more than one managed database.",
      "vibe64_managed_database_ambiguous"
    );
  }
  if (!requireDatabaseTool && provided.databaseToolEnvironment != null) {
    throw resourceEnvironmentError(
      "Production resource provisioning must not return database-tool credentials.",
      "vibe64_database_tool_environment_forbidden"
    );
  }
  const databaseToolEnvironment = managedDatabases.length === 0 || !requireDatabaseTool
    ? null
    : normalizeDatabaseToolEnvironment(provided.databaseToolEnvironment, {
        requireDistinctReader: true
      });
  if (databaseToolEnvironment && databaseToolEnvironment.kind !== managedDatabases[0].declaration.resource.kind) {
    throw resourceEnvironmentError(
      "The database tool kind does not match the managed resource.",
      "vibe64_database_tool_resource_mismatch"
    );
  }
  const writer = databaseToolEnvironment?.write;
  const values = managedDatabases[0]?.values;
  if (writer && !writer.url && [
    ["database", writer.database],
    ["host", writer.host],
    ["password", writer.password],
    ["port", String(writer.port)],
    ["username", writer.username]
  ].some(([semantic, expected]) => Object.hasOwn(values, semantic) && values[semantic] !== expected)) {
    throw resourceEnvironmentError(
      "The database tool writer does not match the application resource credential.",
      "vibe64_database_tool_resource_mismatch"
    );
  }

  return {
    databaseToolEnvironment,
    environment,
    secretKeys,
    sources
  };
}

function applicationDatabaseToolEnvironment(resources = [], environment = {}) {
  const databases = (Array.isArray(resources) ? resources : []).filter(({ resource }) => (
    DATABASE_RESOURCE_KINDS.has(resource?.kind)
  ));
  if (databases.length !== 1) {
    throw resourceEnvironmentError(
      databases.length > 1
        ? "The session declares more than one database."
        : "The session Stack does not declare a supported database.",
      databases.length > 1
        ? "vibe64_managed_database_ambiguous"
        : "vibe64_session_database_unavailable"
    );
  }
  const { resource } = databases[0];
  const alternative = satisfiedAlternative(resource, environment);
  if (!alternative) {
    preferredAlternative(resource);
    throw resourceEnvironmentError(
      "The session database environment is incomplete.",
      "vibe64_session_database_configuration_incomplete"
    );
  }
  const values = Object.fromEntries(Object.entries(alternative.bindings).map(([semantic, name]) => [
    semantic,
    environment[name]
  ]));
  const unsupported = Object.keys(values).filter((semantic) => !DATABASE_CONNECTION_SEMANTICS.has(semantic));
  let endpoint;
  if (unsupported.length > 0) {
    throw resourceEnvironmentError(
      `The database tool does not support connection semantics: ${unsupported.join(", ")}.`,
      "vibe64_database_tool_semantics_unsupported"
    );
  }
  if (values.url) {
    endpoint = { url: values.url };
  } else {
    endpoint = normalizedConnectionEndpoint(values, resource.kind);
  }
  return normalizeDatabaseToolEnvironment({
    contract: DATABASE_TOOL_ENVIRONMENT_CONTRACT,
    kind: resource.kind,
    read: endpoint,
    write: endpoint
  });
}

export {
  DATABASE_TOOL_ENVIRONMENT_CONTRACT,
  RESOURCE_ENVIRONMENT_CONTRACT,
  applicationDatabaseToolEnvironment,
  normalizeDatabaseToolEnvironment,
  normalizeResourceEnvironment,
  preferredAlternative,
  satisfiedAlternative
};
