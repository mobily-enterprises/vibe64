import { normalizeNamespace } from "./terminalSessionViews.js";

// Admission of new terminal work per namespace: frozen while a namespace is
// closed, with a count of the operations still running in it.
const namespaceAdmissions = new Map();
const namespaceOperationCounts = new Map();

function terminalNamespaceAdmission(namespace = "default") {
  return namespaceAdmissions.get(normalizeNamespace(namespace)) || null;
}

function terminalNamespaceAdmissionFailure(namespace = "default") {
  const admission = terminalNamespaceAdmission(namespace);
  if (!admission) {
    return null;
  }
  return {
    code: admission.code,
    error: admission.error,
    ok: false
  };
}

function freezeTerminalNamespaceAdmission(namespace = "default", {
  code = "terminal_admission_frozen",
  error = "Terminal input is temporarily unavailable.",
  owner = ""
} = {}) {
  const normalizedNamespace = normalizeNamespace(namespace);
  const normalizedOwner = String(owner || "").trim();
  if (!normalizedOwner) {
    throw new TypeError("Terminal admission freeze requires an owner.");
  }
  const current = namespaceAdmissions.get(normalizedNamespace);
  if (current && current.owner !== normalizedOwner) {
    return {
      code: "terminal_admission_conflict",
      error: "Terminal input is already frozen by another operation.",
      ok: false
    };
  }
  if (!current && Number(namespaceOperationCounts.get(normalizedNamespace) || 0) > 0) {
    return {
      code: "terminal_admission_busy",
      error: "A terminal operation is still finishing.",
      ok: false
    };
  }
  const admission = current || {
    code: String(code || "terminal_admission_frozen").trim() || "terminal_admission_frozen",
    error: String(error || "Terminal input is temporarily unavailable.").trim() ||
      "Terminal input is temporarily unavailable.",
    owner: normalizedOwner
  };
  namespaceAdmissions.set(normalizedNamespace, admission);
  return {
    frozen: true,
    namespace: normalizedNamespace,
    ok: true,
    owner: normalizedOwner
  };
}

function beginTerminalNamespaceOperation(namespace = "default") {
  const normalizedNamespace = normalizeNamespace(namespace);
  const failure = terminalNamespaceAdmissionFailure(normalizedNamespace);
  if (failure) {
    return failure;
  }
  namespaceOperationCounts.set(
    normalizedNamespace,
    Number(namespaceOperationCounts.get(normalizedNamespace) || 0) + 1
  );
  let released = false;
  return {
    namespace: normalizedNamespace,
    ok: true,
    release() {
      if (released) {
        return;
      }
      released = true;
      const remaining = Number(namespaceOperationCounts.get(normalizedNamespace) || 0) - 1;
      if (remaining > 0) {
        namespaceOperationCounts.set(normalizedNamespace, remaining);
      } else {
        namespaceOperationCounts.delete(normalizedNamespace);
      }
    }
  };
}

function thawTerminalNamespaceAdmission(namespace = "default", {
  owner = ""
} = {}) {
  const normalizedNamespace = normalizeNamespace(namespace);
  const normalizedOwner = String(owner || "").trim();
  if (!normalizedOwner) {
    throw new TypeError("Terminal admission thaw requires an owner.");
  }
  const current = namespaceAdmissions.get(normalizedNamespace);
  if (!current) {
    return {
      frozen: false,
      namespace: normalizedNamespace,
      ok: true,
      owner: normalizedOwner
    };
  }
  if (current.owner !== normalizedOwner) {
    return {
      code: "terminal_admission_conflict",
      error: "Terminal input is frozen by another operation.",
      ok: false
    };
  }
  namespaceAdmissions.delete(normalizedNamespace);
  return {
    frozen: false,
    namespace: normalizedNamespace,
    ok: true,
    owner: normalizedOwner
  };
}

export {
  beginTerminalNamespaceOperation,
  freezeTerminalNamespaceAdmission,
  namespaceAdmissions,
  namespaceOperationCounts,
  terminalNamespaceAdmission,
  terminalNamespaceAdmissionFailure,
  thawTerminalNamespaceAdmission
};
