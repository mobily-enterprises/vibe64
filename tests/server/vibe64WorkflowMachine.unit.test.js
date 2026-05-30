import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_SESSION_STATUS,
  VIBE64_WORKFLOW_DEFINITION_IDS,
  Vibe64SessionRuntime,
  DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
  WorkflowMachine,
  applyWorkflowPresentation,
  createCoreWorkflowRegistry,
  defineWorkflow,
  when,
  workflowGroup,
  workflowWhen,
  workflowForDefinition
} from "@local/vibe64-runtime/server";
import {
  FakeTargetAdapter,
  PromptRenderer,
  runVibe64WorkflowSessionAction
} from "@local/vibe64-adapters/server";
import {
  VIBE64_ACTION_DISPATCH_ROUTES,
  VIBE64_CLIENT_CONTROL_ACTIONS,
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  VIBE64_CLIENT_CONTROL_STATE_FLAGS
} from "@local/vibe64-core/shared";
import {
  _testing as workflowRegistryTesting
} from "@local/vibe64-runtime/server/workflowRegistry";
import {
  currentStepInputConversationText,
  currentStepPromptInputInstruction,
  recordStepMachineActionFinished,
  recordStepMachineActionStarted
} from "@local/vibe64-runtime/server/workflowStepMachines";
import {
  _testing as coreCodingTesting
} from "@local/vibe64-runtime/server/workflowModules/coreCoding";
import {
  _testing as coreLifecycleTesting
} from "@local/vibe64-runtime/server/workflowModules/coreLifecycle";
import {
  _testing as coreMaintenanceTesting
} from "@local/vibe64-runtime/server/workflowModules/coreMaintenance";
import {
  questionBatchLimitInstruction
} from "@local/vibe64-adapters/server/promptQuestionPolicy";
import { withTemporaryRoot, worktreeMetadata } from "./vibe64TestHelpers.js";

const maintenanceModuleId = coreMaintenanceTesting.moduleId;
const maintenanceWorkflowDefinitionIds = coreMaintenanceTesting.workflowDefinitionIds;
const codingModuleId = coreCodingTesting.moduleId;
const lifecycleModuleId = coreLifecycleTesting.moduleId;
const presentationGroups = Object.freeze(["decision", "stop"]);
const actionDispatchRoutes = Object.freeze(new Set(Object.values(VIBE64_ACTION_DISPATCH_ROUTES)));
const clientControlActions = Object.freeze(new Set(Object.values(VIBE64_CLIENT_CONTROL_ACTIONS)));
const clientControlIconTokens = Object.freeze(new Set(Object.values(VIBE64_CLIENT_CONTROL_ICON_TOKENS)));
const clientControlStateFlags = Object.freeze(new Set(Object.values(VIBE64_CLIENT_CONTROL_STATE_FLAGS)));
const builtinIntentTypes = Object.freeze(new Set(["action", "continue", "reject"]));

test("current step conversation text keeps a last-resort completion fallback", () => {
  assert.equal(currentStepInputConversationText({
    workflowStepMachineForStep: () => null
  }, {
    currentStep: "unknown_step"
  }, {
    kind: "ready",
    source: "codex",
    stepId: "unknown_step",
    stepStatus: "awaiting_agent_result"
  }), "Completed this step.");

  assert.equal(currentStepInputConversationText({
    workflowStepMachineForStep: () => ({
      inputCompletionMessage: () => "Step-specific completion."
    })
  }, {
    currentStep: "known_step"
  }, {
    kind: "ready",
    source: "codex",
    stepId: "known_step",
    stepStatus: "awaiting_agent_result"
  }), "Step-specific completion.");
});
const coreWorkflowRegistry = createCoreWorkflowRegistry();

function coreWorkflowForDefinition(definitionId = DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID) {
  return workflowForDefinition(definitionId, {
    workflowRegistry: coreWorkflowRegistry
  });
}

const coreWorkflowStepMachineRuntime = Object.freeze({
  workflowStepMachineForStep: (stepId = "") => coreWorkflowRegistry.machineForStep(stepId)
});

class PromptRendererFakeAdapter extends FakeTargetAdapter {
  constructor({
    promptPackRoot,
    systemPromptPackRoot,
    ...options
  } = {}) {
    super(options);
    this.renderer = new PromptRenderer({
      promptPackRoot,
      ...(systemPromptPackRoot === undefined ? {} : { systemPromptPackRoot })
    });
  }

  async renderPrompt({
    action = {},
    config = {},
    input = {},
    session = {}
  } = {}) {
    return this.renderer.renderPrompt({
      action,
      config,
      input,
      session
    });
  }
}

class SeedRequiredFakeAdapter extends FakeTargetAdapter {
  async inspect(context = {}) {
    return {
      ...await super.inspect(context),
      workflow: {
        seedRequired: true
      }
    };
  }
}

function normalizedText(value = "") {
  return String(value ?? "").trim();
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function conditionReferences(condition = {}, refs = []) {
  const conditionObject = objectRecord(condition);
  switch (normalizedText(conditionObject.kind)) {
    case "any":
      arrayValue(conditionObject.conditions).forEach((entry) => {
        conditionReferences(entry, refs);
      });
      return refs;
    case "step_completed":
      refs.push({
        id: normalizedText(conditionObject.stepId),
        kind: "step"
      });
      return refs;
    case "action_input_exists":
      refs.push({
        id: normalizedText(conditionObject.actionId),
        kind: "action"
      });
      return refs;
    default:
      return refs;
  }
}

function conditionListReferences(conditions = []) {
  return arrayValue(conditions).flatMap((condition) => conditionReferences(condition));
}

function addMissingReference(failures, {
  context = "",
  id = "",
  kind = ""
} = {}) {
  failures.push(`${context} references unknown ${kind}: ${id || "(empty)"}`);
}

function requireStepReference(failures, stepIds, stepId = "", context = "") {
  const normalizedStepId = normalizedText(stepId);
  if (!normalizedStepId || !stepIds.has(normalizedStepId)) {
    addMissingReference(failures, {
      context,
      id: normalizedStepId,
      kind: "step"
    });
  }
}

function requireActionReference(failures, actionIds, actionId = "", context = "") {
  const normalizedActionId = normalizedText(actionId);
  if (!normalizedActionId || !actionIds.has(normalizedActionId)) {
    addMissingReference(failures, {
      context,
      id: normalizedActionId,
      kind: "action"
    });
  }
}

function validateConditionReferences(failures, {
  actionIds,
  conditions = [],
  context = "",
  stepIds
} = {}) {
  for (const ref of conditionListReferences(conditions)) {
    if (ref.kind === "step") {
      requireStepReference(failures, stepIds, ref.id, context);
    }
    if (ref.kind === "action") {
      requireActionReference(failures, actionIds, ref.id, context);
    }
  }
}

function validateActionDispatchRoute(failures, action = {}, context = "") {
  const route = normalizedText(action.dispatchRoute);
  if (!route) {
    return;
  }
  if (!actionDispatchRoutes.has(route)) {
    failures.push(`${context}.dispatchRoute uses unknown action dispatch route: ${route || "(empty)"}`);
  }
}

function validateClientControl(failures, control = {}, context = "") {
  const controlObject = objectRecord(control);
  const action = normalizedText(controlObject.action);
  if (action && !clientControlActions.has(action)) {
    failures.push(`${context}.action uses unknown client control action: ${action}`);
  }
  const icon = normalizedText(controlObject.icon);
  if (icon && !clientControlIconTokens.has(icon)) {
    failures.push(`${context}.icon uses unknown client control icon token: ${icon}`);
  }
  for (const flag of arrayValue(controlObject.disabledWhen).map(normalizedText).filter(Boolean)) {
    if (!clientControlStateFlags.has(flag)) {
      failures.push(`${context}.disabledWhen uses unknown client control state flag: ${flag}`);
    }
  }
  for (const flag of arrayValue(controlObject.loadingWhen).map(normalizedText).filter(Boolean)) {
    if (!clientControlStateFlags.has(flag)) {
      failures.push(`${context}.loadingWhen uses unknown client control state flag: ${flag}`);
    }
  }
}

function validateSessionPresentationControls(failures, session = {}, context = "session presentation") {
  arrayValue(session.intents).forEach((intent, index) => {
    const control = objectRecord(intent).control;
    if (Object.keys(objectRecord(control)).length > 0) {
      validateClientControl(failures, control, `${context}.intents[${index}].control`);
    }
  });
  arrayValue(session.presentation?.backgroundTasks).forEach((task, index) => {
    const control = objectRecord(objectRecord(task).retry).control;
    if (Object.keys(objectRecord(control)).length > 0) {
      validateClientControl(failures, control, `${context}.backgroundTasks[${index}].retry.control`);
    }
  });
}

function validatePresentationIntent(failures, {
  actionIds,
  context = "",
  handlerIntentIds = new Set(),
  intent = {},
  step,
  stepIds
} = {}) {
  const intentObject = objectRecord(intent);
  const intentType = normalizedText(intentObject.type);
  const intentId = normalizedText(intentObject.id);
  if (Object.hasOwn(intentObject, "serverOperation")) {
    failures.push(`${context} must not define serverOperation`);
  }
  if (normalizedText(intentObject.actionId)) {
    requireActionReference(failures, actionIds, intentObject.actionId, `${context}.actionId`);
  }
  if (normalizedText(intentObject.enabledWhenAction)) {
    requireActionReference(failures, actionIds, intentObject.enabledWhenAction, `${context}.enabledWhenAction`);
  }
  if (Object.keys(objectRecord(intentObject.control)).length > 0) {
    validateClientControl(failures, intentObject.control, `${context}.control`);
  }
  if (intentType === "action") {
    requireActionReference(
      failures,
      actionIds,
      intentObject.actionId || step.autopilot?.actionId,
      `${context}.action`
    );
  }
  if (intentType === "reject") {
    requireStepReference(failures, stepIds, step.workflow?.rejectTo, `${context}.rejectTo`);
  }
  if (
    intentId &&
    !builtinIntentTypes.has(intentType) &&
    Object.keys(objectRecord(intentObject.control)).length === 0 &&
    !handlerIntentIds.has(intentId)
  ) {
    failures.push(`${context} has no workflow intent handler for ${intentId}`);
  }
}

function validateWorkflowContract(workflow = {}) {
  const failures = [];
  const stepIds = new Set(arrayValue(workflow.steps).map((step) => normalizedText(step.id)).filter(Boolean));

  for (const step of arrayValue(workflow.steps)) {
    const stepId = normalizedText(step.id);
    const context = `${workflow.id}.${stepId}`;
    const actionIds = new Set(arrayValue(step.actions).map((action) => normalizedText(action.id)).filter(Boolean));
    if (normalizedText(step.workflow?.rejectTo)) {
      requireStepReference(failures, stepIds, step.workflow.rejectTo, `${context}.workflow.rejectTo`);
    }
    if (normalizedText(step.workflow?.recheckTo)) {
      requireStepReference(failures, stepIds, step.workflow.recheckTo, `${context}.workflow.recheckTo`);
    }

    for (const action of arrayValue(step.actions)) {
      validateActionDispatchRoute(failures, action, `${context}.actions.${action.id}`);
      validateConditionReferences(failures, {
        actionIds,
        conditions: action.disabledWhen,
        context: `${context}.actions.${action.id}.disabledWhen`,
        stepIds
      });
      validateConditionReferences(failures, {
        actionIds,
        conditions: action.enabledWhen,
        context: `${context}.actions.${action.id}.enabledWhen`,
        stepIds
      });
    }

    for (const actionId of arrayValue(step.rewindCleanup?.actionResults)) {
      requireActionReference(failures, actionIds, actionId, `${context}.rewindCleanup.actionResults`);
    }

    if (normalizedText(step.autopilot?.actionId)) {
      requireActionReference(failures, actionIds, step.autopilot.actionId, `${context}.autopilot.actionId`);
    }
    validateConditionReferences(failures, {
      actionIds,
      conditions: step.autopilot?.completeWhen,
      context: `${context}.autopilot.completeWhen`,
      stepIds
    });
    arrayValue(step.autopilot?.actionSequence).forEach((action, index) => {
      requireActionReference(failures, actionIds, action.actionId, `${context}.autopilot.actionSequence[${index}]`);
      validateConditionReferences(failures, {
        actionIds,
        conditions: action.completeWhen,
        context: `${context}.autopilot.actionSequence[${index}].completeWhen`,
        stepIds
      });
    });

    validateConditionReferences(failures, {
      actionIds,
      conditions: step.next?.enabledWhen,
      context: `${context}.next.enabledWhen`,
      stepIds
    });
    validateConditionReferences(failures, {
      actionIds,
      conditions: step.next?.visibleWhen,
      context: `${context}.next.visibleWhen`,
      stepIds
    });

    const presentation = objectRecord(step.presentation);
    const allIntentIds = new Set();
    const handlerIntentIds = new Set(Object.keys(objectRecord(workflow.intentHandlers?.[stepId])));
    for (const groupName of presentationGroups) {
      const group = objectRecord(presentation[groupName]);
      const intents = arrayValue(group.intents);
      const groupIntentIds = new Set();
      intents.forEach((intent, index) => {
        const intentId = normalizedText(intent.id);
        if (groupIntentIds.has(intentId)) {
          failures.push(`${context}.presentation.${groupName}.intents has duplicate intent: ${intentId}`);
        }
        groupIntentIds.add(intentId);
        allIntentIds.add(intentId);
        validatePresentationIntent(failures, {
          actionIds,
          context: `${context}.presentation.${groupName}.intents[${index}]`,
          handlerIntentIds,
          intent,
          step,
          stepIds
        });
      });

      const screen = objectRecord(group.screen);
      if (normalizedText(screen.primaryIntentId) && !groupIntentIds.has(normalizedText(screen.primaryIntentId))) {
        addMissingReference(failures, {
          context: `${context}.presentation.${groupName}.screen.primaryIntentId`,
          id: screen.primaryIntentId,
          kind: "intent"
        });
      }
      if (normalizedText(screen.titleActionId)) {
        requireActionReference(failures, actionIds, screen.titleActionId, `${context}.presentation.${groupName}.screen.titleActionId`);
      }
    }

    const recheck = objectRecord(presentation.automation?.recheckAfterPrompt);
    if (normalizedText(recheck.intentId)) {
      const recheckIntentId = normalizedText(recheck.intentId);
      allIntentIds.add(recheckIntentId);
      if (Object.hasOwn(recheck, "serverOperation")) {
        failures.push(`${context}.presentation.automation.recheckAfterPrompt must not define serverOperation`);
      }
      if (!handlerIntentIds.has(recheckIntentId)) {
        failures.push(`${context}.presentation.automation.recheckAfterPrompt has no workflow intent handler for ${recheckIntentId}`);
      }
    }

    const mergeIntent = objectRecord(presentation.automation?.mergeIntent);
    if (Object.keys(mergeIntent).length > 0) {
      requireActionReference(failures, actionIds, mergeIntent.prepareActionId, `${context}.presentation.automation.mergeIntent.prepareActionId`);
      requireActionReference(failures, actionIds, mergeIntent.mergeActionId, `${context}.presentation.automation.mergeIntent.mergeActionId`);
      if (normalizedText(mergeIntent.syncActionId)) {
        requireActionReference(failures, actionIds, mergeIntent.syncActionId, `${context}.presentation.automation.mergeIntent.syncActionId`);
      }
      if (normalizedText(mergeIntent.metadataValue) && !allIntentIds.has(normalizedText(mergeIntent.metadataValue))) {
        addMissingReference(failures, {
          context: `${context}.presentation.automation.mergeIntent.metadataValue`,
          id: mergeIntent.metadataValue,
          kind: "intent"
        });
      }
    }
    for (const handlerIntentId of handlerIntentIds) {
      if (!allIntentIds.has(handlerIntentId)) {
        failures.push(`${context}.intentHandlers.${handlerIntentId} does not match a presented intent`);
      }
    }
  }

  return failures;
}

function presentationSnapshot(session = {}) {
  const nextOperation = session.presentation?.auto?.nextOperation || {};
  const screen = session.presentation?.screen || {};
  return {
    auto: {
      actionId: nextOperation.actionId || "",
      executable: nextOperation.executable === true,
      intentId: nextOperation.intentId || "",
      kind: nextOperation.kind || "",
      reason: nextOperation.reason || "",
      route: nextOperation.route || ""
    },
    enabledIntentIds: (Array.isArray(session.intents) ? session.intents : [])
      .filter((intent) => intent.enabled === true)
      .map((intent) => intent.id),
    intentIds: (Array.isArray(session.intents) ? session.intents : [])
      .map((intent) => intent.id),
    screen: {
      kind: screen.kind || "",
      message: screen.message || "",
      primaryIntentId: screen.primaryIntentId || "",
      sections: (Array.isArray(screen.sections) ? screen.sections : [])
        .map((section) => section.kind),
      title: screen.title || "",
      variant: screen.variant || ""
    },
    step: {
      id: session.presentation?.step?.id || "",
      status: session.presentation?.step?.status || "",
      workflowKind: session.presentation?.step?.workflowKind || ""
    }
  };
}

test("vibe64 runtime session view exposes workflow steps, current actions, and next state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    const session = await runtime.createSession({
      sessionId: "workflow_view"
    });

    assert.equal(session.workflowId, DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID);
    assert.equal(session.currentStep, "session_created");
    assert.deepEqual(session.completedSteps, []);
    assert.equal(session.next.visible, true);
    assert.equal(session.next.enabled, true);
    assert.equal(session.next.stepId, "work_source_selected");
    assert.equal(session.stepDefinitions[0].status, "current");
    assert.equal(session.stepDefinitions[1].label, "Choose starting point");
    assert.deepEqual(session.actions, []);
  });
});

test("vibe64 runtime read views do not persist default or derived step-machine state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      sessionId: "read_pure_step_view"
    });
    await Promise.all([
      runtime.store.writeArtifact("read_pure_step_view", "issue_title", "Title\n"),
      runtime.store.writeArtifact("read_pure_step_view", "issue_word", "Title\n"),
      runtime.store.writeArtifact("read_pure_step_view", "issue.md", "Body\n")
    ]);
    const before = await runtime.store.readSession("read_pure_step_view");

    const session = await runtime.getSession("read_pure_step_view");
    const listed = await runtime.listSessionSummaries();
    const after = await runtime.store.readSession("read_pure_step_view");

    assert.equal(session.stepMachine.status, "confirm_files");
    const listedSession = listed.find((candidate) => candidate.sessionId === "read_pure_step_view");
    assert.equal(listedSession?.currentStep, "issue_file_created");
    assert.equal("stepMachine" in listedSession, false);
    assert.equal("presentation" in listedSession, false);
    assert.equal("artifactReadiness" in listedSession, false);
    assert.equal(await runtime.store.readStepState("read_pure_step_view", "issue_file_created"), null);
    assert.equal(after.revision, before.revision);
    assert.equal(after.updatedAt, before.updatedAt);
  });
});

test("vibe64 runtime keeps evaluated Autopilot state in presentation, not raw step definitions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          run_automated_checks: true,
          update_code_index: true
        }
      }),
      targetRoot
    });

    const session = await runtime.createSession({
      initialStep: "review_and_validate",
      metadata: worktreeMetadata(targetRoot, "autopilot_stage_view"),
      sessionId: "autopilot_stage_view"
    });

    assert.equal("autopilot" in session.currentStepDefinition, false);
    assert.equal("workflowAutopilot" in session, false);
    assert.equal(session.presentation.auto.nextOperation.kind, "action");
    assert.equal(session.presentation.auto.nextOperation.actionId, "run_deslop");
    assert.equal(session.presentation.auto.nextOperation.route, "session-action");

    await runtime.store.writeMetadataValue("autopilot_stage_view", "review_deslop_completed", "yes");
    const afterReview = await runtime.getSession("autopilot_stage_view");
    assert.equal("autopilot" in afterReview.currentStepDefinition, false);
    assert.equal("workflowAutopilot" in afterReview, false);
    assert.equal(afterReview.presentation.auto.nextOperation.kind, "command");
    assert.equal(afterReview.presentation.auto.nextOperation.actionId, "update_code_index");
    assert.equal(afterReview.presentation.auto.nextOperation.route, "command-terminal");

    await runtime.store.writeMetadataValue("autopilot_stage_view", "code_index_updated", "yes");
    const afterCodeIndex = await runtime.getSession("autopilot_stage_view");
    assert.equal("autopilot" in afterCodeIndex.currentStepDefinition, false);
    assert.equal("workflowAutopilot" in afterCodeIndex, false);
    assert.equal(afterCodeIndex.presentation.auto.nextOperation.kind, "command");
    assert.equal(afterCodeIndex.presentation.auto.nextOperation.actionId, "run_automated_checks");
    assert.equal(afterCodeIndex.presentation.auto.nextOperation.route, "command-terminal");

    await runtime.store.writeMetadataValue("autopilot_stage_view", "automated_checks_passed", "yes");
    const afterValidation = await runtime.getSession("autopilot_stage_view");
    assert.equal("autopilot" in afterValidation.currentStepDefinition, false);
    assert.equal("workflowAutopilot" in afterValidation, false);
    assert.equal(afterValidation.presentation.auto.nextOperation.kind, "advance");
    assert.equal(afterValidation.presentation.auto.nextOperation.route, "session-advance");
  });
});

test("vibe64 runtime keeps review validation command failures in the validation phase", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          run_automated_checks: true,
          update_code_index: true
        }
      }),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "review_and_validate",
      metadata: worktreeMetadata(targetRoot, "review_validation_failure"),
      sessionId: "review_validation_failure"
    });
    await runtime.store.writeMetadataValue("review_validation_failure", "review_deslop_completed", "yes");
    const ready = await runtime.getSession("review_validation_failure");
    assert.equal(ready.presentation.auto.nextOperation.actionId, "update_code_index");

    await recordStepMachineActionStarted(runtime, ready, "update_code_index");
    const attempting = await runtime.getSession("review_validation_failure");
    assert.equal(attempting.stepMachine.status, "attempting_execution");
    assert.equal(attempting.stepMachine.phase, "validation");

    await recordStepMachineActionFinished(runtime, attempting, "update_code_index", {
      message: "Index command failed.",
      output: "missing script",
      status: "blocked"
    });
    const failed = await runtime.getSession("review_validation_failure");
    assert.equal(failed.stepMachine.status, "waiting_for_input");
    assert.equal(failed.stepMachine.phase, "validation");
    assert.equal(failed.currentStepDefinition.interaction.kind, "command_failure_response");
    assert.equal(failed.currentStepDefinition.interaction.title, "Validation needs attention");
    assert.equal(failed.presentation.screen.input.submitLabel, "Retry command");
    assert.equal(failed.presentation.screen.input.fields[0].required, false);

    const answered = await runtime.submitCurrentStepInput("review_validation_failure", {
      kind: "user_response",
      source: "user",
      stepId: "review_and_validate",
      stepStatus: "waiting_for_input",
      text: "Install the missing script and retry."
    });
    assert.equal(answered.stepMachine.status, "ready");
    assert.equal(answered.stepMachine.phase, "validation");
    assert.equal(answered.presentation.auto.nextOperation.actionId, "update_code_index");
  });
});

test("vibe64 runtime exposes server-owned presentation and intents for Autopilot stops", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    const session = await runtime.createSession({
      initialStep: "implementation_reviewed",
      sessionId: "presentation_review"
    });

    assert.equal(session.presentation.screen.kind, "review");
    assert.equal(session.presentation.screen.title, "Initial human review");
    assert.equal(session.presentation.screen.primaryIntentId, "request_review_tweak");
    assert.equal(session.presentation.screen.variant, "implementation");
    assert.equal(session.presentation.prompt.state, "idle");
    assert.equal(session.presentation.actions, session.actions);
    assert.equal(session.presentation.next, session.next);
    assert.deepEqual(session.intents.map((intent) => intent.id), [
      "open_diff",
      "accept_review",
      "request_review_tweak"
    ]);
    assert.deepEqual(session.intents.find((intent) => intent.id === "open_diff")?.control, {
      action: VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF,
      disabledWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_DISABLED],
      icon: VIBE64_CLIENT_CONTROL_ICON_TOKENS.DIFF,
      loadingWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_LOADING]
    });
    assert.equal(session.presentation.auto.nextOperation.kind, "wait");
    assert.equal(session.presentation.auto.nextOperation.executable, false);
    assert.equal(session.presentation.auto.nextOperation.reason, "user");

    await runtime.store.writeStepState("presentation_review", "implementation_reviewed", {
      schemaVersion: 1,
      status: "done"
    });
    const completedReview = await runtime.getSession("presentation_review");
    assert.equal(completedReview.presentation.screen.kind, "review");
    assert.equal(completedReview.presentation.screen.primaryIntentId, "request_review_tweak");
    assert.deepEqual(completedReview.intents.map((intent) => intent.id), [
      "open_diff",
      "accept_review",
      "request_review_tweak"
    ]);
    assert.equal(completedReview.presentation.auto.nextOperation.kind, "wait");
    assert.equal(completedReview.presentation.auto.nextOperation.reason, "user");
  });
});

test("vibe64 runtime auto-advances completed non-persistent Autopilot stops", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...worktreeMetadata(targetRoot, "presentation_existing_issue"),
        github_issue_mode: "reuse",
        issue_url: "https://github.com/example/project/issues/12",
        work_source: "existing_issue"
      },
      sessionId: "presentation_existing_issue"
    });
    await Promise.all([
      runtime.store.writeArtifact("presentation_existing_issue", "issue_title", "Add saved reports\n"),
      runtime.store.writeArtifact("presentation_existing_issue", "issue_word", "reports\n"),
      runtime.store.writeArtifact("presentation_existing_issue", "issue.md", "Add saved reports.\n")
    ]);

    const session = await runtime.getSession("presentation_existing_issue");

    assert.equal(session.currentStep, "issue_file_created");
    assert.equal(session.stepMachine.status, "done");
    assert.equal(session.next.enabled, true);
    assert.equal(session.presentation.auto.nextOperation.kind, "advance");
    assert.equal(session.presentation.auto.nextOperation.executable, true);
    assert.equal(session.presentation.auto.nextOperation.route, "session-advance");
  });
});

test("vibe64 runtime presentation exposes durable background task status", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    await runtime.createSession({
      sessionId: "presentation_background_task"
    });
    await runtime.store.writeBackgroundTaskEvent("presentation_background_task", "codex_bootstrap", {
      event: {
        kind: "failed"
      },
      patch: {
        error: "Create the session worktree before starting Codex.",
        kind: "codex_bootstrap",
        label: "Codex bootstrap",
        message: "Codex bootstrap failed.",
        retry: {
          control: {
            action: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
          },
          label: "Retry Codex"
        },
        status: "failed"
      }
    });

    const session = await runtime.getSession("presentation_background_task");
    assert.deepEqual(session.presentation.backgroundTasks, [
      {
        error: "Create the session worktree before starting Codex.",
        finishedAt: session.presentation.backgroundTasks[0].finishedAt,
        id: "codex_bootstrap",
        kind: "codex_bootstrap",
        label: "Codex bootstrap",
        message: "Codex bootstrap failed.",
        retry: null,
        startedAt: session.presentation.backgroundTasks[0].startedAt,
        status: "failed",
        terminalSessionId: "",
        updatedAt: session.presentation.backgroundTasks[0].updatedAt
      }
    ]);

    await runtime.createSession({
      metadata: worktreeMetadata(targetRoot, "presentation_background_task_retryable"),
      sessionId: "presentation_background_task_retryable"
    });
    await runtime.store.writeBackgroundTaskEvent("presentation_background_task_retryable", "codex_bootstrap", {
      event: {
        kind: "failed"
      },
      patch: {
        error: "Terminal session not found.",
        kind: "codex_bootstrap",
        label: "Codex bootstrap",
        message: "Codex bootstrap failed.",
        retry: {
          control: {
            action: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
          },
          label: "Retry Codex"
        },
        status: "failed"
      }
    });

    const retryableSession = await runtime.getSession("presentation_background_task_retryable");
    assert.deepEqual(retryableSession.presentation.backgroundTasks[0].retry, {
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL,
        disabledWhen: [],
        icon: "",
        loadingWhen: []
      },
      label: "Retry Codex"
    });
  });
});

test("vibe64 runtime presentation emits only declared client controls", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    await runtime.createSession({
      initialStep: "implementation_reviewed",
      metadata: worktreeMetadata(targetRoot, "presentation_client_controls"),
      sessionId: "presentation_client_controls"
    });
    await runtime.store.writeBackgroundTaskEvent("presentation_client_controls", "codex_bootstrap", {
      event: {
        kind: "failed"
      },
      patch: {
        retry: {
          control: {
            action: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
          },
          label: "Retry Codex"
        },
        status: "failed"
      }
    });

    const session = await runtime.getSession("presentation_client_controls");
    const failures = [];
    validateSessionPresentationControls(failures, session);

    assert.deepEqual(failures, []);
  });
});

test("vibe64 runtime presentation snapshots come from workflow step metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const changesAcceptedStep = coreWorkflowForDefinition().steps.find((step) => step.id === "changes_accepted");
    assert.deepEqual(
      changesAcceptedStep.presentation.automation.recheckAfterPrompt,
      {
        intentId: "recheck_after_final_tweak",
        label: "Recheck changes",
        metadataName: "autopilot_final_review_followup",
        metadataValue: "recheck",
        promptComplete: true,
        statuses: ["ready", "done"]
      }
    );

    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          finish_session: true,
          merge_pr: true
        }
      }),
      targetRoot
    });

    const implementationReview = await runtime.createSession({
      initialStep: "implementation_reviewed",
      metadata: worktreeMetadata(targetRoot, "presentation_snapshot_implementation_review"),
      sessionId: "presentation_snapshot_implementation_review"
    });
    const maintenanceConversation = await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: worktreeMetadata(targetRoot, "presentation_snapshot_conversation"),
      sessionId: "presentation_snapshot_conversation",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });
    const optionalCheck = await runtime.createSession({
      initialStep: "deep_ui_check_run",
      metadata: worktreeMetadata(targetRoot, "presentation_snapshot_decision"),
      sessionId: "presentation_snapshot_decision"
    });
    const finalReview = await runtime.createSession({
      initialStep: "changes_accepted",
      metadata: worktreeMetadata(targetRoot, "presentation_snapshot_final_review"),
      sessionId: "presentation_snapshot_final_review"
    });
    const mergeReview = await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...worktreeMetadata(targetRoot, "presentation_snapshot_merge"),
        pr_url: "https://github.com/example/project/pull/3"
      },
      sessionId: "presentation_snapshot_merge"
    });
    const finished = await runtime.createSession({
      initialStep: "local_session_finished",
      sessionId: "presentation_snapshot_finished",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });

    assert.deepEqual({
      finalReview: presentationSnapshot(finalReview),
      finished: presentationSnapshot(finished),
      implementationReview: presentationSnapshot(implementationReview),
      maintenanceConversation: presentationSnapshot(maintenanceConversation),
      mergeReview: presentationSnapshot(mergeReview),
      optionalCheck: presentationSnapshot(optionalCheck)
    }, {
      finalReview: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: [
          "open_diff",
          "accept_review",
          "request_review_tweak",
          "reject"
        ],
        intentIds: [
          "open_diff",
          "accept_review",
          "request_review_tweak",
          "reject"
        ],
        screen: {
          kind: "review",
          message: "Review the validated work before Autopilot writes the report and commits.",
          primaryIntentId: "request_review_tweak",
          sections: [
            "launch_controls",
            "report_preview",
            "response_preview"
          ],
          title: "Final human review",
          variant: "final"
        },
        step: {
          id: "changes_accepted",
          status: "ready",
          workflowKind: "final_review"
        }
      },
      finished: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: ["archive_session"],
        intentIds: ["archive_session"],
        screen: {
          kind: "finished",
          message: "The session is complete.",
          primaryIntentId: "",
          sections: ["report_preview"],
          title: "Congratulations!",
          variant: ""
        },
        step: {
          id: "local_session_finished",
          status: "ready",
          workflowKind: "finished"
        }
      },
      implementationReview: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: [
          "open_diff",
          "accept_review",
          "request_review_tweak"
        ],
        intentIds: [
          "open_diff",
          "accept_review",
          "request_review_tweak"
        ],
        screen: {
          kind: "review",
          message: "Try the work now. Ask Codex for small tweaks, or continue when it looks right.",
          primaryIntentId: "request_review_tweak",
          sections: [
            "launch_controls",
            "report_preview",
            "response_preview"
          ],
          title: "Initial human review",
          variant: "implementation"
        },
        step: {
          id: "implementation_reviewed",
          status: "ready",
          workflowKind: "implementation_review"
        }
      },
      maintenanceConversation: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: ["talk_to_codex"],
        intentIds: [
          "talk_to_codex",
          "continue_step"
        ],
        screen: {
          kind: "conversation",
          message: "Ask Codex for changes. Continue when the work is ready for the next workflow step.",
          primaryIntentId: "talk_to_codex",
          sections: ["response_preview"],
          title: "Talk to Codex",
          variant: ""
        },
        step: {
          id: "maintenance_conversation",
          status: "ready",
          workflowKind: "agent_conversation"
        }
      },
      mergeReview: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: [
          "merge_and_sync",
          "skip_merge"
        ],
        intentIds: [
          "merge_and_sync",
          "skip_merge"
        ],
        screen: {
          kind: "merge",
          message: "The pull request is ready. Merge it and update the main checkout, or finish without merging.",
          primaryIntentId: "",
          sections: ["report_preview"],
          title: "Merge pull request?",
          variant: ""
        },
        step: {
          id: "create_and_merge_pull_request",
          status: "ready",
          workflowKind: "merge_review"
        }
      },
      optionalCheck: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "decision",
          route: ""
        },
        enabledIntentIds: [
          "run_optional_check",
          "skip_optional_check"
        ],
        intentIds: [
          "run_optional_check",
          "skip_optional_check"
        ],
        screen: {
          kind: "decision",
          message: "This optional check can take a long time. Run it now, or skip it and continue.",
          primaryIntentId: "",
          sections: [],
          title: "Check user interface?",
          variant: ""
        },
        step: {
          id: "deep_ui_check_run",
          status: "ready",
          workflowKind: ""
        }
      }
    });
  });
});

test("vibe64 runtime presentation uses the workflow instance metadata as the step contract", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot,
      workflow: {
        id: "custom_presentation_contract",
        steps: [
          {
            actions: [
              {
                id: "custom_action",
                label: "Custom action",
                type: "adapter"
              }
            ],
            autopilot: {
              stop: true
            },
            id: "custom_step",
            label: "Custom step",
            next: {
              visible: false
            },
            presentation: {
              stop: {
                intents: [
                  {
                    actionId: "custom_action",
                    id: "custom_action_intent",
                    label: "Run custom action",
                    type: "action"
                  }
                ],
                screen: {
                  kind: "custom_stop",
                  message: "Custom workflow presentation.",
                  title: "Custom workflow"
                }
              }
            }
          }
        ]
      }
    });

    const session = await runtime.createSession({
      sessionId: "custom_presentation_contract"
    });

    assert.equal(session.presentation.screen.kind, "custom_stop");
    assert.equal(session.presentation.screen.title, "Custom workflow");
    assert.equal(session.intents[0].id, "custom_action_intent");
    assert.equal("workflowPresentation" in session, false);
  });
});

test("vibe64 runtime exposes server-owned action icon hints", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    const session = await runtime.createSession({
      initialStep: "worktree_created",
      sessionId: "presentation_action_icons"
    });

    assert.equal(session.actions.find((action) => action.id === "create_worktree")?.icon, "sync");
    assert.equal(session.actions.find((action) => action.id === "create_worktree")?.dispatchRoute, "command-terminal");
    assert.equal(session.currentStepDefinition.actions.find((action) => action.id === "create_worktree")?.icon, "sync");
    assert.equal(session.currentStepDefinition.actions.find((action) => action.id === "create_worktree")?.dispatchRoute, "command-terminal");
  });
});

test("vibe64 runtime exposes and runs the server-owned conversation intent", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const promptPackRoot = path.join(targetRoot, "prompt-pack");
    await mkdir(promptPackRoot, {
      recursive: true
    });
    await writeFile(
      path.join(promptPackRoot, "agent_conversation.txt"),
      [
        "Agent conversation"
      ].join("\n"),
      "utf8"
    );

    const runtime = new Vibe64SessionRuntime({
      adapter: new PromptRendererFakeAdapter({
        promptPackRoot
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: worktreeMetadata(targetRoot, "presentation_conversation_intent"),
      sessionId: "presentation_conversation_intent",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });

    const session = await runtime.getSession("presentation_conversation_intent");
    assert.equal(session.presentation.screen.kind, "conversation");
    assert.equal(session.presentation.screen.primaryIntentId, "talk_to_codex");
    assert.deepEqual(session.intents.map((intent) => intent.id), [
      "talk_to_codex",
      "continue_step"
    ]);
    assert.equal(
      session.intents.find((intent) => intent.id === "talk_to_codex")?.inputFields[0]?.name,
      "conversationRequest"
    );

    const afterIntent = await runtime.runIntent("presentation_conversation_intent", "talk_to_codex", {
      fields: {
        conversationRequest: "Explain this codebase."
      },
      stepId: session.currentStep,
      stepStatus: session.stepMachine.status
    });

    assert.equal(afterIntent.actionResult.status, "prompt_ready");
    assert.equal(afterIntent.actionResult.promptId, "agent_conversation");
    assert.equal(afterIntent.actionResult.recordsConversationTurn, true);
    assert.match(
      afterIntent.actionResult.codexPromptHandoff.terminalInput,
      /^Explain this codebase\.\n\n\[\[VIBE64_CONTEXT_START\]\]/u
    );

    await runtime.store.writeStepState("presentation_conversation_intent", "maintenance_conversation", {
      schemaVersion: 1,
      status: "done"
    });
    const completedConversation = await runtime.getSession("presentation_conversation_intent");
    assert.equal(completedConversation.presentation.screen.kind, "conversation");
    assert.equal(completedConversation.presentation.screen.primaryIntentId, "talk_to_codex");
    assert.deepEqual(completedConversation.intents.map((intent) => intent.id), [
      "talk_to_codex",
      "continue_step"
    ]);
  });
});

test("vibe64 runtime runs server-owned intents and rejects stale intent submissions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    await runtime.createSession({
      initialStep: "deep_ui_check_run",
      sessionId: "presentation_intents"
    });
    const session = await runtime.getSession("presentation_intents");

    assert.equal(session.presentation.screen.kind, "decision");
    const skipped = await runtime.runIntent("presentation_intents", "skip_optional_check", {
      stepId: session.currentStep,
      stepStatus: session.stepMachine.status
    });
    assert.equal(skipped.currentStep, "review_and_validate");

    await assert.rejects(
      () => runtime.runIntent("presentation_intents", "skip_optional_check", {
        stepId: "deep_ui_check_run",
        stepStatus: session.stepMachine.status
      }),
      /not available|Reload state/u
    );
  });
});

test("vibe64 runtime auto-continues completed optional UI checks", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    await runtime.createSession({
      initialStep: "deep_ui_check_run",
      metadata: worktreeMetadata(targetRoot, "completed_optional_ui_check"),
      sessionId: "completed_optional_ui_check"
    });
    await runtime.runAction("completed_optional_ui_check", "run_deep_ui_check");
    const completed = await runtime.submitCurrentStepInput("completed_optional_ui_check", {
      kind: "ready",
      source: "codex",
      stepId: "deep_ui_check_run",
      stepStatus: "awaiting_agent_result"
    });

    assert.equal(completed.currentStep, "deep_ui_check_run");
    assert.equal(completed.stepMachine.status, "done");
    assert.equal(completed.presentation.screen.kind, "ready");
    assert.equal(completed.presentation.screen.message, "The user interface check is done.");
    assert.equal(completed.presentation.auto.nextOperation.kind, "advance");
    assert.equal(completed.presentation.auto.nextOperation.executable, true);
  });
});

test("vibe64 runtime owns final-review follow-up and merge decision intents", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          merge_pr: true,
          sync_main_checkout: true
        }
      }),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "changes_accepted",
      metadata: worktreeMetadata(targetRoot, "presentation_final_review_intents"),
      sessionId: "presentation_final_review_intents"
    });
    await runtime.store.writeCompletedStep("presentation_final_review_intents", "review_and_validate", {
      message: "Review completed before final tweaks."
    });
    const finalReview = await runtime.getSession("presentation_final_review_intents");
    const tweak = await runtime.runIntent("presentation_final_review_intents", "request_review_tweak", {
      fields: {
        feedback: "Tighten the final copy."
      },
      stepId: finalReview.currentStep,
      stepStatus: finalReview.stepMachine.status
    });
    assert.equal(tweak.actionResult.actionType, "prompt");
    assert.equal(
      await runtime.store.readMetadataValue("presentation_final_review_intents", "autopilot_final_review_followup"),
      "recheck"
    );
    await runtime.store.writeStepState("presentation_final_review_intents", "changes_accepted", {
      promptComplete: true,
      schemaVersion: 1,
      status: "ready"
    });
    const recheckReady = await runtime.getSession("presentation_final_review_intents");
    assert.equal(recheckReady.presentation.auto.nextOperation.kind, "intent");
    assert.equal(recheckReady.presentation.auto.nextOperation.intentId, "recheck_after_final_tweak");
    const rechecked = await runtime.runIntent("presentation_final_review_intents", "recheck_after_final_tweak", {
      stepId: recheckReady.currentStep,
      stepStatus: recheckReady.stepMachine.status
    });
    assert.equal(rechecked.currentStep, "review_and_validate");
    assert.equal(
      await runtime.store.readMetadataValue("presentation_final_review_intents", "autopilot_final_review_followup"),
      ""
    );

    await runtime.createSession({
      initialStep: "changes_accepted",
      metadata: worktreeMetadata(targetRoot, "big_feature_reject"),
      sessionId: "big_feature_reject"
    });
    await runtime.store.writeCompletedStep("big_feature_reject", "plan_and_execute", {
      message: "Plan and implementation were completed before final review."
    });
    const bigFeatureRejectReady = await runtime.getSession("big_feature_reject");
    const bigFeatureRejected = await runtime.runIntent("big_feature_reject", "reject", {
      fields: {
        feedback: "Plan a simpler version."
      },
      stepId: bigFeatureRejectReady.currentStep,
      stepStatus: bigFeatureRejectReady.stepMachine.status
    });
    assert.equal(bigFeatureRejected.currentStep, "plan_and_execute");
    assert.equal(bigFeatureRejected.actionResult.actionId, "make_plan");
    assert.equal(bigFeatureRejected.actionResult.input.autopilotFeedback, "Plan a simpler version.");
    assert.equal(bigFeatureRejected.actionResult.input.autopilotReason, "changes_rejected");

    const seedRuntime = new Vibe64SessionRuntime({
      adapter: new SeedRequiredFakeAdapter(),
      targetRoot
    });
    await seedRuntime.createSession({
      initialStep: "changes_accepted",
      metadata: worktreeMetadata(targetRoot, "seed_reject"),
      sessionId: "seed_reject",
      workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
    });
    await seedRuntime.store.writeCompletedStep("seed_reject", "seed_plan_made", {
      message: "Seed plan was completed before final review."
    });
    const seedRejectReady = await seedRuntime.getSession("seed_reject");
    const seedRejected = await seedRuntime.runIntent("seed_reject", "reject", {
      fields: {
        feedback: "Seed less infrastructure."
      },
      stepId: seedRejectReady.currentStep,
      stepStatus: seedRejectReady.stepMachine.status
    });
    assert.equal(seedRejected.currentStep, "seed_plan_made");
    assert.equal(seedRejected.actionResult.actionId, "make_seed_plan");

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...worktreeMetadata(targetRoot, "presentation_merge_intents"),
        pr_url: "https://github.com/example/project/pull/1"
      },
      sessionId: "presentation_merge_intents"
    });
    const mergeReview = await runtime.runIntent("presentation_merge_intents", "merge_and_sync");
    assert.equal(mergeReview.presentation.auto.nextOperation.kind, "action");
    assert.equal(mergeReview.presentation.auto.nextOperation.executable, true);
    assert.equal(mergeReview.presentation.auto.nextOperation.route, "session-action");
    assert.equal(mergeReview.presentation.auto.nextOperation.actionId, "prepare_for_merge");

    await runtime.store.writeMetadataValue("presentation_merge_intents", "pr_merged", "yes");
    const syncPending = await runtime.getSession("presentation_merge_intents");
    assert.equal(syncPending.next.enabled, false);
    assert.equal(syncPending.presentation.auto.nextOperation.kind, "command");
    assert.equal(syncPending.presentation.auto.nextOperation.executable, true);
    assert.equal(syncPending.presentation.auto.nextOperation.actionId, "sync_main_checkout");

    await runtime.store.writeMetadataValue("presentation_merge_intents", "main_checkout_synced", "yes");
    const mergeComplete = await runtime.getSession("presentation_merge_intents");
    assert.equal(mergeComplete.next.enabled, true);
    assert.equal(mergeComplete.presentation.auto.nextOperation.kind, "advance");

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        pr_url: "https://github.com/example/project/pull/2"
      },
      sessionId: "presentation_skip_merge_intent"
    });
    const skipped = await runtime.runIntent("presentation_skip_merge_intent", "skip_merge");
    assert.equal(skipped.currentStep, "session_finished");
    assert.equal(skipped.metadata.merge_skipped, "yes");
  });
});

test("vibe64 workflow definition groups expand named sequences and conditionals", () => {
  const groupedIntentHandler = () => ({ ok: true });
  const workflow = defineWorkflow({
    id: "grouped_workflow",
    label: "Grouped workflow",
    parts: [
      "start",
      workflowGroup({
        id: "qa",
        intentHandlers: {
          conditional_step: {
            grouped_intent: groupedIntentHandler
          }
        },
        steps: [
          workflowWhen(true, "conditional_step"),
          workflowWhen(false, "skipped_step"),
          "finish"
        ]
      })
    ]
  });

  assert.deepEqual(workflow.steps, [
    "start",
    "conditional_step",
    "finish"
  ]);
  assert.equal(workflow.parts, undefined);
  assert.equal(workflow.intentHandlers.conditional_step.grouped_intent, groupedIntentHandler);
});

test("vibe64 workflow definitions are ordered step lists with self-contained step metadata", () => {
  const bigFeature = coreWorkflowForDefinition(VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE);
  const seedApplication = coreWorkflowForDefinition(VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
  const nonCommitMaintenance = coreWorkflowForDefinition(maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE);

  assert.equal(bigFeature.id, DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID);
  assert.equal(bigFeature.definition.label, "Make improvements");
  assert.ok(bigFeature.steps.find((step) => step.id === "issue_file_created")?.autopilot.stop);
  assert.ok(seedApplication.steps.find((step) => step.id === "seed_application_defined")?.autopilot.stop);
  assert.deepEqual(bigFeature.steps.map((step) => step.id), [
    "session_created",
    "work_source_selected",
    "worktree_created",
    "dependencies_installed",
    "issue_file_created",
    "plan_and_execute",
    "implementation_reviewed",
    "deep_ui_check_run",
    "review_and_validate",
    "changes_accepted",
    "report_and_update_knowledge",
    "changes_committed",
    "create_and_merge_pull_request",
    "session_finished"
  ]);
  assert.deepEqual(seedApplication.steps.map((step) => step.id).slice(0, 6), [
    "session_created",
    "work_source_selected",
    "worktree_created",
    "seed_application_defined",
    "seed_plan_made",
    "seed_plan_executed"
  ]);
  assert.equal(
    seedApplication.steps.findIndex((step) => step.id === "dependencies_installed") >
      seedApplication.steps.findIndex((step) => step.id === "seed_plan_executed"),
    true
  );
  assert.equal(
    seedApplication.steps.find((step) => step.id === "changes_accepted").workflow.rejectTo,
    "seed_plan_made"
  );
  assert.equal(
    seedApplication.steps.find((step) => step.id === "changes_accepted").workflow.recheckTo,
    "review_and_validate"
  );
  assert.equal(
    bigFeature.steps.find((step) => step.id === "changes_accepted").workflow.rejectTo,
    "plan_and_execute"
  );
  assert.equal(
    bigFeature.steps.find((step) => step.id === "changes_accepted").workflow.recheckTo,
    "review_and_validate"
  );
  const createPullRequestStep = bigFeature.steps.find((step) => step.id === "create_and_merge_pull_request");
  assert.deepEqual(createPullRequestStep.actions.map((action) => action.id), [
    "open_pr",
    "resolve_pull_request",
    "create_pr_on_gh",
    "prepare_for_merge",
    "merge_pr",
    "sync_main_checkout",
    "skip_merge"
  ]);
  assert.deepEqual(createPullRequestStep.autopilot.actionSequence.map((action) => action.actionId), [
    "resolve_pull_request",
    "create_pr_on_gh"
  ]);
  assert.equal(
    createPullRequestStep.actions.find((action) => action.id === "create_pr_on_gh")?.saveCurrentStepInputBeforeRun,
    true
  );
  assert.equal(createPullRequestStep.interaction, undefined);
  assert.equal(createPullRequestStep.label, "Create pull request, possibly merge");
  assert.equal(createPullRequestStep.autopilot.label, "Create pull request, possibly merge");
  assert.deepEqual(createPullRequestStep.rewindCleanup.artifacts, [
    "tmp/create_and_merge_pull_request.body.md",
    "tmp/create_and_merge_pull_request.title.txt",
    "create_and_merge_pull_request.url.txt",
    "create_and_merge_pull_request.number.txt",
    "create_and_merge_pull_request.source.txt"
  ]);
  assert.equal(
    createPullRequestStep.presentation.stop.intents.find((intent) => intent.id === "skip_merge").serverOperation,
    undefined
  );
  assert.equal(
    typeof bigFeature.intentHandlers.create_and_merge_pull_request.merge_and_sync,
    "function"
  );
  assert.equal(
    typeof bigFeature.intentHandlers.create_and_merge_pull_request.skip_merge,
    "function"
  );
  assert.deepEqual(nonCommitMaintenance.definition.initialMetadata, {
    github_issue_mode: "skip",
    issue_source: "none",
    work_anchor_type: "description",
    work_source: "description"
  });
  assert.equal(nonCommitMaintenance.definition.sessionWord, "maintenance");
  assert.deepEqual(nonCommitMaintenance.steps.map((step) => step.id), [
    "session_created",
    "worktree_created",
    "dependencies_installed",
    "maintenance_conversation",
    "local_session_finished"
  ]);
  assert.equal(nonCommitMaintenance.steps.at(-2).autopilot.kind, "agent_conversation");
});

test("vibe64 workflow definitions have an explicit state machine for every step", () => {
  for (const { id: definitionId } of coreWorkflowRegistry.registeredWorkflowRecords()) {
    const workflow = coreWorkflowForDefinition(definitionId);
    assert.deepEqual(
      workflow.steps.map((step) => step.id).filter((stepId) => !coreWorkflowRegistry.machineForStep(stepId)),
      [],
      `${definitionId} has workflow steps without state machines`
    );
  }
});

test("vibe64 workflow contract resolves every referenced step, action, intent, and workflow handler", () => {
  const failures = coreWorkflowRegistry.registeredWorkflowRecords()
    .flatMap(({ id: definitionId }) => validateWorkflowContract(coreWorkflowForDefinition(definitionId)));

  assert.deepEqual(failures, []);
});

test("vibe64 workflow steps are registered with definitions, machines, and clear ownership", () => {
  const records = coreWorkflowRegistry.registeredStepRecords();
  const recordsById = new Map(records.map((record) => [record.id, record]));
  assert.deepEqual(
    records.filter((record) => record.hasDefinition && !record.hasMachine).map((record) => record.id),
    [],
    "registered workflow steps must not have definitions without machines"
  );
  assert.deepEqual(
    records.filter((record) => record.hasMachine && !record.hasDefinition).map((record) => record.id),
    [],
    "registered workflow steps must not have machines without definitions"
  );

  assert.deepEqual(
    coreLifecycleTesting.ownedStepIds
      .filter((stepId) => recordsById.get(stepId)?.moduleId !== lifecycleModuleId),
    [],
    "lifecycle steps must be owned by the lifecycle module"
  );
  assert.deepEqual(
    records
      .filter((record) => record.moduleId === lifecycleModuleId)
      .map((record) => record.id),
    [...coreLifecycleTesting.ownedStepIds].sort()
  );

  assert.deepEqual(
    coreCodingTesting.ownedStepIds
      .filter((stepId) => recordsById.get(stepId)?.moduleId !== codingModuleId),
    [],
    "coding steps must be owned by the coding module"
  );
  assert.deepEqual(
    records
      .filter((record) => record.moduleId === codingModuleId)
      .map((record) => record.id),
    [...coreCodingTesting.ownedStepIds].sort()
  );

  assert.deepEqual(
    records
      .filter((record) => record.moduleId === maintenanceModuleId)
      .map((record) => record.id),
    [...coreMaintenanceTesting.ownedStepIds].sort()
  );
});

test("vibe64 workflow step factories are registered separately from steps", () => {
  assert.deepEqual(
    coreWorkflowRegistry.registeredStepFactoryRecords(),
    [
      {
        id: "chat_with_ai",
        moduleId: "core.step_factories"
      },
      {
        id: "editable_artifact_review",
        moduleId: "core.step_factories"
      }
    ]
  );
});

test("vibe64 workflow app registry composes non-core contributor modules explicitly", () => {
  const externalHandler = () => ({ ok: true });
  const registry = createCoreWorkflowRegistry({
    stepFactoryModules: {
      factories: {
        createMachine: ({ marker = "", stepId = "" } = {}) => ({
          marker,
          stepId
        }),
        id: "external_factory"
      },
      id: "external.factories"
    },
    workflowModules: {
      id: "external.workflow",
      steps: {
        config: {
          marker: "external"
        },
        definition: {
          id: "external_step",
          label: "External step"
        },
        factoryId: "external_factory",
        id: "external_step"
      },
      workflowDefinitions: {
        id: "external_workflow",
        intentHandlers: {
          external_step: {
            external_intent: externalHandler
          }
        },
        label: "External workflow",
        steps: ["external_step"],
        userSelectable: true
      }
    }
  });
  const workflow = registry.workflowForId("external_workflow");

  assert.equal(coreWorkflowRegistry.workflowForId("external_workflow"), null);
  assert.equal(workflow.steps[0].id, "external_step");
  assert.equal(workflow.steps[0].label, "External step");
  assert.equal(workflow.intentHandlers.external_step.external_intent, externalHandler);
  assert.deepEqual(registry.machineForStep("external_step"), {
    marker: "external",
    stepId: "external_step"
  });
  assert.deepEqual(
    registry.registeredWorkflowRecords().filter((record) => record.id === "external_workflow"),
    [
      {
        id: "external_workflow",
        intentHandlers: {
          external_step: ["external_intent"]
        },
        moduleId: "external.workflow",
        steps: [
          {
            rejectTo: "",
            recheckTo: "",
            stepId: "external_step"
          }
        ]
      }
    ]
  );
});

test("vibe64 workflow modules register workflow definitions with explicit cross-module composition", () => {
  const records = coreWorkflowRegistry.registeredWorkflowRecords();
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const lifecycleStepIds = new Set(coreLifecycleTesting.ownedStepIds);
  const stepRecordsById = new Map(
    coreWorkflowRegistry.registeredStepRecords().map((record) => [record.id, record])
  );

  assert.deepEqual(
    Object.values(coreCodingTesting.workflowDefinitionIds)
      .filter((definitionId) => recordsById.get(definitionId)?.moduleId !== codingModuleId),
    [],
    "coding workflows must be owned by the coding module"
  );
  assert.deepEqual(
    records
      .filter((record) => record.moduleId === codingModuleId)
      .map((record) => record.id),
    Object.values(coreCodingTesting.workflowDefinitionIds).sort()
  );

  assert.deepEqual(
    Object.values(maintenanceWorkflowDefinitionIds)
      .filter((definitionId) => recordsById.get(definitionId)?.moduleId !== maintenanceModuleId),
    [],
    "maintenance workflows must be owned by the maintenance module"
  );
  assert.deepEqual(
    records
      .filter((record) => record.moduleId === maintenanceModuleId)
      .map((record) => record.id),
    Object.values(maintenanceWorkflowDefinitionIds).sort()
  );

  const nonCommitMaintenance = recordsById.get(maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE);
  const nonCommitMaintenanceStepIds = nonCommitMaintenance?.steps.map((step) => step.stepId) || [];
  assert.deepEqual(
    nonCommitMaintenanceStepIds,
    [
      "session_created",
      "worktree_created",
      "dependencies_installed",
      "maintenance_conversation",
      "local_session_finished"
    ]
  );
  for (const stepId of nonCommitMaintenanceStepIds.filter((id) => lifecycleStepIds.has(id))) {
    assert.equal(
      stepRecordsById.get(stepId)?.moduleId,
      lifecycleModuleId,
      `maintenance workflow may compose lifecycle step ${stepId}, but must not own it`
    );
  }
});

test("vibe64 workflow registry replaces duplicate step and workflow registrations by name", () => {
  const registry = workflowRegistryTesting.createWorkflowRegistry();
  registry.registerStepFactories("alpha", {
    createMachine: ({ marker = "", stepId = "" } = {}) => ({
      marker,
      stepId
    }),
    id: "shared_factory"
  });
  assert.throws(
    () => registry.registerSteps("alpha", {
      definition: {
        id: "definition_only",
        label: "Definition only"
      }
    }),
    /must register a machine or factory/
  );
  assert.throws(
    () => registry.registerSteps("alpha", {
      id: "machine_only",
      machine: {
        stepId: "machine_only"
      }
    }),
    /must register a definition/
  );
  registry.registerSteps("alpha", {
    definition: {
      id: "shared_step",
      label: "Shared step"
    },
    machine: {
      stepId: "shared_step"
    }
  });
  registry.registerWorkflows("alpha", {
    id: "shared_workflow",
    label: "Shared workflow",
    steps: ["shared_step"]
  });
  assert.equal(registry.definitionForStep("shared_step").label, "Shared step");
  assert.equal(registry.machineForStep("shared_step").stepId, "shared_step");

  registry.registerSteps("beta", {
    definition: {
      id: "shared_step",
      label: "Replacement step"
    },
    machine: {
      replacement: true,
      stepId: "shared_step"
    }
  });
  registry.registerWorkflows("beta", {
    id: "shared_workflow",
    label: "Replacement workflow",
    steps: ["shared_step"]
  });

  assert.equal(registry.definitionForStep("shared_step").label, "Replacement step");
  assert.deepEqual(registry.machineForStep("shared_step"), {
    replacement: true,
    stepId: "shared_step"
  });
  registry.registerSteps("beta", {
    config: {
      marker: "factory"
    },
    definition: {
      id: "shared_step",
      label: "Replacement step"
    },
    factoryId: "shared_factory",
    id: "shared_step"
  });
  assert.deepEqual(registry.machineForStep("shared_step"), {
    marker: "factory",
    stepId: "shared_step"
  });
  registry.registerStepFactories("gamma", {
    createMachine: ({ stepId = "" } = {}) => ({
      marker: "replacement_factory",
      stepId
    }),
    id: "shared_factory"
  });
  assert.deepEqual(registry.machineForStep("shared_step"), {
    marker: "replacement_factory",
    stepId: "shared_step"
  });
  assert.equal(registry.definitionForWorkflow("shared_workflow").label, "Replacement workflow");
  assert.deepEqual(registry.registeredStepFactoryRecords(), [
    {
      id: "shared_factory",
      moduleId: "gamma"
    }
  ]);
  assert.deepEqual(
    registry.registeredStepRecords().filter((record) => record.id === "shared_step"),
    [
      {
        hasDefinition: true,
        hasMachine: true,
        id: "shared_step",
        moduleId: "beta"
      }
    ]
  );
  assert.deepEqual(
    registry.registeredWorkflowRecords().filter((record) => record.id === "shared_workflow"),
    [
      {
        id: "shared_workflow",
        intentHandlers: {},
        moduleId: "beta",
        steps: [
          {
            rejectTo: "",
            recheckTo: "",
            stepId: "shared_step"
          }
        ]
      }
    ]
  );
  registry.registerSteps("gamma", {
    definition: {
      id: "later_step",
      label: "Later step"
    },
    machine: {
      stepId: "later_step"
    }
  });
  assert.throws(
    () => registry.registerWorkflows("gamma", {
      id: "bad_reject_workflow",
      label: "Bad reject workflow",
      steps: [
        {
          rejectTo: "missing_step",
          stepId: "shared_step"
        }
      ]
    }),
    /rejectTo points to unknown step: missing_step/
  );
  assert.throws(
    () => registry.registerWorkflows("gamma", {
      id: "forward_reject_workflow",
      label: "Forward reject workflow",
      steps: [
        {
          rejectTo: "later_step",
          stepId: "shared_step"
        },
        "later_step"
      ]
    }),
    /rejectTo target must be an earlier step: later_step/
  );
  assert.throws(
    () => registry.registerWorkflows("gamma", {
      id: "bad_recheck_workflow",
      label: "Bad recheck workflow",
      steps: [
        {
          recheckTo: "missing_step",
          stepId: "shared_step"
        }
      ]
    }),
    /recheckTo points to unknown step: missing_step/
  );
  assert.throws(
    () => registry.registerWorkflows("gamma", {
      id: "missing_step_workflow",
      label: "Missing step workflow",
      steps: ["missing_step"]
    }),
    /references unregistered steps: missing_step/
  );
  assert.throws(
    () => registry.registerSteps("gamma", {
      definition: {
        id: "missing_factory_step",
        label: "Missing factory step"
      },
      factoryId: "missing_factory",
      id: "missing_factory_step"
    }),
    /references unregistered step factory: missing_factory/
  );
});

test("vibe64 runtime persists the selected workflow definition per session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    const session = await runtime.createSession({
      sessionId: "maintenance_definition",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });

    assert.equal(session.workflowId, maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE);
    assert.equal(session.workflowDefinition.id, maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE);
    assert.equal(session.metadata.workflow_definition, maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE);
    assert.equal(session.metadata.work_source, "description");
    assert.equal(session.sessionName, "maintenance");
    assert.equal(session.stepDefinitions.at(-1).id, "local_session_finished");
    assert.equal(await runtime.store.readArtifact("maintenance_definition", "issue_word"), "maintenance\n");

    await assert.rejects(
      () => runtime.createSession({
        sessionId: "bad_definition",
        workflowDefinition: "unknown_definition"
      }),
      /Unknown Vibe64 workflow definition/u
    );
  });
});

test("vibe64 runtime selects the seed definition when the adapter says seeding is required", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new SeedRequiredFakeAdapter(),
      targetRoot
    });

    const session = await runtime.createSession({
      sessionId: "seed_definition"
    });

    assert.equal(session.workflowId, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
    assert.equal(session.metadata.workflow_definition, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
    assert.equal(session.sessionName, "seeding");
    assert.equal(await runtime.store.readArtifact("seed_definition", "issue_word"), "seeding\n");
    assert.equal(await runtime.store.readMetadataValue("seed_definition", "issue_word"), "");
    assert.ok(session.stepDefinitions.some((step) => step.id === "seed_application_defined"));
    assert.equal(session.stepDefinitions.some((step) => step.id === "issue_file_created"), false);
  });
});

test("vibe64 runtime rejects non-seed definitions while seeding is required", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new SeedRequiredFakeAdapter(),
      targetRoot
    });

    await assert.rejects(
      () => runtime.createSession({
        sessionId: "bad_seed_definition",
        workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE
      }),
      {
        code: "vibe64_seed_workflow_required"
      }
    );
  });
});

test("vibe64 runtime rejects the seed definition after seeding is no longer required", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    await assert.rejects(
      () => runtime.createSession({
        sessionId: "late_seed_definition",
        workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
      }),
      {
        code: "vibe64_seed_workflow_not_available"
      }
    );
  });
});

test("vibe64 runtime advance records completed steps and moves to the next workflow step", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      actionHandlers: {
        use_new_issue: async () => ({
          message: "Starting fresh with a new issue.",
          metadata: {
            github_issue_mode: "create",
            issue_source: "new",
            work_anchor_type: "issue",
            work_source: "new_issue"
          },
          status: "completed"
        })
      },
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      sessionId: "advance_flow"
    });

    const afterFirstAdvance = await runtime.advance("advance_flow");
    assert.equal(afterFirstAdvance.currentStep, "work_source_selected");
    assert.deepEqual(afterFirstAdvance.completedSteps, ["session_created"]);
    assert.equal(afterFirstAdvance.stepDefinitions[0].status, "done");
    assert.equal(afterFirstAdvance.stepDefinitions[1].status, "current");
    assert.equal(afterFirstAdvance.next.stepId, "worktree_created");
    assert.equal(afterFirstAdvance.next.enabled, false);
    assert.equal(afterFirstAdvance.presentation.screen.kind, "work_source");
    assert.deepEqual(afterFirstAdvance.actions.map((action) => action.id), [
      "use_new_issue",
      "use_existing_issue",
      "use_existing_pr",
      "use_description"
    ]);
    assert.deepEqual(afterFirstAdvance.intents.map((intent) => intent.id), [
      "use_new_issue",
      "use_existing_issue",
      "use_existing_pr",
      "use_description"
    ]);
    const existingIssueAction = afterFirstAdvance.actions.find((action) => action.id === "use_existing_issue");
    assert.equal(existingIssueAction?.enabled, true);
    assert.deepEqual(existingIssueAction?.inputFields.map((field) => field.name), [
      "issueRef"
    ]);
    const existingPrAction = afterFirstAdvance.actions.find((action) => action.id === "use_existing_pr");
    assert.equal(existingPrAction?.enabled, true);
    assert.equal(existingPrAction?.adapterCapability, undefined);
    assert.deepEqual(existingPrAction?.inputFields.map((field) => field.name), [
      "prRef"
    ]);

    const afterWorkSource = await runtime.runIntent("advance_flow", "use_new_issue", {
      stepId: afterFirstAdvance.currentStep,
      stepStatus: afterFirstAdvance.stepMachine.status
    });
    assert.equal(afterWorkSource.currentStep, "worktree_created");
    assert.equal(afterWorkSource.metadata.github_issue_mode, "create");
    assert.equal(afterWorkSource.metadata.work_source, "new_issue");
    assert.equal(afterWorkSource.actionResult.message, "Starting fresh with a new issue.");
    assert.deepEqual(afterWorkSource.completedSteps, [
      "session_created",
      "work_source_selected"
    ]);
  });
});

test("vibe64 runtime shows current-step actions from the workflow", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_worktree: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      sessionId: "disabled_actions"
    });

    await runtime.advance("disabled_actions");
    await runtime.store.writeMetadataValue("disabled_actions", "work_source", "new_issue");
    const session = await runtime.advance("disabled_actions");
    assert.equal(session.currentStep, "worktree_created");
    assert.deepEqual(session.actions, [
      {
        adapterCapability: "create_worktree",
        disabledReason: "",
        dispatchRoute: "command-terminal",
        enabled: true,
        icon: "sync",
        id: "create_worktree",
        label: "Create worktree",
        type: "command",
        visible: true
      }
    ]);
  });
});

test("vibe64 runtime runAction records non-command action results without advancing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot,
      workflow: {
        id: "unit-action",
        steps: [
          {
            actions: [
              {
                id: "record_review",
                label: "Record review",
                type: "record"
              }
            ],
            id: "review",
            label: "Review"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "run_action"
    });

    const afterAction = await runtime.runAction("run_action", "record_review", {
      dryRun: true
    });

    assert.equal(afterAction.currentStep, "review");
    assert.deepEqual(afterAction.completedSteps, []);
    assert.deepEqual(afterAction.actionResult, {
      actionId: "record_review",
      actionLabel: "Record review",
      actionType: "record",
      attemptFile: "000001-record_review.json",
      attemptNumber: 1,
      at: "2026-05-16T01:02:03.000Z",
      input: {
        dryRun: true
      },
      message: "Recorded Record review.",
      status: "completed",
      stepId: "review"
    });
    assert.equal(afterAction.actionAttempts.length, 1);
    assert.equal(afterAction.actionAttempts[0].attemptFile, "000001-record_review.json");
    assert.deepEqual(await runtime.store.readCommandLog("run_action"), [
      {
        actionId: "record_review",
        actionLabel: "Record review",
        actionType: "record",
        at: "2026-05-16T01:02:03.000Z",
        kind: "action",
        status: "completed",
        stepId: "review"
      }
    ]);
  });
});

test("vibe64 runtime rejects command actions because terminals own command execution", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_worktree: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        work_source: "new_issue"
      },
      sessionId: "command_action"
    });

    await assert.rejects(
      () => runtime.runAction("command_action", "create_worktree"),
      {
        code: "vibe64_command_requires_terminal",
        message: "Command action Create worktree must run in the command terminal."
      }
    );
  });
});

test("vibe64 runtime prompt actions render Codex handoff data without advancing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: {
        ...worktreeMetadata(targetRoot, "prompt_action"),
        codex_prompt_handoff_signature: "hidden",
        dependencies_path: path.join(targetRoot, "prompt_action", "node_modules"),
        github_issue_mode: "skip"
      },
      sessionId: "prompt_action"
    });

    const afterAction = await runtime.runAction("prompt_action", "make_plan", {
      scope: "unit test"
    });

    assert.equal(afterAction.currentStep, "plan_and_execute");
    assert.deepEqual(afterAction.completedSteps, []);
    assert.equal(afterAction.actionResult.status, "prompt_ready");
    assert.equal(afterAction.actionResult.promptId, "make_plan");
    assert.match(afterAction.actionResult.prompt, /Vibe64 workflow context:/u);
    assert.match(afterAction.actionResult.prompt, /- worktree path: /u);
    assert.match(afterAction.actionResult.prompt, /Relevant workflow facts:\n(?:- .+\n)*- github_issue_mode: skip/u);
    assert.doesNotMatch(afterAction.actionResult.prompt, /codex_prompt_handoff_signature/u);
    assert.doesNotMatch(afterAction.actionResult.prompt, /dependencies_path/u);
    assert.doesNotMatch(afterAction.actionResult.prompt, /worktree_path:/u);
    assert.match(afterAction.actionResult.prompt, /User\/request input:\n- scope: unit test/u);
    assert.match(afterAction.actionResult.prompt, /Run the Vibe64 prompt action: Make a plan/u);
    assert.doesNotMatch(afterAction.actionResult.prompt, /"scope": "unit test"/u);
    assert.match(afterAction.actionResult.prompt, /Vibe64 step completion contract:/u);
    assert.match(afterAction.actionResult.prompt, /"kind": "ready"/u);
    assert.match(afterAction.actionResult.prompt, /"stepStatus": "awaiting_agent_result"/u);
    assert.match(afterAction.actionResult.prompt, /Do not write workflow artifacts directly/u);
    assert.doesNotMatch(afterAction.actionResult.prompt, /VIBE64_AUTOPILOT_DONE/u);
    assert.equal(afterAction.actionResult.codexPromptHandoff.kind, "codex_prompt_handoff");
    assert.equal(afterAction.actionResult.codexPromptHandoff.codex.mode, "inject_prompt");
    assert.equal(afterAction.actionResult.codexPromptHandoff.prompt, afterAction.actionResult.prompt);
    assert.match(afterAction.actionResult.codexPromptHandoff.terminalInput, /^Make a plan\n\n\[\[VIBE64_CONTEXT_START\]\]/u);
    assert.match(afterAction.actionResult.codexPromptHandoff.terminalInput, /\[\[VIBE64_CONTEXT_START\]\]/u);
    const runningPromptAction = afterAction.actions.find((action) => action.id === "make_plan");
    assert.equal(runningPromptAction?.enabled, false);
    assert.equal(runningPromptAction?.disabledReason, "Wait for Codex to finish this step.");

    await runtime.submitCurrentStepInput("prompt_action", {
      kind: "ready",
      source: "codex",
      stepId: "plan_and_execute",
      stepStatus: "awaiting_agent_result"
    });
    const afterPlan = await runtime.getSession("prompt_action");
    assert.equal(afterPlan.currentStep, "plan_and_execute");
    assert.equal(afterPlan.metadata.plan_ready, "yes");
    assert.equal(afterPlan.actions.find((action) => action.id === "execute_plan")?.enabled, true);

    const afterExecuteAction = await runtime.runAction("prompt_action", "execute_plan");
    assert.equal(afterExecuteAction.currentStep, "plan_and_execute");
    assert.equal(afterExecuteAction.actionResult.promptId, "execute_plan");
    await runtime.submitCurrentStepInput("prompt_action", {
      kind: "ready",
      source: "codex",
      stepId: "plan_and_execute",
      stepStatus: "awaiting_agent_result"
    });
    const afterAdvance = await runtime.advance("prompt_action");
    assert.equal(afterAdvance.currentStep, "implementation_reviewed");
  });
});

test("vibe64 pull request resolution prompt uses the current-step helper contract", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const promptPackRoot = path.join(targetRoot, "prompt-pack");
    await mkdir(promptPackRoot, {
      recursive: true
    });
    await writeFile(
      path.join(promptPackRoot, "fallback.txt"),
      "{{systemStandard}}",
      "utf8"
    );
    const runtime = new Vibe64SessionRuntime({
      adapter: new PromptRendererFakeAdapter({
        promptPackRoot
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...worktreeMetadata(targetRoot, "pull_request_resolution_prompt"),
        branch_pushed: "origin/vibe64/test-session"
      },
      sessionId: "pull_request_resolution_prompt"
    });

    const afterAction = await runtime.runAction("pull_request_resolution_prompt", "resolve_pull_request");

    assert.equal(afterAction.currentStep, "create_and_merge_pull_request");
    assert.equal(afterAction.actionResult.status, "prompt_ready");
    assert.equal(afterAction.actionResult.promptId, "resolve_pull_request");
    assert.match(afterAction.actionResult.prompt, /Vibe64 current-step input helper/u);
    assert.match(afterAction.actionResult.prompt, /"kind": "ready"/u);
    assert.match(afterAction.actionResult.prompt, /"stepId": "create_and_merge_pull_request"/u);
    assert.match(afterAction.actionResult.prompt, /"stepStatus": "awaiting_agent_result"/u);
    assert.match(afterAction.actionResult.prompt, /Do not write workflow artifacts directly/u);
    assert.match(afterAction.actionResult.prompt, /write the same question or blocker in normal Codex response text/u);
    assert.match(afterAction.actionResult.prompt, /Keep the visible question text and the helper `message` equivalent/u);
    assert.ok(afterAction.actionResult.prompt.includes(questionBatchLimitInstruction()));
    assert.match(afterAction.actionResult.prompt, /format each question on its own line as `\[1\] Question text`/u);
  });
});

test("editable artifact review steps preserve user-origin and prompt-origin draft behavior", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    const issueSession = await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...worktreeMetadata(targetRoot, "editable_artifact_issue"),
        github_issue_mode: "create",
        work_source: "new_issue"
      },
      sessionId: "editable_artifact_issue"
    });
    assert.equal(issueSession.stepMachine.status, "ready");
    assert.equal(issueSession.presentation.screen.kind, "issue_source");
    assert.deepEqual(issueSession.intents.map((intent) => intent.id), [
      "draft_issue",
      "create_issue_on_gh"
    ]);
    assert.equal(issueSession.actions.find((action) => action.id === "draft_issue")?.enabled, true);
    assert.equal(issueSession.actions.find((action) => action.id === "create_issue_on_gh")?.enabled, false);

    const draftingIssue = await runtime.runAction("editable_artifact_issue", "draft_issue", {
      conversationRequest: "Add saved reports."
    });
    assert.equal(draftingIssue.stepMachine.status, "awaiting_agent_result");
    assert.equal(draftingIssue.actionResult.status, "prompt_ready");
    assert.equal(draftingIssue.actionResult.promptId, "draft_issue");
    assert.match(draftingIssue.actionResult.prompt, /Vibe64 step completion contract/u);
    assert.match(draftingIssue.actionResult.prompt, /"title": "Concise work title\."/u);
    assert.match(draftingIssue.actionResult.prompt, /"word": "Short Vibe64 session label\/word derived from the work title\."/u);

    const confirmedIssue = await runtime.submitCurrentStepInput("editable_artifact_issue", {
      fields: {
        body: "Issue body",
        title: "Issue title",
        word: "issue-word"
      },
      kind: "ready",
      source: "codex",
      stepId: "issue_file_created",
      stepStatus: "awaiting_agent_result"
    });
    assert.equal(confirmedIssue.stepMachine.status, "confirm_files");
    assert.deepEqual(confirmedIssue.presentation.screen.input.fields.map((field) => field.name), [
      "title",
      "word",
      "body"
    ]);
    assert.deepEqual(confirmedIssue.intents.map((intent) => intent.id), [
      "continue_step",
      "reject_issue_draft"
    ]);
    const continueIssueIntent = confirmedIssue.intents.find((intent) => intent.id === "continue_step");
    assert.equal(continueIssueIntent?.saveCurrentStepInputBeforeRun, true);
    assert.equal(
      confirmedIssue.presentation.screen.input.intents.find((intent) => intent.id === "continue_step")?.saveCurrentStepInputBeforeRun,
      true
    );
    assert.equal(confirmedIssue.actions.find((action) => action.id === "create_issue_on_gh")?.saveCurrentStepInputBeforeRun, true);
    assert.equal(confirmedIssue.intents.find((intent) => intent.id === "reject_issue_draft")?.label, "Send improvement request");
    assert.equal(await runtime.store.readArtifact("editable_artifact_issue", "issue_title"), "Issue title\n");
    assert.equal(await runtime.store.readArtifact("editable_artifact_issue", "issue.md"), "Issue body\n");

    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        github_issue_mode: "skip",
        work_source: "description"
      },
      sessionId: "editable_artifact_issue_accept"
    });
    await runtime.submitCurrentStepInput("editable_artifact_issue_accept", {
      fields: {
        body: "Issue body",
        title: "Issue title",
        word: "issue-word"
      },
      kind: "ready",
      stepId: "issue_file_created",
      stepStatus: "ready"
    });
    const acceptedIssue = await runtime.runIntent("editable_artifact_issue_accept", "continue_step", {
      stepId: "issue_file_created",
      stepStatus: "confirm_files"
    });
    assert.equal(acceptedIssue.currentStep, "plan_and_execute");

    const rejectedIssue = await runtime.runIntent("editable_artifact_issue", "reject_issue_draft", {
      fields: {
        feedback: "Use a clearer title."
      },
      stepId: "issue_file_created",
      stepStatus: "confirm_files"
    });
    assert.equal(rejectedIssue.stepMachine.status, "awaiting_agent_result");
    assert.equal(rejectedIssue.actionResult.status, "prompt_ready");
    assert.equal(rejectedIssue.actionResult.promptId, "draft_issue");
    assert.equal(rejectedIssue.actionResult.input.feedback, "Use a clearer title.");
    assert.match(rejectedIssue.actionResult.prompt, /Use a clearer title\./u);
    assert.equal(await runtime.store.readArtifact("editable_artifact_issue", "issue_title"), "Issue title\n");
    assert.equal(await runtime.store.readArtifact("editable_artifact_issue", "issue.md"), "Issue body\n");

    const revisedIssue = await runtime.submitCurrentStepInput("editable_artifact_issue", {
      fields: {
        body: "Revised issue body",
        title: "Revised issue title",
        word: "revised-issue"
      },
      kind: "confirm_files",
      source: "codex",
      stepId: "issue_file_created",
      stepStatus: "awaiting_agent_result"
    });
    assert.equal(revisedIssue.stepMachine.status, "confirm_files");
    assert.equal(await runtime.store.readArtifact("editable_artifact_issue", "issue_title"), "Revised issue title\n");
    assert.equal(await runtime.store.readArtifact("editable_artifact_issue", "issue.md"), "Revised issue body\n");

    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...worktreeMetadata(targetRoot, "issue_url_without_artifacts"),
        github_issue_mode: "reuse",
        issue_number: "13",
        issue_source: "existing",
        issue_url: "https://github.com/example/project/issues/13"
      },
      sessionId: "issue_url_without_artifacts"
    });
    const issueUrlOnly = await runtime.getSession("issue_url_without_artifacts");
    assert.notEqual(issueUrlOnly.next.enabled, true);
    assert.equal(issueUrlOnly.next.disabledReason, "Describe the work before continuing.");
    assert.equal(issueUrlOnly.presentation.screen.kind, "issue_source");
    assert.equal(issueUrlOnly.actions.find((action) => action.id === "draft_issue")?.enabled, true);
    const repairedIssueDraft = await runtime.submitCurrentStepInput("issue_url_without_artifacts", {
      fields: {
        body: "Replacement body",
        title: "Replacement title",
        word: "replacement"
      },
      kind: "ready",
      stepId: "issue_file_created",
      stepStatus: "ready"
    });
    assert.equal(repairedIssueDraft.stepMachine.status, "confirm_files");
    assert.equal(repairedIssueDraft.metadata.issue_url, undefined);

    const missingIssueRuntime = new Vibe64SessionRuntime({
      actionHandlers: {
        use_existing_issue: async () => ({
          message: "Could not resolve GitHub issue: issue not found",
          status: "blocked"
        })
      },
      adapter: new FakeTargetAdapter({
        capabilities: {
          use_existing_issue: true
        }
      }),
      targetRoot
    });
    await missingIssueRuntime.createSession({
      initialStep: "work_source_selected",
      sessionId: "missing_issue_artifacts"
    });
    const missingIssue = await missingIssueRuntime.runIntent("missing_issue_artifacts", "use_existing_issue", {
      fields: {
        issueRef: "404404"
      },
      stepId: "work_source_selected",
      stepStatus: "ready"
    });
    assert.equal(missingIssue.actionResult.status, "blocked");
    assert.equal(missingIssue.stepMachine.status, "failed");
    assert.equal(missingIssue.stepMachine.message, "Could not resolve GitHub issue: issue not found");
    assert.equal(missingIssue.presentation.screen.kind, "work_source");
    assert.equal(missingIssue.currentStep, "work_source_selected");
    assert.ok(missingIssue.intents.some((intent) => intent.id === "use_existing_issue" && intent.enabled === true));

    const prSession = await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...worktreeMetadata(targetRoot, "editable_artifact_pr"),
        branch_pushed: "origin/vibe64/test-session"
      },
      sessionId: "editable_artifact_pr"
    });
    assert.equal(prSession.stepMachine.status, "ready");
    assert.equal(prSession.presentation.screen.input, undefined);

    const draftingPr = await runtime.runAction("editable_artifact_pr", "resolve_pull_request", {});
    assert.equal(draftingPr.stepMachine.status, "awaiting_agent_result");
    assert.equal(draftingPr.actionResult.status, "prompt_ready");

    const waitingPr = await runtime.submitCurrentStepInput("editable_artifact_pr", {
      kind: "waiting_for_input",
      message: "Which target branch should this use?",
      source: "codex",
      stepId: "create_and_merge_pull_request",
      stepStatus: "awaiting_agent_result"
    });
    assert.equal(waitingPr.stepMachine.status, "waiting_for_input");
    assert.equal(waitingPr.next.disabledReason, "Answer Codex before continuing.");

    const resumedPr = await runtime.runIntent("editable_artifact_pr", "talk_to_codex", {
      fields: {
        response: "Use main."
      },
      stepId: "create_and_merge_pull_request",
      stepStatus: "waiting_for_input"
    });
    assert.equal(resumedPr.stepMachine.status, "awaiting_agent_result");
    assert.equal(resumedPr.actionResult.input.response, "Use main.");

    const confirmedPr = await runtime.submitCurrentStepInput("editable_artifact_pr", {
      fields: {
        body: "PR body",
        title: "PR title"
      },
      kind: "ready",
      source: "codex",
      stepId: "create_and_merge_pull_request",
      stepStatus: "awaiting_agent_result"
    });
    assert.equal(confirmedPr.stepMachine.status, "confirm_files");
    assert.deepEqual(confirmedPr.presentation.screen.input.fields.map((field) => field.name), [
      "title",
      "body"
    ]);
    assert.equal(confirmedPr.presentation.screen.input.submitLabel, "Save draft");
    assert.equal(confirmedPr.actions.find((action) => action.id === "create_pr_on_gh")?.saveCurrentStepInputBeforeRun, true);
    assert.equal(
      await runtime.store.readArtifact("editable_artifact_pr", "tmp/create_and_merge_pull_request.title.txt"),
      "PR title\n"
    );
    assert.equal(
      await runtime.store.readArtifact("editable_artifact_pr", "tmp/create_and_merge_pull_request.body.md"),
      "PR body\n"
    );
  });
});

test("human review Codex turns can update the canonical work definition", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "implementation_reviewed",
      metadata: worktreeMetadata(targetRoot, "review_updates_work"),
      sessionId: "review_updates_work"
    });
    await Promise.all([
      runtime.store.writeArtifact("review_updates_work", "work_title", "Create p.txt\n"),
      runtime.store.writeArtifact("review_updates_work", "work.md", "Create p.txt.\n"),
      runtime.store.writeArtifact("review_updates_work", "work_word", "p\n"),
      runtime.store.writeMetadataValue("review_updates_work", "work_title", "Create p.txt"),
      runtime.store.writeMetadataValue("review_updates_work", "work_word", "p")
    ]);

    await runtime.runAction("review_updates_work", "human_review_conversation", {
      conversationRequest: "Actually make it q.txt."
    });
    await runtime.submitCurrentStepInput("review_updates_work", {
      fields: {
        response: "Changed the requested file to q.txt.",
        workDescription: "Create an empty q.txt file in the project root.",
        workTitle: "Create q.txt",
        workWord: "q"
      },
      kind: "ready",
      source: "codex",
      stepId: "implementation_reviewed",
      stepStatus: "awaiting_agent_result"
    });

    assert.equal(await runtime.store.readArtifact("review_updates_work", "work_title"), "Create q.txt\n");
    assert.equal(await runtime.store.readArtifact("review_updates_work", "work.md"), "Create an empty q.txt file in the project root.\n");
    assert.equal(await runtime.store.readArtifact("review_updates_work", "work_word"), "q\n");
    assert.equal(await runtime.store.readMetadataValue("review_updates_work", "work_title"), "Create q.txt");
    assert.equal(await runtime.store.readMetadataValue("review_updates_work", "work_word"), "q");
  });
});

test("vibe64 pull request draft includes the final report exactly once", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...worktreeMetadata(targetRoot, "pr_report_body"),
        branch_pushed: "origin/vibe64/test-session"
      },
      sessionId: "pr_report_body"
    });
    await runtime.store.writeArtifact("pr_report_body", "report.md", "# Session report\n\nImplemented the requested change.\n");

    await runtime.runAction("pr_report_body", "resolve_pull_request", {});
    await runtime.submitCurrentStepInput("pr_report_body", {
      fields: {
        body: "PR body",
        title: "PR title"
      },
      kind: "ready",
      source: "codex",
      stepId: "create_and_merge_pull_request",
      stepStatus: "awaiting_agent_result"
    });

    const savedBody = await runtime.store.readArtifact("pr_report_body", "tmp/create_and_merge_pull_request.body.md");
    assert.match(savedBody, /PR body/u);
    assert.match(savedBody, /<!-- vibe64:final-report:start -->/u);
    assert.match(savedBody, /## Vibe64 final report/u);
    assert.match(savedBody, /# Session report/u);
    assert.match(savedBody, /Implemented the requested change\./u);

    await runtime.submitCurrentStepInput("pr_report_body", {
      fields: {
        body: savedBody,
        title: "PR title"
      },
      kind: "confirm_files",
      source: "user",
      stepId: "create_and_merge_pull_request",
      stepStatus: "confirm_files"
    });

    const resavedBody = await runtime.store.readArtifact("pr_report_body", "tmp/create_and_merge_pull_request.body.md");
    assert.equal(resavedBody.match(/<!-- vibe64:final-report:start -->/ug)?.length, 1);
  });
});

test("vibe64 existing PR work anchors continue from saved work details without issue creation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    const session = await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...worktreeMetadata(targetRoot, "existing_pr_issue_skip"),
        github_issue_mode: "skip",
        issue_source: "none",
        source_pr_number: "77",
        source_pr_title: "Upstream feature",
        source_pr_url: "https://github.com/example/project/pull/77",
        work_anchor_number: "77",
        work_anchor_type: "pull_request",
        work_anchor_url: "https://github.com/example/project/pull/77",
        work_source: "existing_pr"
      },
      sessionId: "existing_pr_issue_skip"
    });

    assert.equal(session.stepMachine.status, "ready");
    assert.equal(session.next.enabled, false);
    assert.equal(session.actions.find((action) => action.id === "create_issue_on_gh")?.enabled, false);
    assert.equal(session.actions.find((action) => action.id === "draft_issue")?.enabled, true);

    const reviewed = await runtime.submitCurrentStepInput("existing_pr_issue_skip", {
      fields: {
        body: "Build on the upstream feature.",
        title: "Extend upstream feature",
        word: "upstream-feature"
      },
      kind: "ready",
      stepId: "issue_file_created",
      stepStatus: "ready"
    });
    assert.equal(reviewed.stepMachine.status, "confirm_files");
    assert.equal(reviewed.next.enabled, true);
    assert.equal(reviewed.metadata.work_anchor_number, "77");
    assert.equal(reviewed.metadata.work_anchor_url, "https://github.com/example/project/pull/77");
    assert.equal(reviewed.actions.find((action) => action.id === "create_issue_on_gh")?.enabled, false);

    const submitted = await runtime.runIntent("existing_pr_issue_skip", "continue_step", {
      stepId: "issue_file_created",
      stepStatus: "confirm_files"
    });
    assert.equal(submitted.currentStep, "plan_and_execute");
    assert.equal(submitted.metadata.work_anchor_number, "77");
    assert.equal(submitted.metadata.work_anchor_type, "pull_request");
    assert.equal(submitted.metadata.work_anchor_url, "https://github.com/example/project/pull/77");
    assert.equal(await runtime.store.readArtifact("existing_pr_issue_skip", "issue_title"), "Extend upstream feature\n");
  });
});

test("vibe64 issue question state only exposes the Codex answer path", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    const session = await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...worktreeMetadata(targetRoot, "issue_question_flow"),
        github_issue_mode: "create",
        issue_source: "new",
        work_source: "new_issue"
      },
      sessionId: "issue_question_flow"
    });

    await runtime.runAction("issue_question_flow", "draft_issue", {
      conversationRequest: "Add a booking form."
    });
    await runtime.submitCurrentStepInput("issue_question_flow", {
      kind: "waiting_for_input",
      message: "Should the booking form collect a phone number?",
      source: "codex",
      stepId: session.currentStep,
      stepStatus: "awaiting_agent_result"
    });

    const waiting = await runtime.getSession("issue_question_flow");
    assert.equal(waiting.stepMachine.status, "waiting_for_input");
    assert.equal(waiting.presentation.screen.kind, "conversation");
    assert.equal(waiting.presentation.screen.primaryIntentId, "talk_to_codex");
    assert.deepEqual(waiting.intents.map((intent) => intent.id), ["talk_to_codex", "let_codex_decide"]);
    assert.equal(waiting.intents[0].actionId, "draft_issue");
    assert.equal(waiting.intents[0].enabled, true);
    assert.equal(waiting.intents[0].label, "Send to Codex");
    assert.equal(waiting.intents[1].enabled, true);
    assert.deepEqual(waiting.intents[1].inputFields, []);
    assert.deepEqual(waiting.intents[1].submitFields, {
      conversationRequest: "You decide."
    });
    assert.equal(
      waiting.intents.some((intent) => intent.id === "draft_issue" || intent.id === "create_issue_on_gh"),
      false
    );

    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...worktreeMetadata(targetRoot, "issue_question_after_reject"),
        github_issue_mode: "skip",
        issue_source: "none",
        work_source: "description"
      },
      sessionId: "issue_question_after_reject"
    });
    await runtime.runAction("issue_question_after_reject", "draft_issue", {
      conversationRequest: "Create a small test file."
    });
    await runtime.submitCurrentStepInput("issue_question_after_reject", {
      fields: {
        body: "Create a small test file.",
        title: "Create test file",
        word: "test-file"
      },
      kind: "ready",
      source: "codex",
      stepId: "issue_file_created",
      stepStatus: "awaiting_agent_result"
    });
    await runtime.runIntent("issue_question_after_reject", "reject_issue_draft", {
      fields: {
        feedback: "Ask me questions before revising."
      },
      stepId: "issue_file_created",
      stepStatus: "confirm_files"
    });
    await runtime.submitCurrentStepInput("issue_question_after_reject", {
      kind: "waiting_for_input",
      message: "[1] What file name should be used?\n[2] Where should it be created?",
      source: "codex",
      stepId: "issue_file_created",
      stepStatus: "awaiting_agent_result"
    });

    const waitingAfterReject = await runtime.getSession("issue_question_after_reject");
    assert.equal(waitingAfterReject.stepMachine.status, "waiting_for_input");
    assert.equal(waitingAfterReject.presentation.screen.input.actionId, "reject_issue_draft");
    assert.deepEqual(waitingAfterReject.intents.map((intent) => intent.id), ["talk_to_codex", "let_codex_decide"]);
    assert.equal(waitingAfterReject.intents[0].actionId, "reject_issue_draft");
    assert.equal(waitingAfterReject.intents[0].enabled, true);
    assert.deepEqual(waitingAfterReject.intents[1].inputFields, []);

    const answeredAfterReject = await runtime.runIntent("issue_question_after_reject", "talk_to_codex", {
      fields: {
        conversationRequest: "[1] question-answer.txt\n[2] Project root"
      },
      stepId: "issue_file_created",
      stepStatus: "waiting_for_input"
    });
    assert.equal(answeredAfterReject.stepMachine.status, "awaiting_agent_result");
    assert.equal(answeredAfterReject.actionResult.actionId, "reject_issue_draft");
    assert.equal(answeredAfterReject.actionResult.input.conversationRequest, "[1] question-answer.txt\n[2] Project root");
  });
});

test("vibe64 existing issue action imports issue artifacts and session word", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const binDir = path.join(targetRoot, "bin");
    await mkdir(binDir, {
      recursive: true
    });
    const ghPath = path.join(binDir, "gh");
    await writeFile(
      ghPath,
      [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        "if (!args.some((arg) => arg.includes('body'))) {",
        "  process.stderr.write('body field missing');",
        "  process.exit(1);",
        "}",
        "process.stdout.write(JSON.stringify({",
        "  body: 'Body line\\nSecond line',",
        "  number: 12,",
        "  state: 'OPEN',",
        "  title: 'Add saved reports',",
        "  url: 'https://github.com/example/project/issues/12'",
        "}));"
      ].join("\n"),
      "utf8"
    );
    await chmod(ghPath, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ""}`;
    try {
      const result = await runVibe64WorkflowSessionAction("use_existing_issue", {
        input: {
          issueRef: "#12"
        },
        targetRoot
      });

      assert.equal(result.status, "completed");
      assert.equal(result.metadata.issue_url, "https://github.com/example/project/issues/12");
      assert.equal(result.metadata.issue_word, "Add");
      assert.equal(result.metadata.work_anchor_number, "12");
      assert.equal(result.metadata.work_anchor_title, "Add saved reports");
      assert.equal(result.metadata.work_anchor_type, "issue");
      assert.equal(result.metadata.work_anchor_url, "https://github.com/example/project/issues/12");
      assert.equal(result.metadata.work_source, "existing_issue");
      assert.equal(result.artifacts.issue_title, "Add saved reports");
      assert.equal(result.artifacts.issue_word, "Add");
      assert.equal(result.artifacts["issue.md"], "Body line\nSecond line");
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });
});

test("vibe64 existing PR action selects only same-repository open PRs as stacked bases", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const binDir = path.join(targetRoot, "bin");
    await mkdir(binDir, {
      recursive: true
    });
    const ghPath = path.join(binDir, "gh");
    await writeFile(
      ghPath,
      [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        "const number = args[2];",
        "const common = {",
        "  baseRefName: 'main',",
        "  headRefName: 'feature-base',",
        "  headRefOid: 'abc123',",
        "  headRepository: { nameWithOwner: 'example/project' },",
        "  headRepositoryOwner: { login: 'example' },",
        "  maintainerCanModify: true,",
        "  state: 'OPEN',",
        "  title: 'Upstream feature'",
        "};",
        "if (number === '77') {",
        "  process.stdout.write(JSON.stringify({",
        "    ...common,",
        "    isCrossRepository: false,",
        "    number: 77,",
        "    url: 'https://github.com/example/project/pull/77'",
        "  }));",
        "  process.exit(0);",
        "}",
        "if (number === '88') {",
        "  process.stdout.write(JSON.stringify({",
        "    ...common,",
        "    isCrossRepository: true,",
        "    number: 88,",
        "    url: 'https://github.com/example/project/pull/88'",
        "  }));",
        "  process.exit(0);",
        "}",
        "process.stderr.write('unexpected gh args: ' + args.join(' '));",
        "process.exit(1);"
      ].join("\n"),
      "utf8"
    );
    await chmod(ghPath, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ""}`;
    try {
      const selected = await runVibe64WorkflowSessionAction("use_existing_pr", {
        input: {
          prRef: "#77"
        },
        targetRoot
      });

      assert.equal(selected.status, "completed");
      assert.equal(selected.metadata.work_source, "existing_pr");
      assert.equal(selected.metadata.issue_source, "none");
      assert.equal(selected.metadata.source_pr_update_mode, "stacked");
      assert.equal(selected.metadata.source_pr_number, "77");
      assert.equal(selected.metadata.source_pr_head_ref, "feature-base");
      assert.equal(selected.metadata.source_pr_head_sha, "abc123");
      assert.equal(selected.metadata.work_anchor_number, "77");
      assert.equal(selected.metadata.work_anchor_type, "pull_request");
      assert.equal(selected.metadata.work_anchor_url, "https://github.com/example/project/pull/77");

      const blocked = await runVibe64WorkflowSessionAction("use_existing_pr", {
        input: {
          prRef: "#88"
        },
        targetRoot
      });

      assert.equal(blocked.status, "blocked");
      assert.match(blocked.message, /cannot be used as a stacked PR base/u);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });
});

test("vibe64 runtime prompt handoff shows the action input outside hidden terminal context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const promptPackRoot = path.join(targetRoot, "prompt-pack");
    await mkdir(promptPackRoot, {
      recursive: true
    });
    await writeFile(
      path.join(promptPackRoot, "agent_conversation.txt"),
      [
        "Agent conversation"
      ].join("\n"),
      "utf8"
    );

    const runtime = new Vibe64SessionRuntime({
      adapter: new PromptRendererFakeAdapter({
        promptPackRoot
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: worktreeMetadata(targetRoot, "agent_prompt_visible_input"),
      sessionId: "agent_prompt_visible_input",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });

    const afterAction = await runtime.runAction("agent_prompt_visible_input", "agent_conversation", {
      conversationRequest: "Explain this codebase."
    });

    assert.equal(afterAction.actionResult.status, "prompt_ready");
    assert.equal(afterAction.actionResult.promptId, "agent_conversation");
    assert.equal(afterAction.actionResult.recordsConversationTurn, true);
    assert.match(
      afterAction.actionResult.codexPromptHandoff.terminalInput,
      /^Explain this codebase\.\n\n\[\[VIBE64_CONTEXT_START\]\]/u
    );
    assert.match(afterAction.actionResult.codexPromptHandoff.prompt, /User\/request input:\n- conversationRequest: Explain this codebase\./u);
    assert.doesNotMatch(afterAction.actionResult.codexPromptHandoff.prompt, /"conversationRequest": "Explain this codebase\."/u);
    assert.equal((await runtime.getSession("agent_prompt_visible_input")).currentStep, "maintenance_conversation");
  });
});

test("vibe64 runtime presents waiting_for_input as the same Codex conversation intent", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: worktreeMetadata(targetRoot, "prompt_response_resume"),
      sessionId: "prompt_response_resume",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });

    await runtime.runAction("prompt_response_resume", "agent_conversation", {
      conversationRequest: "Ask the user what to do."
    });
    await runtime.submitCurrentStepInput("prompt_response_resume", {
      kind: "waiting_for_input",
      message: "What food should I use?",
      source: "codex",
      stepId: "maintenance_conversation",
      stepStatus: "awaiting_agent_result"
    });

    const waiting = await runtime.getSession("prompt_response_resume");
    assert.equal(waiting.stepMachine.status, "waiting_for_input");
    assert.equal(waiting.presentation.screen.kind, "conversation");
    assert.equal(waiting.presentation.screen.input.submitTarget, "intent");
    assert.equal(waiting.presentation.screen.primaryIntentId, "talk_to_codex");
    assert.equal(waiting.presentation.screen.message, "What food should I use?");
    assert.deepEqual(waiting.intents.map((intent) => intent.id), ["talk_to_codex"]);
    assert.equal(waiting.intents[0].actionId, "agent_conversation");
    assert.deepEqual(waiting.intents[0].input?.questionSugar, {
      fieldName: "conversationRequest",
      kind: "numbered_questions",
      source: "latest_assistant_message"
    });
    assert.equal(waiting.intents[0].inputFields[0].name, "conversationRequest");
    const afterAnswer = await runtime.runIntent("prompt_response_resume", "talk_to_codex", {
      fields: {
        conversationRequest: "Use Pescara."
      },
      stepId: waiting.currentStep,
      stepStatus: waiting.stepMachine.status
    });

    assert.equal(afterAnswer.stepMachine.status, "awaiting_agent_result");
    assert.equal(afterAnswer.actionResult.status, "prompt_ready");
    assert.equal(afterAnswer.actionResult.recordsConversationTurn, true);
    assert.match(afterAnswer.actionResult.codexPromptHandoff.terminalInput, /^Use Pescara\.\n\n\[\[VIBE64_CONTEXT_START\]\]/u);
  });
});

test("vibe64 presentation omits unavailable continue controls while Codex waits for input", () => {
  const waiting = applyWorkflowPresentation({
    actions: [
      {
        enabled: true,
        id: "agent_conversation",
        inputFields: [
          {
            kind: "textarea",
            label: "Response",
            name: "conversationRequest"
          }
        ],
        label: "Send to Codex"
      }
    ],
    currentStep: "maintenance_conversation",
    currentStepDefinition: {
      interaction: {
        actionId: "agent_conversation",
        fields: [
          {
            kind: "textarea",
            label: "Response",
            name: "conversationRequest"
          }
        ],
        intentId: "talk_to_codex",
        kind: "conversation",
        prompt: "What should happen next?",
        submitLabel: "Send to Codex",
        title: "Talk to Codex"
      },
      label: "Talk to Codex"
    },
    next: {
      disabledReason: "Answer Codex before continuing.",
      enabled: false,
      label: "Next step",
      stepId: "local_session_finished",
      visible: true
    },
    stepMachine: {
      status: "waiting_for_input"
    },
    workflowAutopilot: {
      kind: "agent_conversation",
      stop: true
    },
    workflowPresentation: null
  });

  assert.deepEqual(waiting.intents.map((intent) => intent.id), ["talk_to_codex"]);
});

test("chat-with-ai step instructions make completion ownership explicit", () => {
  const userDecidedInstruction = currentStepPromptInputInstruction({
    currentStep: "maintenance_conversation",
    stepMachine: {
      status: "ready"
    }
  }, {}, {
    runtime: coreWorkflowStepMachineRuntime
  });
  const aiDecidedInstruction = currentStepPromptInputInstruction({
    currentStep: "implementation_reviewed",
    stepMachine: {
      status: "ready"
    }
  }, {}, {
    runtime: coreWorkflowStepMachineRuntime
  });
  const finalReviewInstruction = currentStepPromptInputInstruction({
    currentStep: "changes_accepted",
    stepMachine: {
      status: "ready"
    }
  }, {}, {
    runtime: coreWorkflowStepMachineRuntime
  });

  assert.match(
    userDecidedInstruction,
    /The current Codex conversation turn is complete\. The user decides whether to ask another question or continue\./u
  );
  assert.match(
    aiDecidedInstruction,
    /You decide this AI discussion turn is complete only when: the requested focused tweak has either been made/u
  );
  assert.match(
    finalReviewInstruction,
    /You decide this AI discussion turn is complete only when: the requested final tweak has either been made/u
  );
  assert.doesNotMatch(
    aiDecidedInstruction,
    /The user decides whether to ask another question or continue/u
  );
});

test("vibe64 runtime reuses the persisted prompt context snapshot for later prompt actions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        promptContext: {
          helper_map: ".jskit/helper-map.md",
          marker: "first"
        }
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: worktreeMetadata(targetRoot, "prompt_context_snapshot"),
      sessionId: "prompt_context_snapshot"
    });

    const afterFirstPrompt = await runtime.runAction("prompt_context_snapshot", "make_plan");
    assert.equal(afterFirstPrompt.actionResult.promptContext.adapter.promptContext.marker, "first");

    const snapshot = await runtime.store.readPromptContextSnapshot("prompt_context_snapshot");
    assert.equal(snapshot.adapter.promptContext.helper_map, ".jskit/helper-map.md");
    assert.equal(snapshot.adapter.promptContext.marker, "first");
    await runtime.submitCurrentStepInput("prompt_context_snapshot", {
      kind: "ready",
      source: "codex",
      stepId: "plan_and_execute",
      stepStatus: "awaiting_agent_result"
    });

    class ThrowingInspectionAdapter extends FakeTargetAdapter {
      async inspect() {
        throw new Error("Prompt actions should use the persisted snapshot, not live inspection.");
      }

      async getPromptContext() {
        throw new Error("Prompt actions should use the persisted snapshot, not live prompt context.");
      }
    }

    const restartedRuntime = new Vibe64SessionRuntime({
      adapter: new ThrowingInspectionAdapter({
        promptContext: {
          marker: "second"
        }
      }),
      targetRoot
    });

    const afterSecondPrompt = await restartedRuntime.runAction("prompt_context_snapshot", "execute_plan");
    assert.equal(afterSecondPrompt.actionResult.promptContext.adapter.promptContext.marker, "first");
    assert.match(afterSecondPrompt.actionResult.prompt, /"marker": "first"/u);
    assert.doesNotMatch(afterSecondPrompt.actionResult.prompt, /"marker": "second"/u);
  });
});

test("vibe64 runtime sends static adapter context once and references it later", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const promptPackRoot = path.join(targetRoot, "prompt-pack");
    await mkdir(promptPackRoot, {
      recursive: true
    });
    await writeFile(
      path.join(promptPackRoot, "make_plan.txt"),
      [
        "Make plan action.",
        "{{prompt.sessionBriefingReference}}",
        "Facts: {{adapter.facts.json}}",
        "Blueprint: {{adapter.promptContext.environment_blueprint}}",
        "Services: {{adapter.managedServices.json}}",
        "Config: {{config.json}}"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(promptPackRoot, "execute_plan.txt"),
      [
        "Execute plan action.",
        "{{prompt.sessionBriefingReference}}",
        "Facts: {{adapter.facts.json}}",
        "Blueprint: {{adapter.promptContext.environment_blueprint}}",
        "Services: {{adapter.managedServices.json}}",
        "Config: {{config.json}}"
      ].join("\n"),
      "utf8"
    );

    const runtime = new Vibe64SessionRuntime({
      adapter: new PromptRendererFakeAdapter({
        facts: {
          summary: "Large static project summary"
        },
        promptContext: {
          environment_blueprint: "Large static environment blueprint"
        },
        promptPackRoot
      }),
      projectConfig: {
        values: {
          static_config: "large-static-config"
        }
      },
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: worktreeMetadata(targetRoot, "session_briefing_once"),
      sessionId: "session_briefing_once"
    });

    const firstPrompt = await runtime.runAction("session_briefing_once", "make_plan");
    assert.match(firstPrompt.actionResult.prompt, /Vibe64 session briefing/u);
    assert.doesNotMatch(firstPrompt.actionResult.prompt, /Large static project summary/u);
    assert.match(firstPrompt.actionResult.prompt, /Adapter project facts are runtime-only Studio metadata/u);
    assert.match(firstPrompt.actionResult.prompt, /Large static environment blueprint/u);
    assert.match(firstPrompt.actionResult.prompt, /large-static-config/u);

    await runtime.store.writeMetadataValue("session_briefing_once", "codex_session_briefing_delivered", "yes");
    await runtime.submitCurrentStepInput("session_briefing_once", {
      kind: "ready",
      source: "codex",
      stepId: "plan_and_execute",
      stepStatus: "awaiting_agent_result"
    });
    const secondPrompt = await runtime.runAction("session_briefing_once", "execute_plan");

    assert.doesNotMatch(secondPrompt.actionResult.prompt, /Vibe64 session briefing\n\nThis briefing is sent once/u);
    assert.doesNotMatch(secondPrompt.actionResult.prompt, /Large static project summary/u);
    assert.doesNotMatch(secondPrompt.actionResult.prompt, /Large static environment blueprint/u);
    assert.doesNotMatch(secondPrompt.actionResult.prompt, /large-static-config/u);
    assert.match(secondPrompt.actionResult.prompt, /Use the Vibe64 session briefing already provided/u);
    assert.equal(secondPrompt.actionResult.promptContext.adapter.facts.summary, "Large static project summary");
    assert.equal(
      secondPrompt.actionResult.promptContext.adapter.promptContext.environment_blueprint,
      "Large static environment blueprint"
    );
  });
});

test("vibe64 runtime disables executable actions while a step machine is waiting on Codex", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...worktreeMetadata(targetRoot, "merge_prompt_busy"),
        pr_url: "https://github.com/example/project/pull/99"
      },
      sessionId: "merge_prompt_busy"
    });

    const session = await runtime.runAction("merge_prompt_busy", "prepare_for_merge");
    assert.equal(session.stepMachine.status, "awaiting_agent_result");
    assert.equal(session.actions.find((action) => action.id === "open_pr")?.enabled, true);
    assert.equal(session.actions.find((action) => action.id === "prepare_for_merge")?.enabled, false);
    assert.equal(
      session.actions.find((action) => action.id === "prepare_for_merge")?.disabledReason,
      "Wait for Codex to finish this step."
    );
    assert.equal(session.actions.find((action) => action.id === "merge_pr")?.enabled, false);

    await assert.rejects(
      () => runtime.runAction("merge_prompt_busy", "merge_pr"),
      {
        code: "vibe64_action_disabled",
        message: "Wait for Codex to finish this step."
      }
    );
  });
});

test("vibe64 merge preparation stores an optional post-creation summary", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...worktreeMetadata(targetRoot, "merge_preparation_summary"),
        pr_url: "https://github.com/example/project/pull/99"
      },
      sessionId: "merge_preparation_summary"
    });

    const promptSession = await runtime.runAction("merge_preparation_summary", "prepare_for_merge");
    assert.match(promptSession.actionResult.prompt, /mergePreparationSummary/u);

    const prepared = await runtime.submitCurrentStepInput("merge_preparation_summary", {
      fields: {
        mergePreparationSummary: "- Resolved a merge conflict before merging."
      },
      kind: "ready",
      source: "codex",
      stepId: "create_and_merge_pull_request",
      stepStatus: "awaiting_agent_result"
    });
    assert.equal(prepared.stepMachine.status, "ready");
    assert.equal(prepared.metadata.merge_preparation_summary, "- Resolved a merge conflict before merging.");
  });
});

test("vibe64 runtime disables prompt actions while the terminal is active", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_worktree: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: {
        ...worktreeMetadata(targetRoot, "terminal_active"),
        terminal_active: "true"
      },
      sessionId: "terminal_active"
    });

    const session = await runtime.getSession("terminal_active");
    const makePlanAction = session.actions.find((action) => action.id === "make_plan");
    assert.equal(makePlanAction?.enabled, false);
    assert.equal(makePlanAction?.disabledReason, "Codex terminal is active.");
    await assert.rejects(
      () => runtime.runAction("terminal_active", "make_plan"),
      {
        code: "vibe64_action_disabled",
        message: "Codex terminal is active."
      }
    );
  });
});

test("vibe64 runtime disables prompt actions before the session worktree exists", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      sessionId: "prompt_without_worktree"
    });

    const session = await runtime.getSession("prompt_without_worktree");
    const makePlanAction = session.actions.find((action) => action.id === "make_plan");
    assert.equal(makePlanAction?.enabled, false);
    assert.equal(makePlanAction?.disabledReason, "Create the session worktree before asking Codex.");
    assert.equal(session.presentation.auto.nextOperation.kind, "stop");
    assert.equal(session.presentation.auto.nextOperation.executable, false);
    assert.equal(session.presentation.auto.nextOperation.reason, "Create the session worktree before asking Codex.");
    await assert.rejects(
      () => runtime.runAction("prompt_without_worktree", "make_plan"),
      {
        code: "vibe64_action_disabled",
        message: "Create the session worktree before asking Codex."
      }
    );
  });
});

test("vibe64 runtime rejects actions that are not available on the current step", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      sessionId: "wrong_action"
    });

    await assert.rejects(
      () => runtime.runAction("wrong_action", "install_dependencies"),
      {
        code: "vibe64_action_not_available"
      }
    );
  });
});

test("vibe64 runtime recovers a stuck in-flight command step back to ready", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "dependencies_installed",
      sessionId: "recover_stuck_command",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });
    await runtime.recordCommandActionStarted("recover_stuck_command", "install_dependencies");

    const stuckSession = await runtime.getSession("recover_stuck_command");
    assert.equal(stuckSession.stepMachine.status, "attempting_execution");

    const recoveredSession = await runtime.recoverStuckStep("recover_stuck_command");
    assert.equal(recoveredSession.currentStep, "dependencies_installed");
    assert.equal(recoveredSession.stepMachine.status, "ready");
    assert.equal(recoveredSession.next.enabled, false);

    const commandLog = await runtime.store.readCommandLog("recover_stuck_command");
    assert.deepEqual(commandLog.at(-1), {
      at: commandLog.at(-1).at,
      fromStatus: "attempting_execution",
      kind: "recover-stuck-step",
      message: "Recovered stuck command execution. Re-run the current step.",
      stepId: "dependencies_installed",
      toStatus: "ready"
    });
  });
});

test("vibe64 runtime presentation owns command recovery availability", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "dependencies_installed",
      sessionId: "server_owned_command_recovery",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });
    await runtime.recordCommandActionStarted("server_owned_command_recovery", "install_dependencies");

    const applyingSession = await runtime.getSession("server_owned_command_recovery");
    assert.equal(applyingSession.stepMachine.status, "attempting_execution");
    assert.equal(applyingSession.presentation.command.applying, true);
    assert.equal(applyingSession.presentation.recovery.available, false);

    await runtime.store.writeCommandLifecycleEvent(
      "server_owned_command_recovery",
      `${applyingSession.stepRevision}-install_dependencies`,
      {
        patch: {
          actionId: "install_dependencies",
          phase: "result_written",
          stepId: applyingSession.currentStep,
          stepRevision: applyingSession.stepRevision
        },
        event: {
          kind: "result_written"
        }
      }
    );

    const recoverableSession = await runtime.getSession("server_owned_command_recovery");
    assert.equal(recoverableSession.presentation.command.applying, false);
    assert.equal(recoverableSession.presentation.command.state, "stalled");
    assert.equal(recoverableSession.presentation.recovery.available, true);
    assert.equal(recoverableSession.presentation.recovery.reason, "workflow_state_stalled");
  });
});

test("vibe64 runtime refuses stuck-step recovery unless the step is attempting execution", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "dependencies_installed",
      sessionId: "recover_not_stuck",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });

    await assert.rejects(
      () => runtime.recoverStuckStep("recover_not_stuck"),
      {
        code: "vibe64_step_recovery_not_available"
      }
    );
  });
});

test("vibe64 runtime keeps disabled actions visible and rejects execution with the disabled reason", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot,
      workflow: {
        id: "disabled_action",
        steps: [
          {
            actions: [
              {
                enabledWhen: [when.metadataExists("ready")],
                id: "blocked_action",
                label: "Blocked action"
              }
            ],
            id: "first",
            label: "First"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "disabled_action"
    });

    const session = await runtime.getSession("disabled_action");
    assert.deepEqual(session.actions, [
      {
        disabledReason: "Waiting for metadata: ready.",
        dispatchRoute: "command-terminal",
        enabled: false,
        icon: "code",
        id: "blocked_action",
        label: "Blocked action",
        type: "command",
        visible: true
      }
    ]);
    await assert.rejects(
      () => runtime.runAction("disabled_action", "blocked_action"),
      {
        code: "vibe64_action_disabled",
        message: "Waiting for metadata: ready."
      }
    );
  });
});

test("vibe64 runtime blocks advance when workflow next conditions are not met", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const workflow = {
      id: "conditioned",
      steps: [
        {
          id: "first",
          label: "First",
          next: {
            enabledWhen: [when.metadataExists("ready")]
          }
        },
        {
          id: "second",
          label: "Second"
        }
      ]
    };
    const runtime = new Vibe64SessionRuntime({
      targetRoot,
      workflow
    });
    await runtime.createSession({
      sessionId: "conditioned"
    });

    const blocked = await runtime.getSession("conditioned");
    assert.equal(blocked.currentStep, "first");
    assert.equal(blocked.next.visible, true);
    assert.equal(blocked.next.enabled, false);
    assert.equal(blocked.next.label, "Next step");
    assert.equal(blocked.next.disabledReason, "Waiting for metadata: ready.");
    await assert.rejects(
      () => runtime.advance("conditioned"),
      /Waiting for metadata: ready/u
    );

    await runtime.store.writeMetadataValue("conditioned", "ready", "yes");
    const advanced = await runtime.advance("conditioned");
    assert.equal(advanced.currentStep, "second");
    assert.deepEqual(advanced.completedSteps, ["first"]);
  });
});

test("vibe64 project validation requires code index and automated checks", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          run_automated_checks: true,
          update_code_index: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "review_and_validate",
      metadata: worktreeMetadata(targetRoot, "review_and_validate"),
      sessionId: "review_and_validate"
    });

    const beforeIndex = await runtime.getSession("review_and_validate");
    assert.equal(beforeIndex.next.enabled, false);
    assert.deepEqual(beforeIndex.actions.map((action) => ({
      enabled: action.enabled,
      id: action.id
    })), [
      {
        enabled: true,
        id: "run_deslop"
      },
      {
        enabled: false,
        id: "update_code_index"
      },
      {
        enabled: false,
        id: "run_automated_checks"
      }
    ]);

    await runtime.store.writeMetadataValue("review_and_validate", "review_deslop_completed", "yes");
    const afterReview = await runtime.getSession("review_and_validate");
    assert.equal(afterReview.next.enabled, false);
    assert.equal(afterReview.actions[1].enabled, true);

    await runtime.store.writeMetadataValue("review_and_validate", "code_index_updated", "yes");
    const afterIndex = await runtime.getSession("review_and_validate");
    assert.equal(afterIndex.next.enabled, false);
    assert.equal(afterIndex.actions[2].enabled, true);

    await runtime.store.writeMetadataValue("review_and_validate", "automated_checks_passed", "yes");
    const afterChecks = await runtime.getSession("review_and_validate");
    assert.equal(afterChecks.next.enabled, true);
    assert.equal(afterChecks.next.stepId, "changes_accepted");

    const afterHumanReview = await runtime.advance("review_and_validate");
    assert.equal(afterHumanReview.currentStep, "changes_accepted");
    assert.equal(afterHumanReview.currentStepDefinition.label, "Final human review");
    assert.equal(afterHumanReview.next.stepId, "report_and_update_knowledge");

    const reportStep = await runtime.advance("review_and_validate");
    assert.equal(reportStep.currentStep, "report_and_update_knowledge");
    assert.equal(reportStep.next.enabled, false);
    assert.equal(reportStep.next.disabledReason, "Write the report and update project knowledge before continuing.");

    await runtime.store.writeArtifact("review_and_validate", "report.md", "# Report\n");
    const afterReport = await runtime.getSession("review_and_validate");
    assert.equal(afterReport.next.enabled, false);
    await runtime.store.writeMetadataValue("review_and_validate", "project_knowledge_updated", "yes");
    const afterKnowledge = await runtime.getSession("review_and_validate");
    assert.equal(afterKnowledge.next.enabled, true);
    assert.equal(afterKnowledge.next.stepId, "changes_committed");
  });
});

test("vibe64 runtime validates initial workflow steps", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });

    const session = await runtime.createSession({
      initialStep: "plan_and_execute",
      sessionId: "starts_at_plan"
    });
    assert.equal(session.currentStep, "plan_and_execute");

    await assert.rejects(
      () => runtime.createSession({
        initialStep: "not_a_step",
        sessionId: "bad_initial_step"
      }),
      /Unknown Vibe64 workflow step/u
    );
  });
});

test("vibe64 workflow rejects duplicate action ids inside a step", () => {
  assert.throws(
    () => new WorkflowMachine({
      workflow: {
        id: "bad_actions",
        steps: [
          {
            actions: [
              {
                id: "same",
                label: "First"
              },
              {
                id: "same",
                label: "Second"
              }
            ],
            id: "first",
            label: "First"
          }
        ]
      }
    }),
    /Duplicate Vibe64 workflow action id/u
  );
});

test("vibe64 workflow accepts structured condition forms and keeps runtime checks stable", () => {
  const machine = new WorkflowMachine({
    workflow: {
      id: "condition_forms",
      steps: [
        {
          id: "intro",
          label: "Intro"
        },
        {
          actions: [
            {
              enabledWhen: [
                when.always(),
                when.sessionActive(),
                when.metadataExists("ready"),
                when.any(
                  when.metadataExists("missing"),
                  when.metadataExists("any_ready")
                ),
                when.artifactReady("one.md"),
                when.allArtifactsReady("two.md", "three.md"),
                when.actionInputExists("collect", "answer"),
                when.stepCompleted("intro")
              ],
              id: "requires_conditions",
              label: "Requires conditions"
            }
          ],
          id: "first",
          label: "First"
        }
      ]
    }
  });

  const session = machine.buildSessionView({
    actionResults: [
      {
        actionId: "collect",
        at: "2026-05-16T01:02:03.000Z",
        input: {
          answer: "yes"
        }
      }
    ],
    artifactReadiness: {
      "one.md": {
        nonEmpty: true
      },
      "three.md": {
        nonEmpty: true
      },
      "two.md": {
        nonEmpty: true
      }
    },
    completedSteps: ["intro"],
    currentStep: "first",
    metadata: {
      any_ready: "yes",
      ready: "yes"
    },
    status: VIBE64_SESSION_STATUS.ACTIVE
  });

  assert.equal(session.actions[0].enabled, true);
});

test("vibe64 workflow rejects condition strings during construction", () => {
  assert.throws(
    () => new WorkflowMachine({
      workflow: {
        id: "string_condition_forms",
        steps: [
          {
            actions: [
              {
                enabledWhen: ["metadata:ready"],
                id: "requires_structured_conditions",
                label: "Requires structured conditions"
              }
            ],
            id: "first",
            label: "First"
          }
        ]
      }
    }),
    (error) => {
      assert.equal(error.code, "vibe64_workflow_malformed_condition");
      assert.match(error.message, /Condition must be a condition object/u);
      assert.match(error.message, /metadata:ready/u);
      return true;
    }
  );
});

test("vibe64 workflow rejects unknown nested structured condition kinds during construction", () => {
  assert.throws(
    () => new WorkflowMachine({
      workflow: {
        id: "bad_condition_prefix",
        steps: [
          {
            id: "first",
            label: "First",
            next: {
              enabledWhen: [
                when.any(
                  when.metadataExists("ready"),
                  {
                    kind: "unknown",
                    value: "ready"
                  }
                )
              ]
            }
          },
          {
            id: "second",
            label: "Second"
          }
        ]
      }
    }),
    (error) => {
      assert.equal(error.code, "vibe64_workflow_unknown_condition");
      assert.match(error.message, /Unknown Vibe64 workflow condition/u);
      assert.match(error.message, /kind:unknown/u);
      return true;
    }
  );
});

test("vibe64 workflow rejects malformed structured condition values during construction", () => {
  assert.throws(
    () => new WorkflowMachine({
      workflow: {
        id: "bad_action_input_condition_value",
        steps: [
          {
            actions: [
              {
                enabledWhen: [when.actionInputExists("collect", "")],
                id: "blocked",
                label: "Blocked"
              }
            ],
            id: "first",
            label: "First"
          }
        ]
      }
    }),
    (error) => {
      assert.equal(error.code, "vibe64_workflow_malformed_condition");
      assert.match(error.message, /Malformed Vibe64 workflow condition/u);
      assert.match(error.message, /Action input conditions require an input name/u);
      return true;
    }
  );
});

test("vibe64 workflow rejects malformed structured condition lists during construction", () => {
  assert.throws(
    () => new WorkflowMachine({
      workflow: {
        id: "bad_structured_condition_value",
        steps: [
          {
            actions: [
              {
                enabledWhen: [when.allArtifactsReady("one.md", "")],
                id: "blocked",
                label: "Blocked"
              }
            ],
            id: "first",
            label: "First"
          }
        ]
      }
    }),
    (error) => {
      assert.equal(error.code, "vibe64_workflow_malformed_condition");
      assert.match(error.message, /Artifacts conditions require one or more artifact names/u);
      return true;
    }
  );
});
