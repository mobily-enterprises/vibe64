import assert from "node:assert/strict";
import test from "node:test";

import {
  terminalOwnerAccessDenied,
  vibe64TerminalErrorMessage
} from "../../src/lib/vibe64TerminalErrors.js";

test("terminal owner access errors are classified without matching generic terminal failures", () => {
  assert.equal(terminalOwnerAccessDenied({
    code: "vibe64_terminal_owner_mismatch"
  }), true);
  assert.equal(terminalOwnerAccessDenied({
    errors: [{
      code: "vibe64_terminal_owner_required"
    }]
  }), true);
  assert.equal(terminalOwnerAccessDenied("This terminal belongs to a different Vibe64 user. Open a new terminal for your account."), true);
  assert.equal(terminalOwnerAccessDenied({
    code: "vibe64_github_reconnect_required"
  }), false);
  assert.equal(terminalOwnerAccessDenied(new Error("Terminal stream failed.")), false);
});

test("terminal owner access errors keep user-facing messages explicit", () => {
  assert.equal(
    vibe64TerminalErrorMessage({
      code: "vibe64_terminal_owner_mismatch"
    }),
    "This terminal belongs to a different Vibe64 user. Open a new terminal for your account."
  );
  assert.equal(
    vibe64TerminalErrorMessage({
      code: "vibe64_terminal_owner_required"
    }),
    "This terminal is from an older Vibe64 session. Restart it before using it again."
  );
});
