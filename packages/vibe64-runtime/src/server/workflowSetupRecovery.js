import {
  createCommittedGitSourceReader,
  readCommittedProjectConfigFromSource
} from "@local/vibe64-core/server/committedProjectConfig";
import {
  isPlainObject,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  PROJECT_SETUP_KIND_INITIALIZATION,
  PROJECT_SETUP_KIND_SEED,
  projectSetupSessionKind
} from "@local/vibe64-core/shared";
import {
  initializationWorkflowDefinitionIdForRepositoryProfile,
  seedWorkflowDefinitionIdForRepositoryProfile,
  workflowDefinition
} from "./workflow.js";
import {
  SESSION_RECOVERY_CAPABILITY_WORKFLOW_PROGRESS,
  recoverySignature
} from "./sessionRecovery.js";

const WORKFLOW_SETUP_RECOVERY_ID = "workflow_setup_classification";
const RECOVERY_OPTION_KEEP = "keep_current_workflow";
const RECOVERY_OPTION_SWITCH = "switch_workflow";

function workflowStepIds(machine = {}) {
  return (Array.isArray(machine.steps) ? machine.steps : [])
    .map((step) => normalizeText(step?.id))
    .filter(Boolean);
}

function sharedWorkflowPrefix(leftMachine = {}, rightMachine = {}) {
  const left = workflowStepIds(leftMachine);
  const right = workflowStepIds(rightMachine);
  const shared = [];
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      break;
    }
    shared.push(left[index]);
  }
  return shared;
}

function actionIdsForSteps(machine = {}, stepIds = []) {
  const selectedSteps = new Set(stepIds);
  return new Set((Array.isArray(machine.steps) ? machine.steps : [])
    .filter((step) => selectedSteps.has(normalizeText(step?.id)))
    .flatMap((step) => Array.isArray(step.actions) ? step.actions : [])
    .map((action) => normalizeText(action?.id))
    .filter(Boolean));
}

function safeWorkflowTransition(runtime, session = {}, targetWorkflowDefinitionId = "") {
  const currentMachine = runtime.workflowMachineForSession(session);
  const targetMachine = runtime.workflowMachineForDefinition(targetWorkflowDefinitionId);
  const sharedSteps = sharedWorkflowPrefix(currentMachine, targetMachine);
  const currentSteps = workflowStepIds(currentMachine);
  const targetSteps = workflowStepIds(targetMachine);
  const sharedStepSet = new Set(sharedSteps);
  const sharedActionIds = actionIdsForSteps(currentMachine, sharedSteps);
  const currentStepId = currentSteps[sharedSteps.length] || "";
  const targetStepId = targetSteps[sharedSteps.length] || "";
  return {
    allowed: Boolean(
      currentStepId &&
      targetStepId &&
      sharedSteps.length > 0 &&
      normalizeText(session.currentStep) === currentStepId &&
      (session.completedSteps || []).every((stepId) => sharedStepSet.has(normalizeText(stepId))) &&
      (session.actionResults || []).every((result) => sharedActionIds.has(normalizeText(result?.actionId)))
    ),
    currentStepId,
    targetStepId
  };
}

async function inspectStartingWorkflow(runtime, session = {}) {
  const sourceRoot = normalizeText(session.targetRoot);
  const baseCommit = normalizeText(session.metadata?.base_commit);
  if (!sourceRoot || !baseCommit || typeof runtime.adapter?.inspectCommittedWorkflow !== "function") {
    return null;
  }
  const committedConfig = await readCommittedProjectConfigFromSource({
    ref: baseCommit,
    sourceRoot
  });
  const workflow = await runtime.adapter.inspectCommittedWorkflow({
    source: await createCommittedGitSourceReader({ committedConfig })
  });
  return typeof workflow?.seedRequired === "boolean"
    ? {
        baseCommit: normalizeText(committedConfig.commit || baseCommit),
        seedRequired: workflow.seedRequired
      }
    : null;
}

function setupRecoveryDescription(expectedKind = "") {
  if (expectedKind === PROJECT_SETUP_KIND_SEED) {
    return {
      currentLabel: "Create a new app",
      explanation: "This session was saved as a new-app setup, but the repository's starting commit already contains a complete application. Vibe64 can switch the saved workflow without replacing the source clone, branch, or working files.",
      observedLabel: "Existing application",
      targetLabel: "Initialize existing app"
    };
  }
  return {
    currentLabel: "Initialize an existing app",
    explanation: "This session was saved as an existing-app setup, but the repository's starting commit does not contain a complete application. Vibe64 can switch the saved workflow without replacing the source clone, branch, or working files.",
    observedLabel: "New application required",
    targetLabel: "Create new app"
  };
}

function workflowRecoveryTarget(runtime, session = {}, expectedKind = "") {
  const repositoryProfile = normalizeText(session.metadata?.workflow_repository_profile);
  const switchToInitialization = expectedKind === PROJECT_SETUP_KIND_SEED;
  const workflowDefinitionId = switchToInitialization
    ? initializationWorkflowDefinitionIdForRepositoryProfile(repositoryProfile)
    : seedWorkflowDefinitionIdForRepositoryProfile(repositoryProfile);
  const currentDefinition = workflowDefinition(runtime.workflowDefinitionIdForSession(session), {
    workflowRegistry: runtime.workflowRegistry
  });
  const targetDefinition = workflowDefinition(workflowDefinitionId, {
    workflowRegistry: runtime.workflowRegistry
  });
  const transition = safeWorkflowTransition(runtime, session, workflowDefinitionId);
  return {
    metadataNames: [...new Set([
      ...Object.keys(currentDefinition.initialMetadata || {}),
      ...Object.keys(targetDefinition.initialMetadata || {}),
      "workflow_definition",
      "workflow_repository_profile"
    ])],
    stepIds: [...new Set([transition.currentStepId, transition.targetStepId].filter(Boolean))],
    targetDefinition,
    transition,
    workflowDefinitionId
  };
}

async function replaceMetadata(store, sessionId = "", names = [], values = {}) {
  await store.deleteMetadataValues(sessionId, names);
  await Promise.all(names
    .filter((name) => normalizeText(values?.[name]))
    .map((name) => store.writeMetadataValue(sessionId, name, values[name])));
}

async function replaceStepStates(store, sessionId = "", states = {}) {
  const entries = Object.entries(states);
  await store.deleteStepStates(sessionId, entries.map(([stepId]) => stepId));
  await Promise.all(entries
    .filter(([, state]) => isPlainObject(state))
    .map(([stepId, state]) => store.writeStepState(sessionId, stepId, state)));
}

async function restoreArtifacts(store, sessionId = "", artifacts = {}) {
  await Promise.all(Object.entries(artifacts).map(([name, text]) => (
    text === null || text === undefined
      ? store.deleteArtifact(sessionId, name)
      : store.writeArtifact(sessionId, name, text)
  )));
}

function createWorkflowSetupRecoveryProvider() {
  return Object.freeze({
    id: WORKFLOW_SETUP_RECOVERY_ID,

    async inspect({ runtime, session } = {}) {
      if (session?.status !== "active") {
        return null;
      }
      const expectedKind = projectSetupSessionKind(session);
      if (![PROJECT_SETUP_KIND_SEED, PROJECT_SETUP_KIND_INITIALIZATION].includes(expectedKind)) {
        return null;
      }
      const startingWorkflow = await inspectStartingWorkflow(runtime, session);
      const expectedSeedRequired = expectedKind === PROJECT_SETUP_KIND_SEED;
      if (!startingWorkflow || startingWorkflow.seedRequired === expectedSeedRequired) {
        return null;
      }
      const target = workflowRecoveryTarget(runtime, session, expectedKind);
      const description = setupRecoveryDescription(expectedKind);
      const signature = recoverySignature({
        baseCommit: startingWorkflow.baseCommit,
        expectedKind,
        observedSeedRequired: startingWorkflow.seedRequired,
        workflowDefinitionId: runtime.workflowDefinitionIdForSession(session)
      });
      return {
        blockedCapabilities: [SESSION_RECOVERY_CAPABILITY_WORKFLOW_PROGRESS],
        code: "vibe64_session_setup_classification_mismatch",
        details: { target },
        evidence: [
          { label: "Saved workflow", value: description.currentLabel },
          { label: "Starting repository", value: description.observedLabel },
          { label: "Starting commit", value: startingWorkflow.baseCommit.slice(0, 12) }
        ],
        explanation: description.explanation,
        id: WORKFLOW_SETUP_RECOVERY_ID,
        options: [
          ...(target.transition.allowed && runtime.projectRecordPath
            ? [{
                description: `Use “${description.targetLabel}” and preserve this session's source clone, branch, and working files.`,
                id: RECOVERY_OPTION_SWITCH,
                label: `Switch to ${description.targetLabel.toLowerCase()}`,
                recommended: true,
                style: "primary"
              }]
            : []),
          {
            description: `Keep “${description.currentLabel}” for this session. Vibe64 will remember that decision for this exact mismatch.`,
            id: RECOVERY_OPTION_KEEP,
            label: "Keep current setup",
            recommended: false,
            style: "secondary"
          }
        ],
        signature,
        title: "Saved setup no longer matches the repository"
      };
    },

    async capture({ runtime, session, issue, option } = {}) {
      if (normalizeText(option?.id) !== RECOVERY_OPTION_SWITCH) {
        return null;
      }
      const target = issue.details.target;
      return {
        artifacts: {
          issue_word: await runtime.store.readArtifact(session.sessionId, "issue_word"),
          work_word: await runtime.store.readArtifact(session.sessionId, "work_word")
        },
        currentStep: session.currentStep,
        metadata: Object.fromEntries(target.metadataNames.map((name) => [name, session.metadata?.[name]])),
        promptContextSnapshot: session.promptContextSnapshot,
        stepStates: Object.fromEntries(await Promise.all(target.stepIds.map(async (stepId) => (
          [stepId, await runtime.store.readStepState(session.sessionId, stepId)]
        )))),
        target
      };
    },

    async apply({ runtime, session, issue, option } = {}) {
      if (normalizeText(option?.id) === RECOVERY_OPTION_KEEP) {
        return {
          message: "Kept the current setup workflow. Vibe64 will not ask again unless the underlying state changes."
        };
      }
      const target = issue.details.target;
      if (!target.transition.allowed) {
        throw vibe64Error(
          "This session has progressed too far to switch workflows in place. Its source and branch remain safe.",
          "vibe64_session_recovery_transition_unsafe"
        );
      }
      const targetMetadata = runtime.sessionMetadataWithWorkflowDefinition({
        ...session.metadata,
        ...(target.targetDefinition.initialMetadata || {})
      }, target.workflowDefinitionId);
      await replaceMetadata(runtime.store, session.sessionId, target.metadataNames, targetMetadata);
      await runtime.store.deleteStepStates(session.sessionId, target.stepIds);
      await runtime.store.deletePromptContextSnapshot(session.sessionId);
      await runtime.store.writeCurrentStep(session.sessionId, target.transition.targetStepId);
      await runtime.writeInitialSessionArtifacts(session.sessionId, target.workflowDefinitionId);
      return {
        message: `Switched this session to “${target.targetDefinition.label}”. The source clone, branch, completed source preparation, and working files were preserved.`
      };
    },

    async restore({ runtime, session, snapshot } = {}) {
      await replaceMetadata(
        runtime.store,
        session.sessionId,
        snapshot.target.metadataNames,
        snapshot.metadata
      );
      await replaceStepStates(runtime.store, session.sessionId, snapshot.stepStates);
      await runtime.store.deletePromptContextSnapshot(session.sessionId);
      if (isPlainObject(snapshot.promptContextSnapshot)) {
        await runtime.store.writePromptContextSnapshot(session.sessionId, snapshot.promptContextSnapshot);
      }
      await Promise.all([
        runtime.store.writeCurrentStep(session.sessionId, snapshot.currentStep),
        restoreArtifacts(runtime.store, session.sessionId, snapshot.artifacts)
      ]);
    }
  });
}

export {
  RECOVERY_OPTION_KEEP,
  RECOVERY_OPTION_SWITCH,
  WORKFLOW_SETUP_RECOVERY_ID,
  createWorkflowSetupRecoveryProvider
};
