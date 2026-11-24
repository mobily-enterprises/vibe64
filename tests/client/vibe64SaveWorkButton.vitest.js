import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { saveWorkButtonPress } from "../../src/lib/vibe64SaveWorkButton.js";

const header = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/components/studio/vibe64-session/Vibe64AutopilotSessionHeader.vue"), "utf8");

it("a press of Save says why it cannot act, rather than nothing, and otherwise checks, waits or saves", () => {
  expect(saveWorkButtonPress({ checking: false, checkAvailable: false, disabled: true })).toBe("explain");
  expect(saveWorkButtonPress({ checking: false, checkAvailable: true, disabled: true })).toBe("check");
  expect(saveWorkButtonPress({ checking: true, checkAvailable: true, disabled: true })).toBe("wait");
  expect(saveWorkButtonPress({ checking: false, checkAvailable: false, disabled: false })).toBe("save");
});

it("keeps Save reachable while it cannot act, marked unavailable, with its reason shown beside it on a press", () => {
  // A disabled button takes no tap, hover or focus, so its reason never shows on a phone or to a pointer.
  expect(header).toContain(':disabled="saveWorkChecking"');
  expect(header).toContain(":aria-disabled=\"saveWorkPress === 'explain' ? 'true' : undefined\"");
  expect(header).toContain("{{ saveWorkChecking ? \"Checking…\" : saveWorkTitle }}");
});
