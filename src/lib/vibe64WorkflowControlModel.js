function arrayItems(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function booleanishTrue(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

function booleanishFalse(value) {
  return value === false || String(value || "").trim().toLowerCase() === "false";
}

function normalizeControlList(controls = []) {
  return arrayItems(controls).filter((control) => control && control.id && control.label);
}

function currentStepPresentationControls({
  actions = [],
  interaction = {},
  session = {}
} = {}) {
  const sources = [
    session?.intents,
    session?.presentation?.intents,
    interaction?.intents
  ];
  for (const source of sources) {
    const controls = normalizeControlList(source);
    if (controls.length > 0) {
      return controls.map((control) => presentationWorkflowControl(control, actions));
    }
  }
  return [];
}

function actionById(actions = [], actionId = "") {
  const normalizedActionId = String(actionId || "").trim();
  if (!normalizedActionId) {
    return null;
  }
  return arrayItems(actions)
    .find((action) => String(action?.id || "").trim() === normalizedActionId) || null;
}

function presentationWorkflowControl(control = {}, actions = []) {
  const sourceAction = actionById(actions, control.actionId);
  if (!sourceAction) {
    return control;
  }
  return {
    ...control,
    disabledReason: control.disabledReason || sourceAction.disabledReason || "",
    enabled: control.enabled === true && sourceAction.enabled === true,
    sourceAction
  };
}

function actionWorkflowControl(action = {}) {
  const sourceAction = objectValue(action);
  const id = String(sourceAction?.id || "").trim();
  const inputFields = arrayItems(sourceAction?.inputFields);
  if (!sourceAction || !id || sourceAction.visible === false || inputFields.length < 1) {
    return null;
  }
  return {
    actionId: id,
    autoOpen: false,
    disabledReason: String(sourceAction.disabledReason || ""),
    dispatchRoute: String(sourceAction.dispatchRoute || ""),
    enabled: sourceAction.enabled === true,
    id,
    inputFields,
    label: String(sourceAction.label || id),
    sourceAction,
    style: sourceAction.style || "primary"
  };
}

function actionWorkflowControls(actions = []) {
  return arrayItems(actions)
    .map(actionWorkflowControl)
    .filter(Boolean);
}

function currentStepWorkflowControls({
  actions = [],
  interaction = {},
  session = {}
} = {}) {
  const presentationControls = currentStepPresentationControls({
    actions,
    interaction,
    session
  });
  return presentationControls.length > 0
    ? presentationControls
    : actionWorkflowControls(actions);
}

function workflowControlSourceAction(control = {}) {
  return objectValue(control?.sourceAction);
}

function workflowControlButtonPresentation(control = {}) {
  return {
    buttonColor: "primary",
    buttonVariant: control?.style === "primary" ? "flat" : "outlined"
  };
}

function workflowControlButtonVisible(control = {}) {
  if (!control || typeof control !== "object") {
    return false;
  }
  if (booleanishTrue(control.hidden) || control.visible === false) {
    return false;
  }
  if (booleanishTrue(control.loading)) {
    return true;
  }
  return !(
    booleanishTrue(control.disabled) ||
    booleanishFalse(control.enabled)
  );
}

function visibleWorkflowButtonControls(controls = []) {
  return arrayItems(controls).filter(workflowControlButtonVisible);
}

export {
  actionWorkflowControl,
  actionWorkflowControls,
  currentStepPresentationControls,
  currentStepWorkflowControls,
  visibleWorkflowButtonControls,
  workflowControlButtonVisible,
  workflowControlButtonPresentation,
  workflowControlSourceAction
};
