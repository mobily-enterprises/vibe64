import { describe, expect, it } from "vitest";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";

import {
  authSessionReadAnswer,
  statusWithAccount,
  statusWithCodexReconnectRequired
} from "../../packages/vibe64-accounts/src/client/composables/useVibe64Accounts.js";

describe("useVibe64Accounts account status cache", () => {
  it("marks an artificially stale-green Codex account reconnect-required", () => {
    const status = {
      accounts: [
        {
          connected: true,
          id: "codex",
          label: "Codex",
          message: "Codex is signed in.",
          required: true,
          scope: "app",
          status: "connected"
        },
        {
          connected: true,
          id: "github",
          label: "GitHub",
          message: "GitHub CLI is configured for this Vibe64 user.",
          required: true,
          scope: "user",
          status: "connected"
        }
      ],
      blockedReason: "",
      ok: true,
      ready: true
    };

    const nextStatus = statusWithCodexReconnectRequired(status);

    expect(nextStatus.ready).toBe(false);
    expect(nextStatus.blockedReason).toBe(CODEX_RECONNECT_REQUIRED_MESSAGE);
    expect(nextStatus.accounts[0]).toMatchObject({
      code: CODEX_RECONNECT_REQUIRED_CODE,
      connected: false,
      id: "codex",
      label: "Codex",
      message: CODEX_RECONNECT_REQUIRED_MESSAGE,
      required: true,
      scope: "app",
      status: "reconnect_required"
    });
    expect(nextStatus.accounts[1]).toEqual(status.accounts[1]);
  });

  it("shows an account action's own row at once with the readiness it implies", () => {
    const claude = { id: "claude", connected: true, required: false, message: "Connected through Claude Code." };
    const codex = { id: "codex", connected: true, required: true, message: "Codex is signed in." };
    const status = { accounts: [claude, codex], blockedReason: "", ok: true, ready: true, updatedAt: "earlier" };
    const signedOut = { ...claude, connected: false, status: "not_connected", message: "Sign in to Claude Code." };
    expect(statusWithAccount(status, signedOut)).toEqual({ ...status, accounts: [signedOut, codex] });
    const codexOut = { ...codex, connected: false, message: "Sign in to Codex." };
    expect(statusWithAccount(status, codexOut)).toMatchObject({ ready: false, blockedReason: "Sign in to Codex." });
    expect(statusWithAccount(status, { id: "github" })).toBe(status, "a row the status does not list waits for the reload");
    expect(statusWithAccount(undefined, signedOut)).toBe(undefined);
  });
});

describe("useVibe64Accounts sign-in progress reads", () => {
  it("fails a sign-in progress read that failed, rather than answering with the status before it", () => {
    const before = { id: "auth-1", status: "authenticating" };
    expect(authSessionReadAnswer({ data: { id: "auth-1", status: "connected" } }, before, "")).toEqual({ id: "auth-1", status: "connected" });
    // A failed refetch keeps the data it had: answering with it would show the sign-in waiting for ever.
    expect(() => authSessionReadAnswer({ data: before, isError: true }, before,
      "Vibe64 could not check this sign-in's progress just now. It checks again shortly."))
      .toThrow("Vibe64 could not check this sign-in's progress just now. It checks again shortly.");
  });
});
