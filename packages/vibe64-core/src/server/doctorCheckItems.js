function createDoctorRepair({
  actionId,
  autoRun = false,
  command,
  fields = [],
  input,
  kind = "terminal",
  label
}) {
  const repair = {
    actionId,
    autoRun: autoRun === true,
    commandPreview: command,
    fields,
    kind,
    label
  };
  if (input !== undefined) {
    repair.input = input;
  }
  return repair;
}

function doctorCheckItem({
  explanation,
  expected,
  id,
  label,
  observed,
  repair = null,
  repairs = null,
  required = true,
  status
}) {
  const repairList = Array.isArray(repairs)
    ? repairs.filter(Boolean)
    : [repair].filter(Boolean);

  return {
    explanation,
    expected,
    id,
    label,
    observed: String(observed || "").trim() || "not available",
    repair: repair || repairList[0] || null,
    repairs: repairList,
    required,
    status
  };
}

function passDoctorCheck(details) {
  return doctorCheckItem({
    ...details,
    status: "pass"
  });
}

function blockedDoctorCheck(details) {
  return doctorCheckItem({
    ...details,
    status: "blocked"
  });
}

function failDoctorCheck(details) {
  return doctorCheckItem({
    ...details,
    status: "fail"
  });
}

function hardStopDoctorCheck(details) {
  return doctorCheckItem({
    ...details,
    status: "hard-stop"
  });
}

function pendingDoctorCheck(check = {}) {
  return doctorCheckItem({
    explanation: check.explanation || "This check runs after the previous required checks pass.",
    expected: check.expected || "This setup check has not run yet.",
    id: check.id,
    label: check.label || check.id,
    observed: check.observed || "Waiting for previous setup check.",
    required: check.required,
    status: "pending"
  });
}

function doctorCheckPassed(result = {}) {
  return result.required === false || result.status === "pass";
}

function formatDoctorList(items = [], limit = 12) {
  const values = items.filter(Boolean);
  if (!values.length) {
    return "none";
  }
  const visible = values.slice(0, limit);
  const suffix = values.length > visible.length ? `\n...and ${values.length - visible.length} more` : "";
  return `${visible.join("\n")}${suffix}`;
}

function manualDoctorRepair({
  actionId,
  command,
  label
}) {
  return createDoctorRepair({
    actionId,
    command,
    kind: "manual",
    label
  });
}

export {
  blockedDoctorCheck,
  createDoctorRepair,
  doctorCheckPassed,
  doctorCheckItem,
  failDoctorCheck,
  formatDoctorList,
  hardStopDoctorCheck,
  manualDoctorRepair,
  pendingDoctorCheck,
  passDoctorCheck
};
