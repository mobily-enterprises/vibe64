import { describe, expect, it } from "vitest";
import {
  SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS,
  sessionRenewalAdvisoryPresentation,
  sessionRenewalDraftCharacterCount,
  sessionRenewalFailureSupportingMessage,
  sessionRenewalOperationKey,
  sessionRenewalPhase,
  sessionRenewalStageLabel,
  sessionRenewalStageProgress,
  sessionRenewalText
} from "../../src/lib/vibe64SessionRenewalViewModel.js";

describe("session renewal view model", () => {
  it("maps durable lifecycle states to stable UI phases", () => {
    expect(sessionRenewalPhase(null, { initialLoading: true })).toBe("loading");
    expect(sessionRenewalPhase(null, { loadError: "offline" })).toBe("load_error");
    expect(sessionRenewalPhase(null)).toBe("intro");
    expect(sessionRenewalPhase({ status: "cancelled" })).toBe("intro");
    expect(sessionRenewalPhase({ status: "review" })).toBe("review");
    expect(sessionRenewalPhase({ status: "running" })).toBe("progress");
    expect(sessionRenewalPhase({ status: "failed" })).toBe("failed");
    expect(sessionRenewalPhase({ status: "completed" })).toBe("completed");
  });

  it("keeps a durable snapshot visible while a refresh temporarily fails", () => {
    expect(sessionRenewalPhase(
      { status: "review" },
      { initialLoading: true, loadError: "offline" }
    )).toBe("review");
    expect(sessionRenewalPhase(
      { status: "running" },
      { loadError: "offline" }
    )).toBe("progress");
  });

  it("presents progress in execution order without pretending pending work is complete", () => {
    expect(sessionRenewalStageLabel("successor_setup")).toBe("Preparing the fresh workspace…");
    expect(sessionRenewalStageProgress("successor_setup").map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "active",
      "pending",
      "pending",
      "pending"
    ]);
    expect(sessionRenewalStageLabel("successor_discarding")).toBe(
      "Resetting the fresh session safely…"
    );
    expect(sessionRenewalStageProgress("successor_discarding").map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "active",
      "pending",
      "pending",
      "pending"
    ]);
    expect(sessionRenewalStageLabel("failure_restoring")).toBe(
      "Restoring the old session…"
    );
    expect(sessionRenewalStageProgress("failure_restoring")).toEqual([{
      id: "restore",
      label: "Restore the old session safely",
      state: "active"
    }]);
    expect(sessionRenewalStageProgress("successor_activating").map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
      "complete",
      "active"
    ]);
    expect(sessionRenewalStageProgress("completed").map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
      "complete",
      "complete"
    ]);
  });

  it("does not repeat a failure explanation already supplied by the server", () => {
    const renewal = {
      error: { message: "A specific setup check failed.", retryable: true }
    };
    const supportingMessage = sessionRenewalFailureSupportingMessage(renewal);

    expect(supportingMessage).toContain("The old session remains available.");
    expect(sessionRenewalFailureSupportingMessage({
      error: { message: supportingMessage, retryable: true }
    })).toBe("");
  });

  it("does not claim the predecessor is writable while restoration needs retry", () => {
    const supportingMessage = sessionRenewalFailureSupportingMessage({
      error: {
        code: "vibe64_session_renewal_restore_failed",
        message: "Writable restoration unavailable.",
        retryable: true
      }
    });

    expect(supportingMessage).toContain("recovery state are retained");
    expect(supportingMessage).toContain("not writable yet");
    expect(supportingMessage).not.toContain("remains available");
  });

  it("counts Unicode code points and preserves exact reviewed line breaks", () => {
    const exact = `  ${"😀".repeat(SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS - 4)}  `;
    expect(sessionRenewalDraftCharacterCount(exact)).toBe(SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS);
    expect(sessionRenewalText("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("uses conservative advisory language while leaving manual renewal visible", () => {
    expect(sessionRenewalAdvisoryPresentation({ severity: "none" })).toMatchObject({
      attention: false,
      label: "Renew session"
    });
    expect(sessionRenewalAdvisoryPresentation({
      reason: "Context is nearly full.",
      recommended: true,
      severity: "soon"
    })).toEqual({
      attention: true,
      color: "warning",
      label: "Renew soon",
      reason: "Context is nearly full."
    });
  });

  it("creates bounded server-valid renewal operation keys", () => {
    const key = sessionRenewalOperationKey("session / one", {
      now: 123456,
      randomId: "uuid:value/unsafe"
    });
    expect(key).toBe("renewal:session-one:2n9c:uuidvalueunsafe");
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u);
  });
});
