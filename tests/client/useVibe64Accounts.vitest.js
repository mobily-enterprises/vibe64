import { describe, expect, it } from "vitest";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";

import {
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
          message: "Codex is authenticated for the shared Vibe64 app account.",
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
});
