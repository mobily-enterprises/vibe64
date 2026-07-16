const PROJECT_SETUP_KIND_INITIALIZATION = "initialization";
const PROJECT_SETUP_KIND_SEED = "seed";
const SEED_WORKFLOW_DEFINITION_ID = "seed_application";

function projectSetupSessionKind(session = {}) {
  const metadata = session?.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  const workflowDefinitionId = String(
    session?.workflowId ||
      session?.workflowDefinition?.id ||
      session?.workflowDefinitionId ||
      metadata.workflow_definition_id ||
      metadata.workflow_definition ||
      ""
  ).trim();
  const workSource = String(metadata.work_source || "").trim();
  if (workSource === PROJECT_SETUP_KIND_SEED || workflowDefinitionId === SEED_WORKFLOW_DEFINITION_ID) {
    return PROJECT_SETUP_KIND_SEED;
  }
  return workSource === PROJECT_SETUP_KIND_INITIALIZATION
    ? PROJECT_SETUP_KIND_INITIALIZATION
    : "";
}

function projectSetupSessionActiveMessage(sessionId = "") {
  const id = String(sessionId || "").trim();
  return id
    ? `Session ${id} is already setting up this project. Finish or abandon that setup session before creating another session.`
    : "This project is already being set up. Finish or abandon the setup session before creating another session.";
}

export {
  PROJECT_SETUP_KIND_INITIALIZATION,
  PROJECT_SETUP_KIND_SEED,
  projectSetupSessionKind,
  projectSetupSessionActiveMessage
};
