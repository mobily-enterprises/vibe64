import { vibe64Error } from "@local/vibe64-core/server/core";
import { assertProjectDirectoryUsable } from "@local/vibe64-core/server/studioProjectContext";
import { bindingValuePresent, requiredAlternative } from "./resourceEnvironment.js";
import { runProjectSourceExclusive as runProjectSourceMutationExclusive } from "./projectSourceMutationLock.js";

/** @typedef {import("./types.js").ProjectSelection} ProjectSelection */
/** @typedef {import("./types.js").ProjectSessionWork} ProjectSessionWork */
/** @typedef {import("./types.js").ProjectEnvironment} ProjectEnvironment */

/**
 * A session's onboarding: what the project's source is ready for, the starters it may
 * take with the Env they still need, and applying one.
 * @param {object} dependencies
 * @param {typeof import("@local/vibe64-genesis/server").applyGenesisTemplate} dependencies.applyTemplate
 * @param {ProjectEnvironment} dependencies.environment
 * @param {typeof import("@local/vibe64-genesis/server").inspectGenesisProject} dependencies.inspectProject
 * @param {typeof import("@local/vibe64-genesis/server").listGenesisTemplates} dependencies.listTemplates
 * @param {ProjectSelection} dependencies.selection
 * @param {ProjectSessionWork} dependencies.sessionWork
 */
function createProjectOnboarding({ applyTemplate, environment, inspectProject, listTemplates, selection, sessionWork }) {
  async function projectOnboardingState(input = {}) {
    const source = await selection.genesisSettingsSourceForInput(input);
    if (!source.sourceRoot) {
      return { ok: true, available: false, templates: [], source: { sessionId: source.sessionId } };
    }
    await assertProjectDirectoryUsable(source.sourceRoot);
    const inspection = await inspectProject({ projectRoot: source.sourceRoot });
    const catalogue = inspection.templateEligible
      ? await listTemplates({ projectRoot: source.sourceRoot })
      : { templates: [] };
    const templates = input.templateId
      ? catalogue.templates.filter((template) => template.id === input.templateId)
      : catalogue.templates;
    const pageTemplates = input.templateOffset !== undefined || Boolean(input.templateId);
    const templateOffset = input.templateOffset || 0;
    let environmentSetup = null;
    if (inspection.state === "ready") {
      const resolved = await environment.resolvedProjectEnvironment(input, await environment.userEnvRecords());
      const missingKeys = new Set();
      const resourcesToCheck = resolved.resourcesPrepared ? resolved.resources : [];
      for (const { resource } of resourcesToCheck) {
        const alternative = requiredAlternative(resource, resolved.effectiveEnvironment);
        for (const [semantic, name] of Object.entries(alternative?.bindings || {})) {
          if (!bindingValuePresent(resolved.effectiveEnvironment, semantic, name, alternative.allowEmpty || [])) {
            missingKeys.add(name);
          }
        }
      }
      environmentSetup = { missingKeys: [...missingKeys], warning: resolved.warning };
    }
    return {
      ok: true,
      available: true,
      inspection,
      environmentSetup,
      templates: pageTemplates ? templates.slice(templateOffset, templateOffset + 10) : templates,
      ...(pageTemplates ? { templateOffset, templateTotal: templates.length } : {}),
      source: { rootKind: source.rootKind, sessionId: source.sessionId }
    };
  }

  async function applyProjectTemplateState(input = {}) {
    const sessionId = String(input.sessionId || "").trim();
    const templateId = String(input.templateId || "").trim();
    if (!sessionId || !templateId) {
      throw vibe64Error("Choose a template in an open session first.", "vibe64_template_selection_required");
    }
    return sessionWork.runSessionSourceWorkExclusive({ sessionId }, async () => {
      const session = await selection.sessionStore().readSession(sessionId);
      if (session.status !== "active" || session.agentRuns.some((run) => run.active)) {
        throw vibe64Error("Wait for the active work to finish before adding a starter.", "vibe64_template_session_busy");
      }
      const source = await selection.sourceForInput({ sessionId });
      if (!source.sourceRoot) {
        throw vibe64Error("This session has no available source.", "vibe64_template_source_required");
      }
      await assertProjectDirectoryUsable(source.sourceRoot);
      return runProjectSourceMutationExclusive(selection.selectedProjectRuntimeRoot(), async () => {
        // The browser selects a configured identity; it cannot supply a repository or ref.
        const application = await applyTemplate({ projectRoot: source.sourceRoot, templateId });
        return {
          ok: true,
          application,
          projectSlug: selection.currentProjectSlug()
        };
      }, { operation: "apply-project-template" });
    }, "apply-project-template", { waitMs: 10_000 });
  }

  return Object.freeze({
    projectOnboardingState,
    applyProjectTemplateState
  });
}

export {
  createProjectOnboarding
};
