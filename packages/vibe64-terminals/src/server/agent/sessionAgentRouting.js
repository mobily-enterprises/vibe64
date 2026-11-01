import {
  ASSISTANT_PURPOSE_ROLES,
  ASSISTANT_ROLE_PURPOSES,
  ASSISTANT_SETUP_ROLES,
  assistantRoutingSetupValues,
  assistantSetupRoleValue,
  isAssistantRoutingOwner,
  needsMainChatApproval
} from "@local/vibe64-runtime/shared/assistantRouting";
import {
  recommendedRoutingAssignments,
  routingAssignmentSelection,
  routingModelChoices,
  resolveAssistantPurpose,
  hasConnectedAssistantModels
} from "@local/vibe64-runtime/shared/assistantRoutingAssignments";
import {
  canUseVibe64Assistant,
  VIBE64_AGENT_PROVIDERS,
  defineVibe64AssistantAccess,
  defineVibe64AssistantCapabilities,
  resolveVibe64AssistantSelection
} from "@local/vibe64-runtime/shared";
import { currentRequestIsPracticeProject } from "@local/vibe64-core/server/projectRequestContext";
import { isPracticeProjectRuntime } from "../practiceAgentGuidance.js";
import { assistantUser } from "./sessionAgentRules.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("../types.js").SessionAgentManagerState} SessionAgentManagerState */
/** @typedef {import("../types.js").SessionAgentBindings} SessionAgentBindings */
/** @typedef {import("../types.js").SessionAgentProvider} SessionAgentProvider */
/** @typedef {import("../types.js").ReadAssistantAccess} ReadAssistantAccess */
/** @typedef {import("../types.js").ResolveAssistantUser} ResolveAssistantUser */

function mergeRoutingCatalogPage(catalog, page, revisionError) {
  catalog ||= { ...page, modelProviders: [] };
  if (catalog.revision !== page.revision) throw new Error(revisionError);
  for (const row of page.modelProviders) {
    const existing = catalog.modelProviders.find(({ id }) => id === row.id);
    if (!existing) catalog.modelProviders.push({ ...row, models: [...row.models] });
    else for (const model of row.models) if (!existing.models.some(({ id }) => id === model.id)) existing.models.push(model);
  }
  return catalog;
}

/**
 * The assistant routing reads: what each purpose resolves to for an actor,
 * the AI setup screen's catalogues, choices and previews, the capabilities
 * an actor may choose from, and a saved selection checked against its
 * catalogue.
 * @param {object} dependencies
 * @param {SessionAgentManagerState} dependencies.state
 * @param {SessionAgentBindings} dependencies.sessionBindings
 * @param {ReadAssistantAccess} dependencies.readAssistantAccess
 * @param {() => Promise<object>} dependencies.readRoutingConfiguration
 * @param {ResolveAssistantUser} dependencies.resolveAssistantUser
 */
function createSessionAgentRouting({
  state,
  sessionBindings,
  readAssistantAccess,
  readRoutingConfiguration,
  resolveAssistantUser
}) {
  /**
   * A private copy of the configuration a caller supplies, or else of the saved one.
   */
  async function routingConfiguration(options) {
    return structuredClone(options.configuration || await readRoutingConfiguration());
  }

  /**
   * The capabilities a provider offers the actor, checked against the capability contract.
   * @param {SessionAgentProvider} provider
   * @param {object} input
   * @param {object} options
   */
  async function providerCapabilities(provider, input, options) {
    return defineVibe64AssistantCapabilities(await provider.capabilities({
      engineId: provider.id,
      transportId: provider.transportId,
      vibe64User: assistantUser(options)
    }, input, options));
  }

  async function routingSelectionAccess(assistantSelection, options = {}) {
    const provider = sessionBindings.providerFor({ engineId: assistantSelection.engineId });
    const access = defineVibe64AssistantAccess(await Promise.resolve().then(() => readAssistantAccess({
      assistantSelection,
      engineId: provider.id,
      modelProviderId: assistantSelection.modelProviderId,
      session: options.session || null,
      sessionId: toText(options.session?.sessionId),
      vibe64User: assistantUser(options)
    })).catch(() => ({ available: false, ownerOnly: true, connectionIdentity: "" })));
    return {
      ...access,
      available: access.available && Boolean(access.connectionIdentity),
      engineId: provider.id,
      modelProviderId: assistantSelection.modelProviderId,
      modelId: assistantSelection.modelId
    };
  }

  async function resolvePurpose(input = {}, routingOptions = {}, options = {}) {
    const { facts = new Map(), validateModels = true } = options;
    /**
     * One availability response shares connection/catalogue reads across its
     * purposes. The cache ends with that response; dispatch resolves afresh.
     */
    const readFact = (key, operation) => {
      if (!facts.has(key)) facts.set(key, Promise.resolve().then(operation));
      return facts.get(key);
    };
    // Options are supplied by the server, never spread from a request body.
    // Preview and resumed work must retain their explicit actor even inside an
    // owner's request context. Provider execution still checks access itself.
    const actor = await resolveAssistantUser(assistantUser(routingOptions));
    routingOptions = { ...routingOptions, vibe64User: actor };
    const configuration = await routingConfiguration(routingOptions);
    const { purpose, override, requirements, reviewEnabled, temporaryChat = false } = input;
    // A lesson is private to its learner; the server decides, never the input.
    const practice = isPracticeProjectRuntime(routingOptions.runtime) || currentRequestIsPracticeProject();
    const values = assistantRoutingSetupValues(configuration, purpose, actor, { temporaryChat, practice });
    const role = ASSISTANT_PURPOSE_ROLES[purpose];
    // Team members never reach main chat's models; the resolver says why.
    const roles = needsMainChatApproval(purpose, actor, { temporaryChat, practice }) ? []
      : purpose === "auto" ? ["senior", "junior", "router"]
        : ["senior", "junior"].includes(role) ? ["senior", "junior"] : role ? [role] : [];
    const selections = roles.map((key) => override?.role === key && purpose !== "auto"
      ? override.selection : assistantSetupRoleValue(values, key).value).filter(Boolean);
    const connectionAccess = [];
    async function readSelectionAccess(assistantSelection) {
      const fact = {
        ...await readFact(
          `access:${JSON.stringify(assistantSelection)}`,
          () => routingSelectionAccess(assistantSelection, routingOptions)
        )
      };
      connectionAccess.push(fact);
      return fact;
    }
    const accessible = [];
    for (const selection of selections) {
      const fact = await readSelectionAccess(selection);
      if (canUseVibe64Assistant(fact, actor)) accessible.push(selection);
    }
    const resolution = { purpose, actor, configuration, connectionAccess, override, requirements, reviewEnabled, temporaryChat, practice };
    // Access and missing roles need no native discovery.
    // An eligible destination still requires the current catalogue before dispatch.
    const preflight = resolveAssistantPurpose({ ...resolution, validateModels: false });
    if (!preflight.available || !validateModels) return preflight;
    const catalogs = [];
    const readCatalog = (provider, catalogInput) => readFact(
      `catalog:${provider.id}:${JSON.stringify(catalogInput)}`,
      () => providerCapabilities(provider, catalogInput, { vibe64User: actor })
    );
    const catalogEngines = new Set(accessible.map((selection) => selection.engineId));
    for (const engineId of catalogEngines) {
      const selectionsForEngine = accessible.filter((selection) => selection.engineId === engineId);
      const provider = sessionBindings.providerFor({ engineId });
      try {
        if (engineId !== "opencode") {
          const providerIds = new Set(selectionsForEngine.map((selection) => selection.modelProviderId));
          catalogs.push(await readCatalog(provider, providerIds.size === 1
            ? {
                modelProviderId: selectionsForEngine[0].modelProviderId,
                // Curated Codex routes have static models; dispatch does not need GPT discovery.
                ...(engineId === "codex" && !providerIds.has("openai") ? { configuredOnly: "true" } : {})
              }
            : {}));
          continue;
        }
        // OpenCode's catalogue is paginated. Ask for each exact saved model,
        // then combine only pages from the same catalogue revision.
        let catalog;
        for (const selection of selectionsForEngine) {
          const page = await readCatalog(provider, {
            modelProviderId: selection.modelProviderId,
            modelId: selection.modelId,
            limit: "1"
          });
          catalog = mergeRoutingCatalogPage(catalog, page, "The model catalogue changed. Retry routing.");
        }
        catalogs.push(catalog);
      } catch {
        // An unreadable catalogue makes its destination unavailable. It must
        // not fail an independent role.
        for (const fact of connectionAccess) if (fact.engineId === engineId) fact.available = false;
      }
    }
    return resolveAssistantPurpose({ ...resolution, catalogs });
  }

  async function inspectAssistantPurposes(input = {}, options = {}) {
    const configuration = await routingConfiguration(options);
    const facts = new Map();
    const purposes = [...Object.keys(ASSISTANT_PURPOSE_ROLES), "auto"];
    return Object.fromEntries(await Promise.all(purposes.map(async (purpose) => [purpose,
      await resolvePurpose({
        purpose,
        reviewEnabled: purpose === "auto",
        temporaryChat: input.temporaryChat === true,
        ...(input.override && purpose === input.mode
          ? { override: { role: input.mode, selection: input.override } } : {})
      }, { ...options, configuration }, { facts, validateModels: false })
    ])));
  }

  async function connectedProviderCatalog(provider, options) {
    let catalog;
    async function pages(input = {}) {
      let cursor = "";
      const seen = new Set();
      do {
        if (seen.has(cursor)) throw new Error("The model catalogue did not advance. Reload AI choices.");
        seen.add(cursor);
        const page = await providerCapabilities(provider, { connectedOnly: "true", limit: "200", ...input, cursor }, options);
        catalog = mergeRoutingCatalogPage(catalog, page, "The model catalogue changed. Reload AI choices.");
        cursor = page.page.hasMore ? page.page.nextCursor : "";
        if (page.page.hasMore && !cursor) throw new Error("The model catalogue page is incomplete. Reload AI choices.");
      } while (cursor);
    }
    await pages();
    if (provider.id === "opencode") {
      for (const row of catalog.modelProviders.filter(({ connected }) => connected)) await pages({ modelProviderId: row.id });
    }
    return { ...catalog, page: { kind: "providers", hasMore: false, nextCursor: "", total: catalog.modelProviders.length } };
  }

  /**
   * The AI setup screen's read: both setups' saved values, recommendations,
   * choices and illustrative decisions, from every connected tool's catalogue.
   */
  async function inspectRoutingConfiguration(configuration, options = {}) {
    const catalogs = [];
    const catalogErrors = new Map();
    const connectedEngineIds = new Set();
    await Promise.all([...state.providerById.values()].map(async (provider) => {
      try {
        const catalog = await connectedProviderCatalog(provider, options);
        if (hasConnectedAssistantModels(catalog)) connectedEngineIds.add(provider.id);
        catalogs.push(catalog);
      } catch (error) {
        catalogErrors.set(provider.id, error.message);
      }
    }));
    catalogs.sort((left, right) => left.engineId.localeCompare(right.engineId));
    const routeKey = (selection) => JSON.stringify([selection.engineId, selection.modelProviderId, selection.modelId]);
    const selections = new Map(catalogs.flatMap((engine) => routingModelChoices(engine, { purpose: "request_routing" }))
      .map((selection) => [routeKey(selection), selection]));
    for (const value of [...Object.values(configuration.owner), ...Object.values(configuration.nonOwner)]) {
      if (value?.schema) selections.set(routeKey(value), value);
    }
    const access = new Map();
    const entries = [...selections];
    for (let offset = 0; offset < entries.length; offset += 8) {
      await Promise.all(entries.slice(offset, offset + 8).map(async ([key, selection]) => {
        access.set(key, await routingSelectionAccess(selection, options));
      }));
    }
    const connectionAccess = [...access.values()];
    /**
     * Illustrative actors affect only these read-only decisions. They never enter
     * a provider execution context. Preview uses the same policy as admission.
     */
    const decide = (purposes, actor, previewConfiguration) => Object.fromEntries(purposes.map((purpose) => {
      const decision = resolveAssistantPurpose({ purpose, actor, configuration: previewConfiguration, catalogs, connectionAccess });
      return [purpose, JSON.parse(JSON.stringify(decision, (key, value) =>
        ["connectionIdentity", "routerConnectionIdentity"].includes(key) ? undefined : value))];
    }));
    const previewPurposes = {
      owner: ["senior", "junior", "request_routing", "review", "auto", "colleague", "fix", "source_explanation", "prompt_hint"],
      nonOwner: ["colleague", "fix", "source_explanation", "prompt_hint"]
    };
    const illustrative = { owner: { role: "owner" }, nonOwner: { role: "member" } };
    const setups = Object.fromEntries(Object.keys(ASSISTANT_SETUP_ROLES).map((setup) => {
      const values = configuration[setup];
      const recommendations = recommendedRoutingAssignments({
        catalogs,
        setup,
        values,
        connectionAccess,
        preferProvider: options.preferProvider?.setup === setup ? options.preferProvider : null
      });
      // Setup fills only absent roles; an explicit null stays off. The owner's
      // main chat needs both Senior and Junior before anything is filled.
      const setupValues = { ...values };
      if (setup === "nonOwner" || recommendations.senior && recommendations.junior) {
        for (const role of ASSISTANT_SETUP_ROLES[setup]) {
          if (!Object.hasOwn(setupValues, role) && recommendations[role]) setupValues[role] = recommendations[role];
        }
        if (setupValues.senior?.schema && setupValues.junior?.schema && setupValues.senior.engineId !== setupValues.junior.engineId &&
            !Object.hasOwn(values, "junior")) delete setupValues.junior;
      }
      const roles = Object.fromEntries(ASSISTANT_SETUP_ROLES[setup].map((role) => {
        const purpose = ASSISTANT_ROLE_PURPOSES[role];
        const choices = catalogs.flatMap((catalog) => routingModelChoices(catalog, { purpose }).map((choice) => {
          const fact = access.get(routeKey(choice));
          return {
            ...choice,
            engineLabel: catalog.label,
            ownerOnly: fact?.ownerOnly !== false,
            endpointCode: fact?.endpointCode || "",
            accessLabel: fact?.accessLabel || "Unavailable",
            available: fact?.available === true && Boolean(fact.connectionIdentity)
          };
        })).filter((choice) => setup !== "nonOwner" || !choice.ownerOnly);
        const value = Object.hasOwn(values, role) ? values[role] : undefined;
        let error = "";
        if (value?.schema) {
          try {
            routingAssignmentSelection(catalogs.find((row) => row.engineId === value.engineId), value, { purpose });
            const fact = access.get(routeKey(value));
            if (setup === "nonOwner" && fact?.ownerOnly !== false) {
              throw new Error("Team members can't use personal plans. Choose a Workspace-use model.");
            }
            const choice = choices.find((row) => routeKey(row) === routeKey(value));
            if (!choice?.available) throw new Error("The selected AI connection is unavailable.");
            if (["junior", "fix"].includes(role) && choice.capabilities?.toolcall === false) {
              throw new Error("Choose a model that supports coding tools.");
            }
            if (role === "junior" && values.senior?.schema && values.senior.engineId !== value.engineId) {
              throw new Error("Senior and Junior must run in the same tool.");
            }
          } catch (cause) {
            error = cause.message;
          }
        }
        const { value: effective, followedRole } = assistantSetupRoleValue(values, role);
        return [role, {
          value: value ?? null,
          configured: value !== undefined,
          effective: effective?.schema ? effective : null,
          followedRole,
          recommendation: recommendations[role] ?? null,
          choices,
          error
        }];
      }));
      return [setup, {
        roles,
        setupValues,
        preview: decide(previewPurposes[setup], illustrative[setup], configuration),
        setupPreview: decide(previewPurposes[setup], illustrative[setup], { ...configuration, [setup]: setupValues })
      }];
    }));
    return {
      engines: [...state.providerById.keys()].filter((id) => connectedEngineIds.has(id) || catalogErrors.has(id)).map((engineId) => ({
        engineId,
        label: catalogs.find((entry) => entry.engineId === engineId)?.label ||
          VIBE64_AGENT_PROVIDERS.find(({ id }) => id === engineId)?.label ||
          engineId,
        connected: connectedEngineIds.has(engineId),
        error: catalogErrors.get(engineId) || ""
      })),
      setups,
      viewer: decide(
        ["senior", "junior", "auto", "colleague", "fix", "source_explanation", "prompt_hint"],
        assistantUser(options),
        configuration
      )
    };
  }

  async function listCapabilities(input = {}, options = {}) {
    const requestedEngineId = toText(input.engineId);
    const providersToInspect = requestedEngineId
      ? [sessionBindings.providerFor({ engineId: requestedEngineId })]
      : [...state.providerById.values()];
    const actor = await resolveAssistantUser(assistantUser(options));
    return Object.freeze({
      engines: Object.freeze(await Promise.all(providersToInspect.map(async (provider) => {
        const catalog = input.allConnectedModels === "true" ? await connectedProviderCatalog(provider, options)
          : await providerCapabilities(provider, input, options);
        if (isAssistantRoutingOwner(actor)) return catalog;
        // Team members never see a personal plan's models as choices.
        const personal = await Promise.all(catalog.modelProviders.map(async ({ id, connected }) => connected &&
          (await routingSelectionAccess({
            engineId: provider.id,
            modelProviderId: id
          }, {
            ...options,
            vibe64User: actor
          })).ownerOnly !== false));
        return { ...catalog, modelProviders: catalog.modelProviders.filter((row, index) => !personal[index]) };
      }))),
      ok: true
    });
  }

  function prepareSelection(sessionId, selection, context) {
    const provider = sessionBindings.providerFor({ engineId: selection.engineId });
    // readable-check: allow optional-call - optional operation: a provider without selection preparation prepares nothing
    return provider.prepareSelection?.(sessionId, selection, context) ?? null;
  }

  async function resolveSelection(input = {}, options = {}) {
    const provider = sessionBindings.providerFor({ engineId: input.engineId });
    let capabilities = await providerCapabilities(provider, input, options);
    // Models setup saves choices from the whole catalogue, whose revision
    // differs from one provider's page; check such a choice against it.
    if (input.modelProviderId && input.catalogRevision && input.catalogRevision !== capabilities.revision) {
      capabilities = await providerCapabilities(provider, { ...input, modelProviderId: "" }, options);
    }
    return resolveVibe64AssistantSelection(capabilities, input);
  }

  return Object.freeze({
    inspectAssistantPurposes,
    inspectRoutingConfiguration,
    listCapabilities,
    prepareSelection,
    resolvePurpose,
    resolveSelection
  });
}

export {
  createSessionAgentRouting
};
