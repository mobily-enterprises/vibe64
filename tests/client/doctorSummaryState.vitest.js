import { describe, expect, it } from "vitest";

import {
  resolveDoctorSummaryState
} from "../../src/lib/doctorSummaryState.js";

describe("doctor summary state", () => {
  it("shows checking while a doctor is loading even when it is not ready yet", () => {
    const summary = resolveDoctorSummaryState({
      blockedLabel: "Target app blocked",
      blockedTitle: "Target app blocked",
      isLoading: true,
      passedCheckCount: 7,
      ready: false,
      requiredCheckCount: 10
    });

    expect(summary.state).toBe("checking");
    expect(summary.color).toBe("primary");
    expect(summary.label).toBe("Checking");
    expect(summary.title).toBe("Checking");
    expect(summary.progressText).toBe("7 of 10 required checks have passed so far.");
  });

  it("shows blocked only after checking has finished and the doctor is not ready", () => {
    const summary = resolveDoctorSummaryState({
      blockedLabel: "Target app blocked",
      blockedTitle: "Target app blocked",
      isLoading: false,
      passedCheckCount: 7,
      ready: false,
      requiredCheckCount: 10
    });

    expect(summary.state).toBe("fail");
    expect(summary.color).toBe("error");
    expect(summary.label).toBe("Target app blocked");
    expect(summary.title).toBe("Target app blocked");
    expect(summary.progressText).toBe("7 of 10 required checks are ready.");
  });

  it("shows ready after checking has finished and the doctor is ready", () => {
    const summary = resolveDoctorSummaryState({
      isLoading: false,
      passedCheckCount: 10,
      ready: true,
      readyLabel: "App ready",
      readyTitle: "Target app ready",
      requiredCheckCount: 10
    });

    expect(summary.state).toBe("pass");
    expect(summary.color).toBe("success");
    expect(summary.label).toBe("App ready");
    expect(summary.title).toBe("Target app ready");
  });

  it("shows waiting when a doctor is healthy but waiting for bootstrap", () => {
    const summary = resolveDoctorSummaryState({
      isLoading: false,
      passedCheckCount: 4,
      readiness: {
        label: "Seed in progress",
        progressText: "Project shell is ready. Complete the seed session.",
        state: "waiting",
        title: "Seed in progress"
      },
      ready: false,
      requiredCheckCount: 6
    });

    expect(summary.state).toBe("waiting");
    expect(summary.color).toBe("warning");
    expect(summary.label).toBe("Seed in progress");
    expect(summary.title).toBe("Seed in progress");
    expect(summary.progressText).toBe("Project shell is ready. Complete the seed session.");
  });
});
