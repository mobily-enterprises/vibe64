function createDoctorRepair({
  actionId,
  command,
  fields = [],
  input,
  kind = "terminal",
  label
}) {
  const repair = {
    actionId,
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

function failDoctorCheck(details) {
  return doctorCheckItem({
    ...details,
    status: "fail"
  });
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
  createDoctorRepair,
  doctorCheckItem,
  failDoctorCheck,
  manualDoctorRepair,
  passDoctorCheck
};
