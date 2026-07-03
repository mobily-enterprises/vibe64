import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiCloseCircle,
  mdiProgressClock
} from "@mdi/js";

function doctorStatusColor(status = "") {
  if (status === "pass") {
    return "success";
  }
  if (status === "running") {
    return "primary";
  }
  if (["blocked", "fail", "hard-stop"].includes(status)) {
    return "error";
  }
  return "warning";
}

function doctorStatusIcon(status = "") {
  if (status === "pass") {
    return mdiCheckCircle;
  }
  if (status === "running") {
    return mdiProgressClock;
  }
  if (["blocked", "fail", "hard-stop"].includes(status)) {
    return mdiCloseCircle;
  }
  return mdiAlertCircleOutline;
}

function doctorStatusLabel(status = "") {
  if (status === "pass") {
    return "Ready";
  }
  if (status === "running") {
    return "Running";
  }
  if (status === "hard-stop") {
    return "Hard stop";
  }
  if (["blocked", "fail"].includes(status)) {
    return "Needs attention";
  }
  return "Pending";
}

function doctorStatusToneClass(status = "") {
  if (status === "pass") {
    return "doctor-status__status-badge--pass";
  }
  if (status === "running") {
    return "doctor-status__status-badge--running";
  }
  if (["blocked", "fail", "hard-stop"].includes(status)) {
    return "doctor-status__status-badge--fail";
  }
  return "doctor-status__status-badge--unknown";
}

function doctorSummaryIcon(state = "") {
  if (state === "pass") {
    return mdiCheckCircle;
  }
  if (state === "checking") {
    return mdiProgressClock;
  }
  if (state === "waiting") {
    return mdiAlertCircleOutline;
  }
  return mdiCloseCircle;
}

export {
  doctorStatusColor,
  doctorStatusIcon,
  doctorStatusLabel,
  doctorStatusToneClass,
  doctorSummaryIcon
};
