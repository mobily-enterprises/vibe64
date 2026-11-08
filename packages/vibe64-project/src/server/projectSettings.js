import {
  githubRepositoryFullName,
  normalizeConnectedProjects,
  readConnectedProjects,
  saveConnectedProjects
} from "./connectedProjects.js";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { assertProjectDirectoryUsable } from "@local/vibe64-core/server/studioProjectContext";
import { saveProjectPromptHints } from "@local/vibe64-core/server/projectPromptHints";
import {
  readPreviewApplicationIdentities
} from "./previewApplicationIdentities.js";
import { runProjectSourceExclusive } from "./projectSourceMutationLock.js";

/** @typedef {import("./types.js").ProjectSelection} ProjectSelection */
/** @typedef {import("./types.js").ProjectSessionWork} ProjectSessionWork */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * Project settings kept in the project's source: connected repositories, collaboration
 * guidance, prompt suggestions, the engineering profile and Preview identities, with
 * who may edit them.
 * @param {object} dependencies
 * @param {typeof import("@local/vibe64-genesis/server").inspectGenesisCollaboration} dependencies.inspectCollaboration
 * @param {(fullName: string, input: object) => Promise<object>} dependencies.inspectConnectedRepository
 * @param {typeof import("@local/vibe64-genesis/server").inspectGenesisEngineering} dependencies.inspectEngineering
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectSelection} dependencies.selection
 * @param {ProjectSessionWork} dependencies.sessionWork
 * @param {typeof import("@local/vibe64-genesis/server").setGenesisCollaboration} dependencies.setCollaboration
 * @param {typeof import("@local/vibe64-genesis/server").setGenesisEngineeringProfile} dependencies.setEngineeringProfile
 */
function createProjectSettings({
  inspectCollaboration,
  inspectConnectedRepository,
  inspectEngineering,
  logger,
  selection,
  sessionWork,
  setCollaboration,
  setEngineeringProfile
}) {
  function canEditProjectSettings(input = {}) {
    return !input.vibe64User || input.vibe64User.role === "owner";
  }

  async function connectedProjectsState(input = {}) {
    const source = await selection.genesisSettingsSourceForInput(input);
    const scope = { rootKind: source.rootKind, sessionId: source.sessionId };
    if (!source.sourceRoot) {
      return {
        available: false,
        canEdit: false,
        source: scope,
        unavailableReason: "Create or select a session to configure connected repositories."
      };
    }
    await assertProjectDirectoryUsable(source.sourceRoot);
    try {
      return {
        ...(await readConnectedProjects(source.sourceRoot)),
        available: true,
        canEdit: canEditProjectSettings(input),
        source: scope
      };
    } catch (error) {
      if (error.code !== "vibe64_connections_invalid") throw error;
      return { available: false, canEdit: false, source: scope, unavailableReason: error.message };
    }
  }

  async function saveConnectedProjectsState(input = {}) {
    if (!canEditProjectSettings(input)) {
      throw vibe64Error("Only the project owner can change connected repositories.", "vibe64_owner_required", {
        messageCode: "vibe64_connected_projects_owner_required"
      });
    }
    const selected = await selection.genesisSettingsSourceForInput(input);
    const sourceInput = { ...input, sessionId: selected.sessionId };
    const write = async () => {
      const source = await selection.genesisSettingsSourceForInput(sourceInput);
      if (!source.sourceRoot) {
        throw vibe64Error("Create or select a session before configuring connected repositories.", "vibe64_connections_source_required");
      }
      await assertProjectDirectoryUsable(source.sourceRoot);
      return runProjectSourceExclusive(selection.selectedProjectRuntimeRoot(), async () => {
        const normalized = normalizeConnectedProjects({ repositories: input.repositories });
        // Configuration declares intent; actual write access comes from the actor's account.
        if (normalized.repositories.length) {
          for (const entry of normalized.repositories) {
            const fullName = githubRepositoryFullName(entry.repository);
            const repository = await inspectConnectedRepository(fullName, input);
            if (!repository.permissions?.push || repository.archived || repository.disabled) {
              throw vibe64Error(
                `Write access to ${fullName} is required to connect it. Check your GitHub account and repository permissions.`,
                "vibe64_connections_access_required",
                {
                  params: {
                    repository: fullName
                  }
                }
              );
            }
          }
        }
        await saveConnectedProjects(source.sourceRoot, normalized, input.revision);
        return { ok: true, connectedProjects: await connectedProjectsState(sourceInput) };
      }, { operation: "save-connected-projects" });
    };
    return sessionWork.runSessionSourceWorkExclusive(sourceInput, write, "save-connected-projects");
  }

  async function collaborationSettingsState(input = {}) {
    const source = await selection.genesisSettingsSourceForInput(input);
    const publicSource = {
      rootKind: source.rootKind,
      sessionId: source.sessionId
    };
    const unavailable = (unavailableReason) => ({
      available: false,
      canEdit: false,
      choices: {},
      experience: "",
      explanationStyle: "",
      requirements: "",
      responseLength: "",
      source: publicSource,
      status: "unavailable",
      tone: "",
      unavailableReason
    });
    if (!source.sourceRoot) {
      return unavailable(source.sessionId
        ? "This session does not have an available project source yet."
        : "Create or select an AI session to set collaboration guidance.");
    }
    await assertProjectDirectoryUsable(source.sourceRoot);
    let collaboration;
    try {
      collaboration = await inspectCollaboration({
        projectRoot: source.sourceRoot
      });
    } catch (error) {
      // The settings, which the session page reads too, still load without Genesis.
      logOperationalEvent(logger, "warn", {
        code: error?.code || error?.name,
        component: "vibe64.project_settings",
        error: String(error?.message || error),
        event: "vibe64.project_settings.collaboration_unavailable",
        sessionId: source.sessionId
      }, "Genesis could not read the collaboration approach; settings load without it.");
      return unavailable(`Genesis could not read this project's collaboration approach: ${String(error?.message || error)}`);
    }
    return {
      available: true,
      canEdit: canEditProjectSettings(input),
      choices: collaboration.choices,
      experience: collaboration.experience,
      explanationStyle: collaboration.explanationStyle,
      requirements: collaboration.requirements,
      responseLength: collaboration.responseLength,
      source: publicSource,
      status: collaboration.status,
      tone: collaboration.tone,
      unavailableReason: ""
    };
  }

  async function saveCollaborationSettingsState(input = {}) {
    if (!canEditProjectSettings(input)) {
      throw vibe64Error(
        "Only the Vibe64 project owner can change collaboration through Project settings.",
        "vibe64_owner_required",
        {
          messageCode: "vibe64_collaboration_owner_required"
        }
      );
    }
    const sourceInput = await selection.settingsSourceInput(input);
    return sessionWork.runSessionSourceWorkExclusive(sourceInput, async () => {
      const source = await selection.genesisSettingsSourceForInput(sourceInput);
      if (!source.sourceRoot) {
        throw vibe64Error(
          "Collaboration guidance requires an available project source. Create or select an AI session first.",
          "vibe64_collaboration_source_required"
        );
      }
      await assertProjectDirectoryUsable(source.sourceRoot);
      return runProjectSourceExclusive(
        selection.selectedProjectRuntimeRoot(),
        async () => {
          await setCollaboration({
            experience: input.experience,
            explanationStyle: input.explanationStyle,
            projectRoot: source.sourceRoot,
            requirements: input.requirements,
            responseLength: input.responseLength,
            tone: input.tone
          });
          const collaboration = await collaborationSettingsState(sourceInput);
          return {
            collaboration,
            ok: true,
            projectSlug: selection.currentProjectSlug()
          };
        },
        { operation: "save-collaboration-guidance" }
      );
    }, "save-collaboration-guidance");
  }

  async function savePromptHintsState(input = {}) {
    const { settings } = await saveProjectPromptHints({
      projectRuntimeRoot: selection.selectedProjectRuntimeRoot(),
      settings: { promptHints: input.promptHints }
    });
    return {
      ok: true,
      projectSlug: selection.currentProjectSlug(),
      promptHints: {
        canEdit: true,
        enabled: settings.promptHints
      }
    };
  }

  async function engineeringProfileState(input = {}) {
    const source = await selection.genesisSettingsSourceForInput(input);
    const publicSource = {
      rootKind: source.rootKind,
      sessionId: source.sessionId
    };
    if (!source.sourceRoot) {
      return {
        available: false,
        profile: null,
        profiles: [],
        source: publicSource,
        unavailableReason: source.sessionId
          ? "This session does not have an available project source yet."
          : "Create or select an AI session to choose an engineering profile."
      };
    }
    await assertProjectDirectoryUsable(source.sourceRoot);
    const inspection = await inspectEngineering({
      projectRoot: source.sourceRoot
    });
    return {
      available: true,
      profile: {
        description: inspection.profile.description,
        id: inspection.profile.id,
        name: inspection.profile.name
      },
      profiles: inspection.profiles.map((profile) => ({
        description: profile.description,
        id: profile.id,
        name: profile.name
      })),
      source: publicSource,
      status: inspection.status,
      unavailableReason: ""
    };
  }

  async function saveEngineeringProfileState(input = {}) {
    const sourceInput = await selection.settingsSourceInput(input);
    return sessionWork.runSessionSourceWorkExclusive(sourceInput, async () => {
      const source = await selection.genesisSettingsSourceForInput(sourceInput);
      if (!source.sourceRoot) {
        throw vibe64Error(
          "Engineering profiles require an available project source. Create or select an AI session first.",
          "vibe64_engineering_source_required"
        );
      }
      await assertProjectDirectoryUsable(source.sourceRoot);
      return runProjectSourceExclusive(
        selection.selectedProjectRuntimeRoot(),
        async () => {
          await setEngineeringProfile({
            profile: input.profile,
            projectRoot: source.sourceRoot
          });
          return {
            engineering: await engineeringProfileState(sourceInput),
            ok: true,
            projectSlug: selection.currentProjectSlug()
          };
        },
        {
          operation: "save-engineering-profile"
        }
      );
    }, "save-engineering-profile");
  }

  async function previewApplicationIdentitySource(input = {}) {
    const source = await selection.sourceForInput(input);
    if (!source.sourceRoot) {
      throw vibe64Error(
        "Preview identities require an available project source. Create or select a session first.",
        "vibe64_preview_application_identities_source_required"
      );
    }
    await assertProjectDirectoryUsable(source.sourceRoot);
    return source;
  }

  async function previewApplicationIdentitiesState(input = {}) {
    const source = await previewApplicationIdentitySource(input);
    const { identities } = await readPreviewApplicationIdentities({
      sourceRoot: source.sourceRoot
    });
    return {
      identities,
      ok: true
    };
  }

  return Object.freeze({
    canEditProjectSettings,
    connectedProjectsState,
    saveConnectedProjectsState,
    collaborationSettingsState,
    saveCollaborationSettingsState,
    savePromptHintsState,
    engineeringProfileState,
    saveEngineeringProfileState,
    previewApplicationIdentitySource,
    previewApplicationIdentitiesState
  });
}

export {
  createProjectSettings
};
