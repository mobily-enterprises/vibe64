const WORKFLOW_DRIVER_METADATA_KEYS = Object.freeze([
  "workflow_driver_email",
  "workflow_driver_origin_id",
  "workflow_driver_reason",
  "workflow_driver_updated_at",
  "workflow_driver_user_key"
]);

function normalizeWorkflowDriverValue(value = "") {
  return String(value || "").trim();
}

function workflowDriverUserKey(vibe64User = null) {
  return normalizeWorkflowDriverValue(vibe64User?.email).toLowerCase();
}

function workflowDriverEmail(vibe64User = null) {
  return normalizeWorkflowDriverValue(vibe64User?.email).toLowerCase();
}

function workflowDriverOwnerKey(driver = {}) {
  return normalizeWorkflowDriverValue(driver.userKey || driver.email).toLowerCase();
}

function workflowDriverRequestedUserKey(vibe64User = null) {
  return workflowDriverUserKey(vibe64User) || workflowDriverEmail(vibe64User);
}

function workflowDriverFromSession(session = {}) {
  const metadata = session?.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  return {
    email: normalizeWorkflowDriverValue(metadata.workflow_driver_email),
    originId: normalizeWorkflowDriverValue(metadata.workflow_driver_origin_id),
    reason: normalizeWorkflowDriverValue(metadata.workflow_driver_reason),
    updatedAt: normalizeWorkflowDriverValue(metadata.workflow_driver_updated_at),
    userKey: normalizeWorkflowDriverValue(metadata.workflow_driver_user_key)
  };
}

function workflowDriverError(message = "", code = "vibe64_workflow_driver_failed", extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function assertSessionWorkflowDriverOrigin(originId = "") {
  const normalizedOriginId = normalizeWorkflowDriverValue(originId);
  if (!normalizedOriginId) {
    throw workflowDriverError(
      "Session workflow actions require a browser tab origin.",
      "vibe64_workflow_driver_origin_required",
      {
        statusCode: 400
      }
    );
  }
  return normalizedOriginId;
}

function workflowDriverMetadata({
  originId = "",
  reason = "",
  vibe64User = null
} = {}) {
  return {
    workflow_driver_email: workflowDriverEmail(vibe64User),
    workflow_driver_origin_id: normalizeWorkflowDriverValue(originId),
    workflow_driver_reason: normalizeWorkflowDriverValue(reason),
    workflow_driver_updated_at: new Date().toISOString(),
    workflow_driver_user_key: workflowDriverUserKey(vibe64User)
  };
}

async function writeWorkflowDriverMetadata(runtime, sessionId = "", metadata = {}) {
  const entries = Object.entries(metadata)
    .filter(([name]) => WORKFLOW_DRIVER_METADATA_KEYS.includes(name));
  if (!entries.length) {
    return;
  }
  await Promise.all(entries.map(([name, value]) => (
    runtime.store.writeMetadataValue(sessionId, name, String(value || ""))
  )));
}

async function claimSessionWorkflowDriver(runtime, sessionId = "", {
  originId = "",
  reason = "",
  vibe64User = null
} = {}) {
  const normalizedSessionId = normalizeWorkflowDriverValue(sessionId);
  const requestedOriginId = assertSessionWorkflowDriverOrigin(originId);
  if (!normalizedSessionId) {
    throw workflowDriverError(
      "Session workflow driver tracking requires a session id.",
      "vibe64_workflow_driver_session_required",
      {
        statusCode: 400
      }
    );
  }
  if (
    typeof runtime?.getSession !== "function" ||
    typeof runtime?.store?.mutateSession !== "function" ||
    typeof runtime?.store?.writeMetadataValue !== "function"
  ) {
    throw workflowDriverError(
      "Session workflow driver tracking requires session metadata storage.",
      "vibe64_workflow_driver_store_required",
      {
        statusCode: 500
      }
    );
  }
  return runtime.store.mutateSession(normalizedSessionId, async () => {
    const session = await runtime.getSession(normalizedSessionId);
    const existingDriver = workflowDriverFromSession(session);
    const existingUserKey = workflowDriverOwnerKey(existingDriver);
    const requestedUserKey = workflowDriverRequestedUserKey(vibe64User);
    const originChanged = Boolean(existingDriver.originId && existingDriver.originId !== requestedOriginId);
    const userChanged = Boolean(existingUserKey && requestedUserKey && existingUserKey !== requestedUserKey);
    if (userChanged) {
      throw workflowDriverError(
        "This session is already being driven by another user.",
        "vibe64_workflow_driver_user_mismatch",
        {
          requestedOriginId,
          requestedUserKey,
          statusCode: 409,
          workflowDriverOriginId: existingDriver.originId,
          workflowDriverUserKey: existingUserKey
        }
      );
    }
    if (originChanged && (!existingUserKey || !requestedUserKey)) {
      throw workflowDriverError(
        "This session is already being driven from another browser tab.",
        "vibe64_workflow_driver_origin_mismatch",
        {
          requestedOriginId,
          requestedUserKey,
          workflowDriverOriginId: existingDriver.originId,
          workflowDriverUserKey: existingUserKey,
          statusCode: 409
        }
      );
    }
    const metadata = workflowDriverMetadata({
      originId: requestedOriginId,
      reason,
      vibe64User
    });
    if (!requestedUserKey && existingUserKey) {
      metadata.workflow_driver_email = existingDriver.email;
      metadata.workflow_driver_user_key = existingDriver.userKey || existingDriver.email;
    }
    await writeWorkflowDriverMetadata(runtime, normalizedSessionId, metadata);
    return {
      claimed: true,
      ok: true,
      previousOriginId: originChanged ? existingDriver.originId : "",
      rebound: originChanged,
      session: await runtime.getSession(normalizedSessionId)
    };
  });
}

export {
  WORKFLOW_DRIVER_METADATA_KEYS,
  assertSessionWorkflowDriverOrigin,
  claimSessionWorkflowDriver,
  workflowDriverFromSession
};
