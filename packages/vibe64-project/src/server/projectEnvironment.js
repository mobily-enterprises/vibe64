import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  normalizeRuntimeConfigKey,
  resolveRuntimeConfig,
  runtimeConfigDotenvFile,
  runtimeConfigEnv,
  runtimeConfigEnvViewModel,
  runtimeConfigKeyIsVibe64Reserved
} from "@local/vibe64-core/server/runtimeConfig";
import { readEnvUserValues, saveEnvUserValues } from "@local/vibe64-core/server/envUserValues";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { materializeProjectEnvironmentFiles } from "./projectEnvironmentFiles.js";
import {
  managesProjectResources,
  normalizeResourceEnvironment,
  requiredAlternative,
  resourceSemanticIsSecret
} from "./resourceEnvironment.js";
import { SAVED_ENV_VALUE_SOURCE, offersSavedValues, savedEnvValueRecords } from "./savedEnvValues.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./types.js").ProjectSelection} ProjectSelection */
/** @typedef {import("./types.js").ProjectResourceEnvironment} ProjectResourceEnvironment */
/** @typedef {import("./types.js").SavedEnvValues} SavedEnvValues */

function envScope(input = {}) {
  return input.environment || input.scope || RUNTIME_CONFIG_SCOPES.DEV;
}

function stackResourceRecords(resources = [], environment = {}, defaults = {}) {
  const records = new Map();
  for (const declaration of resources) {
    const alternative = requiredAlternative(declaration.resource, environment);
    for (const [semantic, key] of Object.entries(alternative?.bindings || {})) {
      // A Stack default already supplies this binding; its editable default
      // record stays visible instead of an empty required one shadowing it.
      if (records.has(key) || Object.hasOwn(defaults, key)) {
        continue;
      }
      records.set(key, {
        editable: true,
        key,
        materialize: false,
        owner: "user",
        requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        secret: resourceSemanticIsSecret(semantic) ? true : undefined,
        source: `genesis-stack:${declaration.component}:${declaration.resource.id}`,
        value: ""
      });
    }
  }
  return [...records.values()];
}

function environmentRecord(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [String(key || "").trim(), String(entry ?? "")])
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)));
}

function environmentRecords(environment = {}, {
  editable = false,
  owner = RUNTIME_CONFIG_OWNERS.SYSTEM,
  secretKeys = new Set(),
  source = "system",
  sources = {}
} = {}) {
  return Object.entries(environmentRecord(environment)).map(([key, value]) => ({
    editable,
    key,
    owner,
    requiredFor: [],
    scope: RUNTIME_CONFIG_SCOPES.DEV,
    secret: secretKeys.has(key) ? true : undefined,
    source: sources[key] || source,
    value,
    valuePresent: true
  }));
}

function declaredEnvironmentDefaults(defaults = []) {
  if (!Array.isArray(defaults)) {
    return {};
  }
  return environmentRecord(Object.fromEntries(defaults
    .filter((entry) => entry && typeof entry.name === "string" && typeof entry.value === "string")
    .map((entry) => [entry.name, entry.value])));
}

function genesisEnvironmentIsUnconfigured(error) {
  return error?.code === "STACK_REQUIRED";
}

/**
 * The selected project's Development Env: the person's typed values, linked saved
 * values, Stack defaults and a host's managed resource bindings, resolved for one
 * source; reading, revealing, downloading and saving it.
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env
 * @param {typeof import("@local/vibe64-genesis/server").inspectGenesisEnvironment} dependencies.inspectEnvironment
 * @param {ProjectSelection} dependencies.selection
 * @param {ProjectResourceEnvironment} dependencies.resourceEnvironmentProvider
 * @param {SavedEnvValues} dependencies.savedEnvValues
 */
function createProjectEnvironment({ env, inspectEnvironment, resourceEnvironmentProvider, savedEnvValues, selection }) {
  async function userEnvRecords() {
    return (await readEnvUserValues({
      projectRuntimeRoot: selection.selectedProjectRuntimeRoot()
    })).records;
  }

  /**
   * Values the host supplies because the person linked a saved value to a
   * Development Env variable. A failing provider fails the read instead of
   * silently dropping values.
   */
  async function savedEnvRecords(input = {}) {
    const scope = envScope(input);
    if (!offersSavedValues(savedEnvValues) || scope !== RUNTIME_CONFIG_SCOPES.DEV) return [];
    return savedEnvValueRecords(savedEnvValues, {
      projectContextRoot: selection.selectedTargetRoot(),
      projectRuntimeRoot: selection.selectedProjectRuntimeRoot(),
      projectSlug: selection.currentProjectSlug()
    });
  }

  async function resolvedProjectEnvironment(input = {}, userRecords = [], {
    provisionResources = false
  } = {}) {
    const source = await selection.sourceForInput(input);
    const sourceRoot = source.sourceRoot;
    const savedRecords = await savedEnvRecords(input);
    const envOptions = { scope: envScope(input), target: input.target };
    // Typed values, then linked saved values over them.
    const personEnvironment = {
      ...runtimeConfigEnv(userRecords, envOptions),
      ...runtimeConfigEnv(savedRecords, envOptions)
    };
    if (!sourceRoot) {
      return {
        databaseToolEnvironment: null,
        effectiveEnvironment: {
          ...env,
          ...personEnvironment
        },
        environmentFiles: [],
        projectEnvironment: personEnvironment,
        platformEnvironmentSecrets: new Set(),
        platformEnvironmentSources: {},
        resources: [],
        resourcesPrepared: true,
        savedRecords,
        source,
        warning: ""
      };
    }
    let declaration;
    try {
      declaration = await inspectEnvironment({
        environment: {
          ...env,
          ...personEnvironment
        },
        projectRoot: sourceRoot
      });
    } catch (error) {
      return {
        databaseToolEnvironment: null,
        environmentInspectionFailed: !genesisEnvironmentIsUnconfigured(error),
        effectiveEnvironment: {
          ...env,
          ...personEnvironment
        },
        environmentFiles: [],
        projectEnvironment: personEnvironment,
        platformEnvironmentSecrets: new Set(),
        platformEnvironmentSources: {},
        resources: [],
        resourcesPrepared: true,
        savedRecords,
        source,
        warning: genesisEnvironmentIsUnconfigured(error)
          ? ""
          : String(error?.message || "")
      };
    }
    const developmentDatabase = managesProjectResources(resourceEnvironmentProvider) && source.sessionId
      ? await selection.currentDevelopmentDatabaseConfiguration()
      : null;
    const environmentForResources = provisionResources
      ? resourceEnvironmentProvider.environmentForResources
      : resourceEnvironmentProvider.environmentForProvisionedResources;
    if (developmentDatabase && typeof environmentForResources !== "function") {
      throw new TypeError(
        provisionResources
          ? "Vibe64 resource environment provider must expose environmentForResources()."
          : "Vibe64 resource environment provider must expose environmentForProvisionedResources()."
      );
    }
    const provided = developmentDatabase
      ? await environmentForResources.call(resourceEnvironmentProvider, {
          components: declaration.components,
          ...developmentDatabase,
          projectRuntimeRoot: selection.selectedProjectRuntimeRoot(),
          resources: declaration.resources,
          serviceDataRoot: selection.serviceDataRoot(),
          sessionId: source.sessionId,
          projectContextRoot: selection.selectedTargetRoot(),
          sourceRoot
        })
      : {};
    const contribution = developmentDatabase
      ? normalizeResourceEnvironment(declaration.resources, provided, {
          allowUnprepared: !provisionResources
        })
      : {
          databaseToolEnvironment: null,
          environment: {},
          secretKeys: new Set(),
          sources: {}
        };
    const platformEnvironment = contribution.environment;
    const defaultEnvironment = declaredEnvironmentDefaults(declaration.environmentDefaults);
    // A managed resource binding always wins over a linked saved value.
    const projectEnvironment = {
      ...defaultEnvironment,
      ...personEnvironment,
      ...platformEnvironment
    };
    return {
      defaultEnvironment,
      databaseToolEnvironment: contribution.databaseToolEnvironment,
      ...(Object.hasOwn(contribution, "resourcePreparation") ? { resourcePreparation: contribution.resourcePreparation } : {}),
      effectiveEnvironment: {
        ...env,
        ...projectEnvironment
      },
      environmentFiles: declaration.files,
      platformEnvironment,
      platformEnvironmentSecrets: contribution.secretKeys,
      platformEnvironmentSources: contribution.sources,
      projectEnvironment,
      resources: declaration.resources,
      resourcesPrepared: !developmentDatabase || provided.prepared === true,
      savedRecords,
      source,
      warning: ""
    };
  }

  async function stackEnvRecords(input = {}, userRecords = []) {
    const resolved = await resolvedProjectEnvironment(input, userRecords);
    return {
      // Saved values come first: by the record merge rule they replace Stack
      // defaults and stale user values, and a managed resource replaces them.
      records: [
        ...resolved.savedRecords,
        ...environmentRecords(resolved.defaultEnvironment, {
          editable: true,
          owner: RUNTIME_CONFIG_OWNERS.USER,
          source: "genesis-stack:default"
        }),
        ...environmentRecords(resolved.platformEnvironment, {
          secretKeys: resolved.platformEnvironmentSecrets,
          source: "vibe64-host:managed-resource",
          sources: resolved.platformEnvironmentSources
        }),
        ...stackResourceRecords(resolved.resources, resolved.effectiveEnvironment, resolved.defaultEnvironment)
      ],
      source: resolved.source,
      warning: resolved.warning
    };
  }

  async function envConfig(input = {}) {
    const userRecords = await userEnvRecords();
    const stack = await stackEnvRecords(input, userRecords);
    const config = await resolveRuntimeConfig([
      ...stack.records,
      ...userRecords
    ], {
      scope: envScope(input),
      target: input.target
    });
    return {
      config,
      stack
    };
  }

  async function readEnvState(input = {}) {
    const { config, stack } = await envConfig(input);
    return {
      env: {
        ...runtimeConfigEnvViewModel(config),
        configSource: {
          label: stack.source.label,
          rootKind: stack.source.rootKind,
          sessionId: stack.source.sessionId,
          sourceRoot: stack.source.sourceRoot
        },
        ...(stack.warning ? { stackWarning: stack.warning } : {})
      },
      ok: true
    };
  }

  function assertEnvOwner(input = {}, message = "") {
    if (input.vibe64User && input.vibe64User.role !== "owner") {
      throw vibe64Error(message, "vibe64_owner_required");
    }
  }

  async function revealEnvSecretState(input = {}) {
    const key = normalizeRuntimeConfigKey(input.key);
    const { config } = await envConfig(input);
    const record = config.view?.records?.find((candidate) => candidate?.key === key);
    if (!record) {
      throw vibe64Error(
        "That development secret is not available.",
        "vibe64_env_variable_not_found"
      );
    }
    if (record.secret !== true) {
      throw vibe64Error(
        `${key} is not a secret value.`,
        "vibe64_env_variable_not_secret"
      );
    }
    const value = String(config.values?.[key] ?? "");
    if (record.valuePresent !== true || !value) {
      throw vibe64Error(
        `${key} has no value to reveal.`,
        "vibe64_env_secret_value_missing"
      );
    }
    return {
      key,
      ok: true,
      value
    };
  }

  /**
   * Every record Env shows, secrets included, as one .env file for the owner.
   */
  async function downloadEnvState(input = {}) {
    assertEnvOwner(input, "Only the Vibe64 owner can download development Env.");
    const { config } = await envConfig(input);
    return {
      content: runtimeConfigDotenvFile({
        environment: config.scope === RUNTIME_CONFIG_SCOPES.PROD ? "production" : "development",
        isUserRecord: (record) => record.editable === true || record.source === SAVED_ENV_VALUE_SOURCE,
        project: selection.currentProjectSlug(),
        records: config.view.records,
        values: config.values
      }),
      ok: true
    };
  }

  async function saveEnvState(input = {}) {
    const values = input.values && typeof input.values === "object" && !Array.isArray(input.values)
      ? input.values
      : {};
    const { config, stack } = await envConfig(input);
    const stackKeys = new Set(stack.records.map((record) => record.key));
    const currentRecords = new Map(config.view.records.map((record) => [record.key, record]));
    for (const key of Object.keys(values)) {
      const normalizedKey = normalizeRuntimeConfigKey(key);
      const record = currentRecords.get(normalizedKey);
      if (record?.source === SAVED_ENV_VALUE_SOURCE) {
        throw vibe64Error(
          `${normalizedKey} is linked to a saved value. Unlink it before entering a value here.`,
          "vibe64_env_value_linked"
        );
      }
      if (record && (record.owner !== RUNTIME_CONFIG_OWNERS.USER || record.editable !== true)) {
        throw vibe64Error(
          `${normalizedKey} is not editable as a user Env value.`,
          "vibe64_env_value_not_editable"
        );
      }
      if (runtimeConfigKeyIsVibe64Reserved(normalizedKey) && !stackKeys.has(normalizedKey)) {
        const error = new Error(`${normalizedKey} is reserved for Vibe64 and is not declared by the Genesis Stack.`);
        error.code = "vibe64_env_reserved_key";
        throw error;
      }
    }
    await saveEnvUserValues({
      environment: envScope(input),
      projectRuntimeRoot: selection.selectedProjectRuntimeRoot(),
      values
    });
    const resolved = await resolvedProjectEnvironment(input, await userEnvRecords());
    await materializeProjectEnvironmentFiles({
      environment: resolved.projectEnvironment,
      files: resolved.environmentFiles,
      sourceRoot: resolved.source.sourceRoot
    });
    return readEnvState(input);
  }

  async function promptEnvironment() {
    return (await resolvedProjectEnvironment({}, await userEnvRecords())).effectiveEnvironment;
  }

  return Object.freeze({
    userEnvRecords,
    resolvedProjectEnvironment,
    readEnvState,
    revealEnvSecretState,
    downloadEnvState,
    saveEnvState,
    promptEnvironment
  });
}

export {
  createProjectEnvironment,
  envScope
};
